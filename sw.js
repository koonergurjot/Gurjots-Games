// sw.js — safe service worker with pass-through for games and scripts
const CACHE_NAME = 'gg-static-v1';

self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
  })());
  self.clients.claim();
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  try { cache.put(request, resp.clone()); } catch(_) {}
  return resp;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  const isGameAsset = url.pathname.startsWith('/games/');
  const isScript = req.destination === 'script' || url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs');

  if (isGameAsset || isScript) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(cacheFirst(req));
});
