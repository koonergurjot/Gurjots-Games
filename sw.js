// CACHE_VERSION bumped to ensure updated landing page is served immediately
const CACHE_VERSION = 'gg-v7';
const INDEX_HTML = `/index.html?v=${CACHE_VERSION}`;
const LANDING_CSS = `/css/landing.css?v=${CACHE_VERSION}`;
const LANDING_JS = `/js/landing.js?v=${CACHE_VERSION}`;
const CORE = [
  '/',
  INDEX_HTML,
  LANDING_CSS,
  LANDING_JS,
  '/css/styles.css',
  '/js/app.js',
  '/js/injectBackButton.js',
  '/js/resizeCanvas.global.js',
  '/js/canvasLoop.global.js',
  '/js/gameUtil.js',
  '/js/sfx.js',
  '/assets/logo.svg',
  '/assets/favicon.png',
  '/games.json',
  '/data/games.json',
  '/404.html'
];

try {
  importScripts('precache-manifest.js');
} catch (e) {
  // ignore if manifest can't be loaded
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      const assets = CORE.concat(self.__PRECACHE_MANIFEST || []);
      // cache.addAll would reject if any single asset fails; add individually instead
      return Promise.all(assets.map(a => cache.add(a).catch(() => {})));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_VERSION ? caches.delete(k) : undefined)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'PRECACHE') {
    caches.open(CACHE_VERSION).then(cache => cache.addAll(data.assets || []));
  }
});

function offlineFallback(req) {
  if (req.mode === 'navigate') {
    return caches.match(INDEX_HTML);
  }
  return caches.match('/404.html');
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Network-first for the landing page to avoid stale HTML
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(
      fetch(INDEX_HTML, { cache: 'no-store' }).catch(() => caches.match(INDEX_HTML))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(resp => {
        if (url.protocol.startsWith('http')) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
        }
        return resp;
      })
      .catch(() => {
        if (url.protocol.startsWith('http')) {
          return caches.match(request).then(r => r || offlineFallback(request));
        }
        return offlineFallback(request);
      })
  );
});
