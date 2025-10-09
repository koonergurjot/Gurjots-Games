// sw.js — safe service worker with pass-through for games and scripts
const CACHE_VERSION = 'v3_3';

const CORE_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/game.html',
  '/play.html',
  '/css/bolt-landing.css?v=20250911175011',
  '/styles/profile-overlay.css',
  '/js/bolt-landing.js?v=20250911175011',
  '/js/profile-overlay.js',
  '/js/auto-diag-inject.js',
  '/js/game-loader.js',
  '/js/preflight.js',
  '/js/three-global-shim.js',
  '/shared/gg-shim.js',
  '/shared/game-paths.js',
  '/shared/game-sandbox.js',
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

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean);
  return [];
}

function classifyAsset(url, hint) {
  if (hint === 'audio' || /\.(mp3|ogg|wav|m4a)(\?.*)?$/i.test(url)) return 'audio';
  if (hint === 'image' || /\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(url)) return 'image';
  return null;
}

function toAbsoluteUrl(url) {
  if (!url) return null;
  try {
    return new URL(url, self.location.origin).href;
  } catch (_) {
    return url;
  }
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
  event.waitUntil((async () => {
    const precacheTargets = [...CORE_SHELL_ASSETS, ...manifestAssets];
    try {
      const catalogAssets = await loadCatalogAssets();
      if (catalogAssets.length) {
        precacheTargets.push(...catalogAssets);
      }
    } catch (error) {
      console.warn('[sw] failed to load catalog assets', error);
    }
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
      const cached = await cache.match(req) || await cache.match(url.pathname);
      if (cached) {
        return cached;
      }
      if (req.mode === 'navigate' || req.destination === 'document') {
        const fallbackPath = url.pathname.startsWith('/game') ? '/game.html' : '/index.html';
        const fallback = await cache.match(fallbackPath);
        if (fallback) {
          return fallback;
        }
      }
      throw error;
    }
  })());
});

async function loadCatalog() {
  try {
    const response = await fetch('/games.json', { credentials: 'omit' });
    if (response && response.ok) {
      try {
        const json = await response.clone().json();
        if (Array.isArray(json)) {
          return json;
        }
      } catch (parseError) {
        // Ignore parse errors caused by non-JSON bodies and fall through to
        // the offline catalog fallback without spamming the console.
        if (!(parseError instanceof SyntaxError)) {
          throw parseError;
        }
      }
    }
  } catch (error) {
    console.warn('[sw] failed to read games.json', error);
  }

  try {
    return await parseOfflineCatalog();
  } catch (error) {
    console.warn('[sw] failed to parse offline catalog', error);
  }

  return [];
}

async function parseOfflineCatalog() {
  const response = await fetch('/data/games-offline.js', { credentials: 'omit' });
  if (!response || !response.ok) {
    return [];
  }
  const text = await response.text();
  const match = text.match(/export const games\s*=\s*(\[[\s\S]*\])/);
  if (!match) {
    return [];
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    console.warn('[sw] unable to parse offline catalog JSON', error);
    return [];
  }
}

async function loadCatalogAssets() {
  const catalog = await loadCatalog();
  if (!Array.isArray(catalog) || !catalog.length) {
    return [];
  }

  const assets = [];
  const seen = new Set();

  const addAsset = (url) => {
    const absolute = toAbsoluteUrl(url);
    if (!absolute) {
      return;
    }
    if (seen.has(absolute)) {
      return;
    }
    seen.add(absolute);
    assets.push(absolute);
  };

  const addTypedAsset = (url, hint) => {
    const absolute = toAbsoluteUrl(url);
    if (!absolute) {
      return;
    }
    const type = classifyAsset(absolute, hint);
    const key = type ? `${type}|${absolute}` : absolute;
    if (seen.has(key) || seen.has(absolute)) {
      return;
    }
    seen.add(key);
    seen.add(absolute);
    assets.push(absolute);
  };

  for (const game of catalog) {
    if (game && typeof game.playUrl === 'string') {
      addAsset(game.playUrl);
    }

    const meta = game?.assets || game?.firstFrame || game?.firstFrameAssets;
    if (!meta) continue;

    const sprites = normalizeList(meta.sprites || meta.images);
    const audio = normalizeList(meta.audio || meta.sounds);
    const misc = normalizeList(meta.assets);

    for (const sprite of sprites) {
      addTypedAsset(sprite, 'image');
    }
    for (const sound of audio) {
      addTypedAsset(sound, 'audio');
    }
    for (const asset of misc) {
      addTypedAsset(asset);
    }
  }

  return assets;
}
