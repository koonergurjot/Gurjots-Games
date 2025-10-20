import { warn } from '../tools/reporters/console-signature.js';

const PRECACHE_QUEUE = new Set();
let flushTimer = null;
let controllerListenerAttached = false;
const SW_BLOCKED_HOST_PATTERNS = [/\.workers\.dev$/i, /\.cloudflareworkers\.com$/i];
let swBlockedReasonLogged = false;

function isServiceWorkerUsable() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  if (!('serviceWorker' in navigator)) {
    return false;
  }
  const { protocol, hostname } = window.location || {};
  if (protocol && protocol !== 'https:' && protocol !== 'http:') {
    return false;
  }
  if (hostname && SW_BLOCKED_HOST_PATTERNS.some(pattern => pattern.test(hostname))) {
    if (!swBlockedReasonLogged) {
      swBlockedReasonLogged = true;
      warn('shared', 'Skipping service worker registration on restricted host', hostname);
    }
    return false;
  }
  return true;
}

function attachControllerListener() {
  if (controllerListenerAttached || !isServiceWorkerUsable()) return;
  controllerListenerAttached = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    scheduleFlush(0);
  });
}

function normalizeAssetCandidate(asset) {
  if (!asset) return null;
  let url = null;
  if (typeof asset === 'string') {
    url = asset;
  } else if (typeof asset === 'object' && typeof asset.url === 'string') {
    url = asset.url;
  }
  if (!url) return null;
  try {
    const normalized = new URL(url, window.location.origin);
    normalized.hash = '';
    return normalized.href;
  } catch (_) {
    return null;
  }
}

function scheduleFlush(delay = 0) {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, delay);
}

async function flushQueue() {
  if (!PRECACHE_QUEUE.size) return;
  if (!isServiceWorkerUsable()) {
    PRECACHE_QUEUE.clear();
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const controller = navigator.serviceWorker.controller || registration?.active || registration?.waiting || null;
    if (!controller) {
      scheduleFlush(250);
      return;
    }
    const assets = Array.from(PRECACHE_QUEUE);
    PRECACHE_QUEUE.clear();
    controller.postMessage({ type: 'PRECACHE', assets });
  } catch (err) {
    warn('shared', 'Failed to flush precache queue', err);
    scheduleFlush(1000);
  }
}

export function registerSW() {
  if (!isServiceWorkerUsable()) return;
  let swUrl;
  try {
    swUrl = new URL('../sw.js', import.meta.url);
  } catch (error) {
    warn('shared', 'Unable to resolve service worker URL', error);
    return;
  }
  attachControllerListener();
  navigator.serviceWorker.register(swUrl.href).then(() => {
    scheduleFlush(0);
  }).catch(err => {
    warn('shared', 'Service worker registration failed', err);
  });
}

export function precacheAssets(assets) {
  if (!isServiceWorkerUsable()) return;
  const list = Array.isArray(assets) ? assets : [assets];
  let added = false;
  for (const asset of list) {
    const normalized = normalizeAssetCandidate(asset);
    if (!normalized) continue;
    if (!PRECACHE_QUEUE.has(normalized)) {
      PRECACHE_QUEUE.add(normalized);
      added = true;
    }
  }
  if (!added) return;
  attachControllerListener();
  scheduleFlush(0);
}

export function cacheGameAssets(slug, files = ['index.html', 'main.js', 'thumb.svg']) {
  if (!slug || !Array.isArray(files) || !files.length) return;
  const baseUrl = new URL(`/games/${slug}/`, window.location.origin);
  const assets = files.map(file => {
    try {
      return new URL(file, baseUrl).href;
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
  if (!assets.length) return;
  precacheAssets(assets);
}
