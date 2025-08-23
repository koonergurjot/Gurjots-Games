const CACHE = 'static';
const ASSETS = [
  'index.html',
  'main.js',
  'styles.css',
  'games/box3d/index.html',
  'games/pong/index.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        let path = new URL(e.request.url).pathname;
        if (path.endsWith('/')) {
          path += 'index.html';
        }
        path = path.replace(/^\//, '');
        const cached = await cache.match(path);
        return cached || fetch(e.request);
      })(),
    );
  }
});

