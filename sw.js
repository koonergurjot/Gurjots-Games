const CACHE = 'arcade-v1';
const ASSETS = [
  "./",
  "./index.html",
  "./games.json",
  "./main.js",
  "./manifest.json",
  "./icon.svg",
  "./shared/ui.js",
  "./games/pong/index.html",
  "./games/box3d/index.html",
  "./games/box3d/main.js"
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
});
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
