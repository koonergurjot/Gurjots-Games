const GAME_SOURCES = [
  {
    url: '/games.json',
    extractSlug(entry) {
      return (entry?.id || entry?.slug || '').trim();
    },
    extractPlay(entry) {
      return entry?.playUrl || entry?.playURL || entry?.url || entry?.href || null;
    },
    extractEntry(entry) {
      return entry?.entry || null;
    }
  }
];

const sourceCache = new Map();

async function fetchSourceEntries(source) {
  if (!sourceCache.has(source.url)) {
    sourceCache.set(source.url, (async () => {
      try {
        const response = await fetch(source.url, { credentials: 'omit' });
        if (!response?.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      } catch (err) {
        console.warn('[GG] failed to load game catalog', source.url, err);
        return [];
      }
    })());
  }
  return sourceCache.get(source.url);
}

function normalizeBasePath(basePath) {
  if (!basePath) return null;
  let path = String(basePath).trim();
  if (!path) return null;
  path = path.replace(/[?#].*$/, '');
  path = path.replace(/\\+/g, '/');
  path = path.replace(/\/+/g, '/');
  path = path.replace(/\/+$/, '');
  if (!path.startsWith('/')) path = `/${path}`;
  return path || '/';
}

function basePathFromFullPath(path) {
  if (!path) return null;
  let target = String(path).trim();
  if (!target) return null;
  target = target.replace(/[?#].*$/, '');
  target = target.replace(/\\+/g, '/');
  target = target.replace(/\/+/g, '/');
  target = target.replace(/\/+$/, '');
  if (!target.startsWith('/')) target = `/${target}`;
  const lastSlash = target.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return normalizeBasePath(target.slice(0, lastSlash));
}

function buildIndexPath(basePath) {
  const base = normalizeBasePath(basePath);
  if (!base) return null;
  return base === '/' ? '/index.html' : `${base}/index.html`;
}

function normalizePlayPath(playUrl) {
  if (!playUrl) return null;
  try {
    const asUrl = new URL(playUrl, location.origin);
    let pathname = asUrl.pathname || '';
    pathname = pathname.replace(/\\+/g, '/');
    pathname = pathname.replace(/\/+/g, '/');
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;
    pathname = pathname.replace(/\/+$/, '');
    if (!pathname.endsWith('.html')) {
      pathname = `${pathname}/index.html`;
    }
    return `${pathname}${asUrl.search || ''}${asUrl.hash || ''}`;
  } catch (err) {
    console.warn('[GG] unable to normalize playUrl', playUrl, err);
    return null;
  }
}

function derivePathsFromCandidate(candidate) {
  if (!candidate) return null;
  try {
    const asUrl = new URL(candidate, location.origin);
    let pathname = asUrl.pathname || '';
    pathname = pathname.replace(/\\+/g, '/');
    pathname = pathname.replace(/\/+/g, '/');
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;

    if (pathname.endsWith('/')) {
      const basePath = normalizeBasePath(pathname);
      const playPath = buildIndexPath(basePath);
      return basePath ? { basePath, playPath } : null;
    }

    const sanitized = pathname.replace(/\/+$/, '');
    const basePath = basePathFromFullPath(sanitized);
    if (!basePath) return null;

    if (/\.html$/i.test(sanitized)) {
      return { basePath, playPath: `${sanitized}${asUrl.search || ''}${asUrl.hash || ''}` };
    }

    const playPath = buildIndexPath(basePath);
    return { basePath, playPath };
  } catch (err) {
    console.warn('[GG] unable to derive game path from', candidate, err);
    return null;
  }
}

export async function resolveGamePaths(slug) {
  if (!slug) return { basePath: null, playPath: null };
  const needle = String(slug).toLowerCase();

  for (const source of GAME_SOURCES) {
    const entries = await fetchSourceEntries(source);
    if (!entries.length) continue;

    const match = entries.find((entry) => {
      const entrySlug = source.extractSlug(entry);
      return entrySlug && entrySlug.toLowerCase() === needle;
    });

    if (!match) continue;

    const playCandidate = source.extractPlay(match);
    const entryCandidate = source.extractEntry(match);

    const normalizedPlay = normalizePlayPath(playCandidate);
    const playPaths = normalizedPlay ? { basePath: basePathFromFullPath(normalizedPlay), playPath: normalizedPlay } : null;
    const entryPaths = derivePathsFromCandidate(entryCandidate);
    const mergedBase = playPaths?.basePath || entryPaths?.basePath;
    const mergedPlay = playPaths?.playPath || entryPaths?.playPath;

    return { basePath: mergedBase, playPath: mergedPlay };
  }

  return { basePath: null, playPath: null };
}
