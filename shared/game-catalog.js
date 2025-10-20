import { normalizeCatalogEntries, toNormalizedList } from './game-catalog-core.js';

const PRIMARY_CATALOG_URL = '/games.json';
const LEGACY_CATALOG_URLS = ['/public/games.json'];
const LOCAL_RELATIVE_CANDIDATES = ['./games.json'];
let catalogPromise = null;

function buildCandidateUrls() {
  const seen = new Set();
  const urls = [];
  const push = (value) => {
    if (!value) return;
    const normalized = typeof value === 'string' ? value : String(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    urls.push(normalized);
  };

  push(PRIMARY_CATALOG_URL);
  LEGACY_CATALOG_URLS.forEach(push);
  LOCAL_RELATIVE_CANDIDATES.forEach(push);

  try {
    const moduleRelative = new URL('../games.json', import.meta.url);
    push(moduleRelative.href);
  } catch (_) {
    /* noop */
  }

  if (typeof window !== 'undefined' && window.location) {
    try {
      const local = new URL('./games.json', window.location.href);
      push(local.href);
    } catch (_) {
      /* noop */
    }
  }

  return urls;
}

async function fetchCatalogSource() {
  const urls = buildCandidateUrls();
  const failures = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
      if (!response?.ok) throw new Error(`bad status: ${response?.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('games.json did not contain an array');
      return data;
    } catch (err) {
      failures.push({ url, error: err });
      console.warn('[GG][catalog] failed to load catalog source', { url, message: err?.message || String(err) });
    }
  }

  console.error('[GG][catalog] falling back to bundled catalog', {
    attempts: failures.map(entry => ({
      url: entry.url,
      message: entry.error?.message || String(entry.error),
    })),
  });

  try {
    const offline = await import('../data/games-offline.js');
    const fallback = offline?.games || offline?.default || [];
    if (!Array.isArray(fallback)) {
      console.error('[GG][catalog] offline fallback is not an array');
      return [];
    }
    return fallback;
  } catch (error) {
    console.error('[GG][catalog] failed to load offline fallback', error);
    return [];
  }
}

async function buildCatalog() {
  const sourceEntries = await fetchCatalogSource();
  const games = normalizeCatalogEntries(sourceEntries);
  const normalizedList = toNormalizedList(games);
  const byId = new Map();
  games.forEach(game => {
    byId.set(game.id, game);
    byId.set(game.id.toLowerCase(), game);
  });
  return { games, normalizedList, byId };
}

export async function loadGameCatalog() {
  if (!catalogPromise) {
    catalogPromise = buildCatalog().catch(err => {
      catalogPromise = null;
      throw err;
    });
  }
  return catalogPromise;
}

export async function getGameById(id) {
  if (!id) return null;
  const key = String(id).trim();
  if (!key) return null;
  const { byId } = await loadGameCatalog();
  return byId.get(key) || byId.get(key.toLowerCase()) || null;
}

export async function getNormalizedGames() {
  const { normalizedList } = await loadGameCatalog();
  return normalizedList;
}

export function resetGameCatalog() {
  catalogPromise = null;
}
