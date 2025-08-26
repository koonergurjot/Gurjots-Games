// sw.js — simple versioned worker
const CACHE_VERSION = 'fresh-v1';
const PRECACHE = `precache-${CACHE_VERSION}`;
const RUNTIME = `runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = ['/', '/index.html', '/styles.css', '/games.json'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await cache.addAll(PRECACHE_URLS.filter(Boolean));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![PRECACHE, RUNTIME].includes(k)).map(k => caches.delete(k)));
    clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const resp = await networkFirst(req);
      return resp.type === 'error' ? networkFirst('/index.html') : resp;
    })());
    return;
  }

  if (same && (url.pathname.endsWith('.json'))) {
    event.respondWith(networkFirst(req));
    return;
  }

  if (same && (req.destination === 'style' || req.destination === 'script' || req.destination === 'image')) {
    event.respondWith(cacheFirst(req));
    return;
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  cache.put(request, resp.clone());
  return resp;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME);
  try {
    const resp = await fetch(request);
    cache.put(request, resp.clone());
    return resp;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (typeof request === 'string') return caches.match(request);
    return Response.error();
  }
}
