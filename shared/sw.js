export function registerSW() {
  if ('serviceWorker' in navigator) {
    const swUrl = new URL('../sw.js', import.meta.url);
    navigator.serviceWorker.register(swUrl.href).catch(err => {
      console.warn('Service worker registration failed', err);
    });
  }
}

export function cacheGameAssets(slug, files = ['index.html', 'main.js', 'thumb.png']) {
  if (!('serviceWorker' in navigator)) return;
  const base = `/games/${slug}/`;
  const assets = files.map(f => base + f);
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'PRECACHE', assets });
  }
}
