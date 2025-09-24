import { warn } from '../tools/reporters/console-signature.js';
import { resolveGamePaths } from './game-paths.js';

export function registerSW() {
  if ('serviceWorker' in navigator) {
    const swUrl = new URL('../sw.js', import.meta.url);
    navigator.serviceWorker.register(swUrl.href).catch(err => {
      warn('shared', 'Service worker registration failed', err);
    });
  }
}

export async function cacheGameAssets(slug, files = ['index.html', 'main.js', 'thumb.png']) {
  if (!('serviceWorker' in navigator)) return;
  let base = `/games/${slug}/`;
  try {
    const { basePath } = await resolveGamePaths(slug);
    if (basePath) {
      base = basePath.endsWith('/') ? basePath : `${basePath}/`;
    }
  } catch (err) {
    warn('shared', 'Failed to resolve cache base path', err);
  }
  const assets = files.map((f) => {
    const trimmed = String(f || '').replace(/^\/+/, '');
    return `${base}${trimmed}`;
  });
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'PRECACHE', assets });
  }
}
