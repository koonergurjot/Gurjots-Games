const VERSION = 'gg-v6';
const CORE = [
  '/',
  '/index.html',
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
    caches.open(VERSION).then(cache => {
      const assets = CORE.concat(self.__PRECACHE_MANIFEST || []);
      return cache.addAll(assets);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== VERSION ? caches.delete(k) : undefined)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'PRECACHE') {
    caches.open(VERSION).then(cache => cache.addAll(data.assets || []));
  }
});

function offlineFallback(req) {
  if (req.mode === 'navigate') {
    return caches.match('/index.html');
  }
  return caches.match('/404.html');
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    fetch(request)
      .then(resp => {
        const url = new URL(request.url);
        if (url.protocol.startsWith('http')) {
          const copy = resp.clone();
          caches.open(VERSION).then(cache => cache.put(request, copy));
        }
        return resp;
      })
      .catch(err => {
        const url = new URL(request.url);
        if (url.protocol.startsWith('http')) {
          return caches.match(request).then(r => r || offlineFallback(request));
        }
        throw err;
      })
  );
});
