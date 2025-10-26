// sw.js — safe service worker with pass-through for games and scripts
const CACHE_VERSION = 'v3_3';

const DEFAULT_WARMUP_CHUNK_SIZE = 4;
const DEFAULT_WARMUP_DELAY_MS = 0;
const DEFAULT_WARMUP_MAX_ASSETS = 200;
const WARMUP_MAX_CHUNK_SIZE = 10;

const warmupQueue = {
  pending: [],
  seen: new Set(),
  running: false,
  promise: null,
  options: {
    chunkSize: DEFAULT_WARMUP_CHUNK_SIZE,
    delayMs: DEFAULT_WARMUP_DELAY_MS,
  },
};

let installWarmupAssets = [];

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
  if (hint === 'video' || /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(url)) return 'video';
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
  const successes = [];
  const failures = [];
  if (!assets.length) {
    return { successes, failures };
  }
  const cache = await caches.open(CACHE_NAME);
  const unique = Array.from(new Set(assets.filter(Boolean)));
  await Promise.all(unique.map(async (asset) => {
    const request = new Request(asset, { credentials: 'omit' });
    const existing = await cache.match(request);
    if (existing) {
      successes.push(asset);
      return;
    }
    try {
      const response = await fetch(asset, { credentials: 'omit' });
      if (response && response.ok) {
        await cache.put(request, response.clone());
        successes.push(asset);
      } else {
        failures.push(asset);
        console.warn('[sw] failed to precache asset', asset, response?.status);
      }
    } catch (error) {
      failures.push(asset);
      console.warn('[sw] failed to precache asset', asset, error);
    }
  }));
  return { successes, failures };
}

function wait(delayMs) {
  if (!delayMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
}

function clampChunkSize(value) {
  if (!Number.isFinite(value)) return DEFAULT_WARMUP_CHUNK_SIZE;
  return Math.min(WARMUP_MAX_CHUNK_SIZE, Math.max(1, Math.floor(value)));
}

function clampDelay(value) {
  if (!Number.isFinite(value) || value < 0) return DEFAULT_WARMUP_DELAY_MS;
  return Math.floor(value);
}

function clampMaxAssets(value) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WARMUP_MAX_ASSETS;
  return Math.min(DEFAULT_WARMUP_MAX_ASSETS, Math.floor(value));
}

async function processWarmupQueue() {
  while (warmupQueue.pending.length) {
    const chunkSize = clampChunkSize(warmupQueue.options.chunkSize);
    const chunk = warmupQueue.pending.splice(0, chunkSize);
    if (!chunk.length) {
      break;
    }
    try {
      const { failures } = await stashAssets(chunk);
      if (failures?.length) {
        for (const failed of failures) {
          warmupQueue.seen.delete(failed);
        }
      }
    } catch (error) {
      console.warn('[sw] failed to warmup assets', error);
      for (const asset of chunk) {
        warmupQueue.seen.delete(asset);
      }
    }
    if (warmupQueue.pending.length) {
      await wait(clampDelay(warmupQueue.options.delayMs));
    }
  }
}

function enqueueWarmupAssets(assets = [], options = {}) {
  const normalized = Array.isArray(assets)
    ? assets.map(normalizeAsset).map(toAbsoluteUrl).filter(Boolean)
    : [];

  if (!normalized.length) {
    return warmupQueue.promise || Promise.resolve();
  }

  const maxAssets = clampMaxAssets(options.maxAssets);
  const chunkSize = options.chunkSize;
  const delayMs = options.delayMs;

  if (Number.isFinite(chunkSize) && chunkSize > 0) {
    warmupQueue.options.chunkSize = clampChunkSize(chunkSize);
  }
  if (Number.isFinite(delayMs) && delayMs >= 0) {
    warmupQueue.options.delayMs = clampDelay(delayMs);
  }

  for (const asset of normalized.slice(0, maxAssets)) {
    if (warmupQueue.seen.has(asset)) {
      continue;
    }
    warmupQueue.seen.add(asset);
    warmupQueue.pending.push(asset);
  }

  if (!warmupQueue.running && warmupQueue.pending.length) {
    warmupQueue.running = true;
    warmupQueue.promise = processWarmupQueue().finally(() => {
      warmupQueue.running = false;
      warmupQueue.promise = null;
    });
  }

  return warmupQueue.promise || Promise.resolve();
}

self.addEventListener('install', (event) => {
  const manifestAssets = Array.isArray(self.__PRECACHE_MANIFEST)
    ? self.__PRECACHE_MANIFEST.map(normalizeAsset).filter(Boolean)
    : [];
  event.waitUntil((async () => {
    const precacheTargets = [...CORE_SHELL_ASSETS, ...manifestAssets];
    installWarmupAssets = [];
    try {
      const catalogAssets = await loadCatalogAssets();
      const essentials = catalogAssets?.essentials || [];
      const warmup = catalogAssets?.warmup || [];
      if (essentials.length) {
        precacheTargets.push(...essentials);
      }
      if (warmup.length) {
        installWarmupAssets = Array.from(new Set(warmup.map(toAbsoluteUrl).filter(Boolean)));
      }
    } catch (error) {
      console.warn('[sw] failed to load catalog assets', error);
    }
    await stashAssets(precacheTargets);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  const activationTasks = (async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
  })();

  const warmupPromise = installWarmupAssets.length
    ? enqueueWarmupAssets(installWarmupAssets).catch((error) => {
        console.warn('[sw] failed queued warmup', error);
      })
    : null;
  installWarmupAssets = [];

  if (warmupPromise) {
    event.waitUntil(Promise.all([activationTasks, warmupPromise]));
  } else {
    event.waitUntil(activationTasks);
  }
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;
  if (data.type === 'PRECACHE') {
    const assets = Array.isArray(data.assets) ? data.assets.map(normalizeAsset).filter(Boolean) : [];
    if (!assets.length) return;
    event.waitUntil(stashAssets(assets));
    return;
  }

  if (data.type === 'BACKGROUND_WARMUP') {
    const assets = Array.isArray(data.assets) ? data.assets : [];
    if (!assets.length) return;
    const options = {
      chunkSize: data.chunkSize,
      delayMs: data.delayMs,
      maxAssets: data.maxAssets,
    };
    event.waitUntil(enqueueWarmupAssets(assets, options));
  }
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
    return { essentials: [], warmup: [] };
  }

  const essentials = [];
  const warmup = [];
  const seen = new Set();

  const trackAsset = (url, hint, forceBucket) => {
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

    const bucket = forceBucket || (type === 'audio' || type === 'video' ? 'warmup' : 'essential');
    if (bucket === 'warmup') {
      warmup.push(absolute);
    } else {
      essentials.push(absolute);
    }
  };

  for (const game of catalog) {
    if (game && typeof game.playUrl === 'string') {
      trackAsset(game.playUrl, null, 'essential');
    }

    const firstFrames = normalizeList(game?.firstFrame);
    for (const frame of firstFrames) {
      trackAsset(frame, 'image', 'essential');
    }

    const metaSources = [game?.assets, game?.firstFrameAssets];
    for (const meta of metaSources) {
      if (!meta) continue;

      const sprites = normalizeList(meta.sprites || meta.images);
      const audio = normalizeList(meta.audio || meta.sounds);
      const videos = normalizeList(meta.video || meta.videos);
      const misc = normalizeList(meta.assets);

      for (const sprite of sprites) {
        trackAsset(sprite, 'image', 'essential');
      }
      for (const sound of audio) {
        trackAsset(sound, 'audio', 'warmup');
      }
      for (const video of videos) {
        trackAsset(video, 'video', 'warmup');
      }
      for (const asset of misc) {
        trackAsset(asset);
      }
    }
  }

  return { essentials, warmup };
}
