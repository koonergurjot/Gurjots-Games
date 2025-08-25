// sw.js (root) — v3
const CACHE_VERSION = 'v3';
const RUNTIME = `runtime-${CACHE_VERSION}`;
const PRECACHE = `precache-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/games.json',
  '/games/pong/index.html',
  '/games/runner/index.html',
  '/games/asteroids/index.html',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await cache.addAll(PRECACHE_URLS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => ![PRECACHE, RUNTIME].includes(n)).map(n => caches.delete(n))
    );
    clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(RUNTIME);
        cache.put('/index.html', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(PRECACHE);
        return (await cache.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  if (isSameOrigin && (request.destination === 'script' || request.destination === 'style' || request.destination === 'image')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isSameOrigin && (url.pathname.endsWith('/games.json') || url.pathname.endsWith('.json'))) {
    event.respondWith(networkFirst(request));
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
    return cached || Response.error();
  }
}
