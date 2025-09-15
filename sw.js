const CACHE_NAME = 'gg-v3-' + (self.registration ? self.registration.scope : Math.random());
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(['/','/index.html','/game.html','/js/bootstrap/gg.js','/js/bootstrap/dom.js','/js/preflight.js','/js/three-global-shim.js','/js/vendor/console-signature.js'].filter(Boolean));
  })());
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith('.js')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request, { cache: 'no-store' });
        if (fresh && fresh.ok) return fresh;
      } catch (e) {}
      return caches.match(event.request) || fetch(event.request);
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const resp = await fetch(event.request);
      const cache = await caches.open(CACHE_NAME);
      cache.put(event.request, resp.clone());
      return resp;
    } catch (e) {
      return fetch(event.request);
    }
  })());
});
