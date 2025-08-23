export function registerSW() {
  if ('serviceWorker' in navigator) {
    const swUrl = new URL('../sw.js', import.meta.url);
    navigator.serviceWorker.register(swUrl.href).catch(err => {
      console.warn('Service worker registration failed', err);
    });
  }
}
