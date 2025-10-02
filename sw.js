// sw.js — safe service worker with pass-through for games and scripts
const CACHE_VERSION = 'v3_2';

const CORE_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/game.html',
  '/play.html',
  '/css/bolt-landing.css?v=20250911175011',
  '/js/bolt-landing.js?v=20250911175011',
  '/js/auto-diag-inject.js',
  '/js/game-loader.js',
  '/js/preflight.js',
  '/js/three-global-shim.js',
  '/shared/gg-shim.js',
  '/shared/game-paths.js',
  '/shared/quest-widget.js',
  '/games.json',
];

function normalizeScope(scope) {
  if (!scope || typeof scope !== 'string') {
    return 'static';
  }

  let raw = scope.trim();
  if (!raw) {
    return 'static';
  }

  if (raw.includes('://')) {
    try {
      const scopeURL = new URL(raw);
      raw = scopeURL.pathname || '/';
    } catch (_) {
      // Ignore parse failures and fall back to the original string.
    }
  }

  const cleaned = raw
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-');

  return cleaned || 'static';
}

const CACHE_NAME = `gg-${CACHE_VERSION}-${normalizeScope(self.registration?.scope)}`;

function normalizeAsset(asset) {
  if (!asset) return null;
  if (typeof asset === 'string') return asset;
  if (typeof asset === 'object' && typeof asset.url === 'string') return asset.url;
  return null;
}

async function stashAssets(assets = []) {
  if (!assets.length) return;
  const cache = await caches.open(CACHE_NAME);
  const unique = Array.from(new Set(assets.filter(Boolean)));
  await Promise.all(unique.map(async (asset) => {
    const request = new Request(asset, { credentials: 'omit' });
    const existing = await cache.match(request);
    if (existing) return;
    try {
      const response = await fetch(asset, { credentials: 'omit' });
      if (response && response.ok) {
        await cache.put(request, response.clone());
      }
    } catch (error) {
      console.warn('[sw] failed to precache asset', asset, error);
    }
  }));
}

self.addEventListener('install', (event) => {
  const manifestAssets = Array.isArray(self.__PRECACHE_MANIFEST)
    ? self.__PRECACHE_MANIFEST.map(normalizeAsset).filter(Boolean)
    : [];
  const precacheTargets = [...CORE_SHELL_ASSETS, ...manifestAssets];
  event.waitUntil((async () => {
    await stashAssets(precacheTargets);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
  })());
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'PRECACHE') return;
  const assets = Array.isArray(data.assets) ? data.assets.map(normalizeAsset).filter(Boolean) : [];
  if (!assets.length) return;
  event.waitUntil(stashAssets(assets));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const isScript = req.destination === 'script' || url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs');
  if (isScript && url.pathname.startsWith('/games/')) {
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const networkResponse = await fetch(req);
      if (networkResponse && networkResponse.ok) {
        try {
          await cache.put(req, networkResponse.clone());
        } catch (_) {}
      }
      return networkResponse;
    } catch (error) {
      const cached = await cache.match(req);
      if (cached) {
        return cached;
      }
      if (req.mode === 'navigate' || req.destination === 'document') {
        const fallback = await cache.match('/index.html');
        if (fallback) {
          return fallback;
        }
      }
      throw error;
    }
  })());
});
