const CACHE_NAME = 'gg-v3_2-' + (self.registration ? self.registration.scope : Math.random());
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(['/','/index.html','/game.html','/js/bootstrap/gg.js','/js/bootstrap/dom.js','/js/preflight.js','/js/three-global-shim.js','/js/vendor/console-signature.mjs']);
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
  if (url.pathname.endsWith('.ts')) {
    const content = "import { OrbitControls as OC } from 'three/examples/jsm/controls/OrbitControls.js';\nexport const OrbitControls = OC;\nexport default OC;\n";
    event.respondWith(new Response(content, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } }));
    return;
  }
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs')) {
    event.respondWith((async () => {
      try { const fresh = await fetch(event.request, { cache: 'no-store' }); if (fresh && fresh.ok) return fresh; } catch (e) {}
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
