(function bootstrapLeaderboard(globalScope){
  const globalRef = globalScope || (typeof globalThis !== 'undefined' ? globalThis : undefined);
  const DEFAULT_CACHE_LIMIT = 5;
  const API_ENDPOINT = '/api/leaderboard';

  class LeaderboardError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'LeaderboardError';
      if (options.cause !== undefined) this.cause = options.cause;
      if (options.status !== undefined) this.status = options.status;
    }
  }

  function storageAvailable(){
    if (!globalRef || typeof globalRef.localStorage === 'undefined') return false;
    try {
      const testKey = '__lb:test__';
      globalRef.localStorage.setItem(testKey, '1');
      globalRef.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  const hasStorage = storageAvailable();

  function storageKey(game, seed){
    return seed ? `leaderboard:${game}:${seed}` : `leaderboard:${game}`;
  }

  function normaliseEntry(entry, seedFallback){
    if (!entry) return null;
    const score = Number(entry.score);
    if (!Number.isFinite(score)) return null;
    const normalised = { score };
    const resolvedSeed = entry.seed ?? entry?.metadata?.seed ?? seedFallback;
    if (resolvedSeed !== undefined && resolvedSeed !== null) {
      normalised.seed = resolvedSeed;
    }
    if (entry.handle && typeof entry.handle === 'string') {
      const trimmed = entry.handle.trim();
      if (trimmed) normalised.handle = trimmed;
    }
    if (typeof entry.shared === 'boolean') {
      normalised.shared = entry.shared;
    }
    const submittedAt = Number(entry.submittedAt ?? entry.at);
    if (Number.isFinite(submittedAt)) {
      normalised.at = submittedAt;
    }
    return normalised;
  }

  function readCache(game, seed){
    if (!hasStorage) return [];
    try {
      const raw = globalRef.localStorage.getItem(storageKey(game, seed));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(entry => normaliseEntry(entry, seed))
        .filter(Boolean)
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    } catch {
      return [];
    }
  }

  function writeCache(game, seed, entries){
    if (!hasStorage) return;
    try {
      const key = storageKey(game, seed);
      globalRef.localStorage.setItem(key, JSON.stringify(entries));
    } catch {
      /* ignore */
    }
  }

  function appendCache(game, seed, entry, limit){
    const existing = readCache(game, seed);
    if (entry) existing.push(entry);
    existing.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const trimmed = existing.slice(0, limit);
    writeCache(game, seed, trimmed);
    return trimmed;
  }

  function replaceCache(game, seed, entries, limit){
    const normalised = [];
    for (const entry of entries || []){
      const n = normaliseEntry(entry, seed);
      if (n) normalised.push(n);
    }
    normalised.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const trimmed = normalised.slice(0, limit);
    writeCache(game, seed, trimmed);
    return trimmed;
  }

  function ensureFetch(provided){
    if (typeof provided === 'function') return provided;
    if (globalRef && typeof globalRef.fetch === 'function') {
      return (...args) => globalRef.fetch(...args);
    }
    return null;
  }

  async function parseJsonSafe(response){
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function createLeaderboardClient(options = {}){
    const fetchImpl = ensureFetch(options.fetch);
    const cacheLimit = Number.isFinite(options.cacheLimit) && options.cacheLimit > 0
      ? Math.floor(options.cacheLimit)
      : DEFAULT_CACHE_LIMIT;

    async function submitScore(game, score, seed){
      if (typeof game !== 'string' || !game.trim()) {
        throw new LeaderboardError('game must be a non-empty string');
      }
      const numericScore = Number(score);
      if (!Number.isFinite(numericScore)) {
        throw new LeaderboardError('score must be a finite number');
      }

      const cachedEntry = normaliseEntry({ score: numericScore, seed, at: Date.now() }, seed);
      const cached = appendCache(game, seed, cachedEntry, cacheLimit);

      if (!fetchImpl) {
        throw new LeaderboardError('Leaderboard service unavailable');
      }

      try {
        const payload = { game, score: numericScore };
        if (seed !== undefined && seed !== null) {
          payload.metadata = { seed };
        }
        const response = await fetchImpl(API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorBody = await parseJsonSafe(response);
          const message = errorBody && typeof errorBody.error === 'string'
            ? errorBody.error
            : `Request failed with status ${response.status}`;
          throw new LeaderboardError(message, { status: response.status });
        }

        const body = await parseJsonSafe(response);
        if (body && Array.isArray(body.scores)) {
          replaceCache(game, seed, body.scores, cacheLimit);
        } else if (body && body.submitted) {
          replaceCache(game, seed, [body.submitted], cacheLimit);
        }

        return {
          entries: readCache(game, seed).slice(0, cacheLimit),
          fromCache: false,
          response: body || null
        };
      } catch (error) {
        if (error instanceof LeaderboardError) {
          throw error;
        }
        throw new LeaderboardError('Failed to submit score', { cause: error });
      }
    }

    async function getTopScores(game, seed, limit = cacheLimit){
      if (typeof game !== 'string' || !game.trim()) {
        throw new LeaderboardError('game must be a non-empty string');
      }
      const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : cacheLimit;
      if (fetchImpl) {
        try {
          const params = new URLSearchParams({ game });
          if (seed !== undefined && seed !== null && String(seed).trim() !== '') {
            params.set('seed', String(seed));
          }
          if (max) params.set('limit', String(max));
          const response = await fetchImpl(`${API_ENDPOINT}?${params.toString()}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            credentials: 'same-origin'
          });
          if (!response.ok) {
            const errorBody = await parseJsonSafe(response);
            const message = errorBody && typeof errorBody.error === 'string'
              ? errorBody.error
              : `Request failed with status ${response.status}`;
            throw new LeaderboardError(message, { status: response.status });
          }
          const body = await parseJsonSafe(response);
          const scores = Array.isArray(body?.scores) ? body.scores : [];
          const filteredScores = (seed !== undefined && seed !== null && String(seed).trim() !== '')
            ? scores.filter(entry => {
              const entrySeed = entry?.seed ?? entry?.metadata?.seed;
              if (entrySeed === undefined || entrySeed === null) return false;
              return String(entrySeed) === String(seed);
            })
            : scores;
          const entries = replaceCache(game, seed, filteredScores, Math.max(max, cacheLimit));
          return {
            entries: entries.slice(0, max || entries.length),
            fromCache: false,
            response: body || null
          };
        } catch (error) {
          if (error instanceof LeaderboardError) {
            throw error;
          }
          // swallow and fall back to local cache
        }
      }
      return {
        entries: readCache(game, seed).slice(0, max || cacheLimit),
        fromCache: true,
        response: null
      };
    }

    function getCachedScores(game, seed, limit = cacheLimit){
      const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : cacheLimit;
      return readCache(game, seed).slice(0, max);
    }

    return {
      submitScore,
      getTopScores,
      getCachedScores,
      LeaderboardError
    };
  }

  const readyPromise = (async () => createLeaderboardClient())();

  if (globalRef) {
    const existing = globalRef.LB;
    if (!existing) {
      globalRef.LB = readyPromise;
    } else if (typeof existing.then !== 'function') {
      globalRef.LB = Promise.resolve(existing);
    }
    globalRef.__leaderboard = Object.assign({}, globalRef.__leaderboard, {
      createLeaderboardClient,
      LeaderboardError
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createLeaderboardClient, LeaderboardError };
  }
})(typeof window !== 'undefined' ? window : undefined);
