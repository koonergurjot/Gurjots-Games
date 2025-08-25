// sw.js — simple static cache
const CURRENT_CACHE = 'static-v2';
const ASSETS = ['/', '/index.html', '/styles.css', '/games.json'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CURRENT_CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CURRENT_CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});
