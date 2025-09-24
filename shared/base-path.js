const ABSOLUTE_PROTOCOL = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function normalizeBasePath(input) {
  if (!input) return '/';
  let path = String(input).trim();
  if (!path) return '/';
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\\+/g, '/');
  path = path.replace(/\/+$/, '');
  return path || '/';
}

function detectBasePath() {
  if (typeof window !== 'undefined') {
    const hinted = window.__GG_BASE_PATH__;
    if (typeof hinted === 'string' && hinted.trim()) {
      return normalizeBasePath(hinted);
    }
  }

  if (typeof document !== 'undefined') {
    const base = document.querySelector('base[href]');
    if (base) {
      try {
        const url = new URL(base.getAttribute('href'), document.baseURI);
        return normalizeBasePath(url.pathname || '/');
      } catch (_) {}
    }
  }

  if (typeof import.meta !== 'undefined' && import.meta.url) {
    try {
      const url = new URL('../', import.meta.url);
      if (url.protocol === 'file:') {
        return '/';
      }
      const computed = normalizeBasePath(url.pathname || '/');
      if (computed.startsWith('/@fs/') || computed.startsWith('/@id/')) {
        return '/';
      }
      return computed;
    } catch (_) {}
  }

  if (typeof document !== 'undefined' && document.baseURI) {
    try {
      const url = new URL('./', document.baseURI);
      return normalizeBasePath(url.pathname || '/');
    } catch (_) {}
  }

  if (typeof location !== 'undefined' && location.href) {
    try {
      const url = new URL('./', location.href);
      return normalizeBasePath(url.pathname || '/');
    } catch (_) {}
  }

  return '/';
}

function ensureLeadingSlash(value) {
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

const basePath = detectBasePath();

function buildBaseUrl() {
  if (typeof location !== 'undefined' && location.origin) {
    return new URL(basePath === '/' ? '/' : `${basePath}/`, location.origin);
  }
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    try {
      return new URL(basePath === '/' ? './' : `${basePath.slice(1)}/`, import.meta.url);
    } catch (_) {}
  }
  return new URL(basePath === '/' ? '/' : `${basePath}/`, 'http://localhost');
}

const baseUrl = buildBaseUrl();

export function getBasePath() {
  return basePath;
}

export function getBaseUrl() {
  return baseUrl;
}

export function stripBasePath(pathname) {
  if (typeof pathname !== 'string' || !pathname) return '/';
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (basePath === '/' || !normalized.startsWith(basePath)) {
    return normalized;
  }
  const sliced = normalized.slice(basePath.length) || '/';
  return sliced.startsWith('/') ? sliced : `/${sliced}`;
}

export function isWithinBasePath(pathname) {
  if (typeof pathname !== 'string' || !pathname) return false;
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (basePath === '/') return normalized.startsWith('/');
  if (normalized === basePath) return true;
  return normalized.startsWith(`${basePath}/`);
}

export function resolveRoutePath(target = '/') {
  if (typeof target !== 'string' || !target) {
    return basePath;
  }
  if (ABSOLUTE_PROTOCOL.test(target) || target.startsWith('//')) {
    return target;
  }
  if (target.startsWith('#') || target.startsWith('?')) {
    return target;
  }
  const normalized = target === '/' ? '/' : (target.startsWith('/') ? target : `/${target}`);
  if (isWithinBasePath(normalized)) {
    return normalized;
  }
  if (basePath === '/') {
    return normalized;
  }
  if (normalized === '/') {
    return basePath;
  }
  return `${basePath}${normalized}`.replace(/\/{2,}/g, '/');
}

export function resolveAssetUrl(target) {
  if (typeof target !== 'string' || !target) {
    return baseUrl.toString();
  }
  if (ABSOLUTE_PROTOCOL.test(target) || target.startsWith('//')) {
    return target;
  }
  try {
    return new URL(target, baseUrl).toString();
  } catch (_) {
    return target;
  }
}

export function resolveAssetPath(target) {
  if (typeof target !== 'string' || !target) {
    return baseUrl.pathname;
  }
  if (ABSOLUTE_PROTOCOL.test(target) || target.startsWith('//')) {
    return target;
  }
  try {
    const resolved = new URL(target, baseUrl);
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch (_) {
    return target;
  }
}

export function applyBasePath(target) {
  if (typeof target !== 'string' || !target) return basePath;
  if (ABSOLUTE_PROTOCOL.test(target) || target.startsWith('//')) {
    return target;
  }
  const normalized = ensureLeadingSlash(target.replace(/^\/+/, ''));
  if (basePath === '/') return normalized;
  if (normalized === '/') return basePath;
  return `${basePath}${normalized}`.replace(/\/{2,}/g, '/');
}

if (typeof window !== 'undefined') {
  window.__GG_BASE_PATH__ = basePath;
  window.__GG_RESOLVE_ASSET__ = resolveAssetPath;
}
