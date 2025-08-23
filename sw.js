const CACHE = 'static';

async function getAssets() {
  const assets = ['index.html', 'styles.css'];
  try {
    const res = await fetch('games.json');
    assets.push('games.json');
    const games = await res.json();
    for (const g of games) {
      let path = g.path.replace(/^\.\//, '');
      if (!path.endsWith('/')) path += '/';
      assets.push(`${path}index.html`);
    }
  } catch (err) {
    console.warn('Failed to load games.json', err);
  }
  return assets;
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const assets = await getAssets();
      await cache.addAll(assets);
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

