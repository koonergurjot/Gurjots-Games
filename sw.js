// v1.1 service worker (safe, minimal).
// CACHE_VERSION bumped to force users to receive the new landing right away.
const CACHE_VERSION = 'gg-v3-20250911162413';
const PRECACHE = 'precache-' + CACHE_VERSION;
const RUNTIME = 'runtime-' + CACHE_VERSION;

// This manifest is generated/edited separately; imported below.
self.addEventListener('install', (event) => {
  self.skipWaiting(); // ensure new SW activates immediately
  event.waitUntil(
    caches.open(PRECACHE).then(async (cache) => {
      const urls = (self.__GG_PRECACHE_MANIFEST || []);
      await cache.addAll(urls);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Claim clients so the updated SW controls pages without reload
    await self.clients.claim();
    // Clean up old caches
    const names = await caches.keys();
    await Promise.all(names.map(n => (n.includes('gg-v3-') || n.includes(CACHE_VERSION)) ? null : caches.delete(n)));
  })());
});

// network-first for navigations (index.html), cache-first for others
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(RUNTIME);
        cache.put(req, net.clone());
        return net;
      } catch (e) {
        const cache = await caches.open(PRECACHE);
        const cached = await cache.match(req) || await cache.match('/index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  // cache-first for static assets
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const net = await fetch(req);
      // only cache same-origin GET requests
      if (req.method === 'GET' && new URL(req.url).origin === location.origin) {
        cache.put(req, net.clone());
      }
      return net;
    } catch (e) {
      const precache = await caches.open(PRECACHE);
      const fallback = await precache.match(req);
      return fallback || Response.error();
    }
  })());
});
