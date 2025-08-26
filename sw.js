// Basic offline caching for hub + games
const VERSION = 'gg-v1.0.0';
const CORE = [
  '/', '/index.html', '/css/styles.css', '/js/app.js',
  '/js/injectBackButton.js', '/js/resizeCanvas.global.js',
  '/assets/logo.svg', '/assets/favicon.png', '/games.json',
  '/404.html'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))))
  self.clients.claim();
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;
  // Network-first for games.json, cache-first otherwise
  if (new URL(req.url).pathname.endsWith('/games.json')) {
    e.respondWith(
      fetch(req).then(res=>{
        const copy = res.clone();
        caches.open(VERSION).then(c=>c.put(req, copy));
        return res;
      }).catch(()=>caches.match(req))
    );
  } else {
    e.respondWith(
      caches.match(req).then(cached=> cached || fetch(req).catch(()=>caches.match('/index.html')) )
    );
  }
});
