const FALLBACK_ORIGIN = typeof location !== 'undefined' && location?.origin ? location.origin : 'https://example.com';

export function normalizeBasePath(basePath) {
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

export function basePathFromFullPath(path) {
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

export function buildIndexPath(basePath) {
  const base = normalizeBasePath(basePath);
  if (!base) return null;
  return base === '/' ? '/index.html' : `${base}/index.html`;
}

export function normalizePlayPath(playUrl) {
  if (!playUrl) return null;
  try {
    const origin = typeof location !== 'undefined' && location?.origin ? location.origin : FALLBACK_ORIGIN;
    const asUrl = new URL(playUrl, origin);
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

export function derivePathsFromCandidate(candidate) {
  if (!candidate) return null;
  try {
    const origin = typeof location !== 'undefined' && location?.origin ? location.origin : FALLBACK_ORIGIN;
    const asUrl = new URL(candidate, origin);
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
