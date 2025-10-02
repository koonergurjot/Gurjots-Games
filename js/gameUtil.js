(function () {
  const LEGACY_XP_KEY = 'gg:xp';

  function safeJSONParse(value) {
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function sanitizeStatNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function normalizeProfileName(name) {
    if (typeof name !== 'string') return 'guest';
    const trimmed = name.trim();
    if (!trimmed) return 'guest';
    if (trimmed.toLowerCase() === 'default') return 'guest';
    return trimmed.toLowerCase();
  }

  function getActiveProfileName() {
    try {
      const stored = safeJSONParse(localStorage.getItem('gg:profile'));
      if (stored && typeof stored.name === 'string' && stored.name.trim()) {
        return stored.name;
      }
    } catch {}
    try {
      const fallback = localStorage.getItem('profile');
      if (typeof fallback === 'string' && fallback.trim()) {
        if (fallback.trim().toLowerCase() === 'default') {
          return 'Guest';
        }
        return fallback;
      }
    } catch {}
    return 'Guest';
  }

  function getProfileStorageContext() {
    const normalized = normalizeProfileName(getActiveProfileName());
    return {
      key: `${LEGACY_XP_KEY}:${encodeURIComponent(normalized)}`,
      normalized
    };
  }

  function getProfileStatsKey() {
    return getProfileStorageContext().key;
  }

  function persistStats(stats) {
    const context = getProfileStorageContext();
    const payload = {
      xp: sanitizeStatNumber(stats.xp),
      plays: sanitizeStatNumber(stats.plays)
    };
    try {
      localStorage.setItem(context.key, JSON.stringify(payload));
      localStorage.setItem(LEGACY_XP_KEY, JSON.stringify(payload));
    } catch {}
    return payload;
  }

  function readStat() {
    const context = getProfileStorageContext();
    try {
      let raw = localStorage.getItem(context.key);
      if (!raw && context.normalized === 'guest') {
        const legacy = localStorage.getItem(LEGACY_XP_KEY);
        if (legacy) {
          raw = legacy;
          localStorage.setItem(context.key, legacy);
        }
      }
      const parsed = safeJSONParse(raw) || { xp: 0, plays: 0 };
      return {
        xp: sanitizeStatNumber(parsed.xp),
        plays: sanitizeStatNumber(parsed.plays)
      };
    } catch {
      return { xp: 0, plays: 0 };
    }
  }

  function addXP(amount) {
    const stats = readStat();
    stats.xp += amount | 0;
    persistStats(stats);
  }

  function incPlays() {
    const stats = readStat();
    stats.plays += 1;
    persistStats(stats);
  }

  function setMeta(id, text) {
    try {
      localStorage.setItem('gg:meta:' + id, text);
    } catch {}
  }

  function addAch(id, badge) {
    const key = 'gg:ach:' + id;
    const current = localStorage.getItem(key) || '';
    const values = current ? current.split(',').filter(Boolean) : [];
    if (!values.includes(badge)) {
      values.push(badge);
    }
    try {
      localStorage.setItem(key, values.join(','));
    } catch {}
  }

  window.GG = Object.assign(window.GG || {}, {
    addXP,
    incPlays,
    setMeta,
    addAch,
    getStats: readStat
  });
})();
