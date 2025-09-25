import { getGameById } from './game-catalog.js';

const reportedFailures = new Set();

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean);
  return [];
}

function ensureLink(href, as) {
  if (!href || !as || typeof document === 'undefined') return;
  const existing = document.head.querySelector(`link[rel="preload"][href="${href}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = as;
  link.href = href;
  if (as === 'audio') link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

function toAbsoluteUrl(url) {
  try {
    return new URL(url, document.baseURI).href;
  } catch (_) {
    return url;
  }
}

function reportAssetError(slug, url, err) {
  const key = `${slug}|${url}`;
  if (reportedFailures.has(key)) return;
  reportedFailures.add(key);
  const message = `[assets] failed to load ${url}: ${err?.message || err || 'unknown error'}`;
  console.error(message);
  try {
    window.parent?.postMessage?.({
      type: 'GAME_ERROR',
      slug,
      message: `First-frame asset failed to load: ${url}`
    }, '*');
  } catch (_) {}
}

function loadImage(url, slug) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = (event) => {
      cleanup();
      const err = event?.error || new Error('image load error');
      reportAssetError(slug, url, err);
      reject(err);
    };
    function cleanup() {
      img.removeEventListener('load', done);
      img.removeEventListener('error', fail);
    }
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', fail, { once: true });
    img.src = url;
  });
}

function loadAudio(url, slug) {
  return new Promise((resolve, reject) => {
    try {
      const audio = new Audio();
      audio.preload = 'auto';
      const done = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        const err = new Error('audio load error');
        cleanup();
        reportAssetError(slug, url, err);
        reject(err);
      };
      function cleanup() {
        audio.removeEventListener('canplaythrough', done);
        audio.removeEventListener('loadeddata', done);
        audio.removeEventListener('error', fail);
      }
      audio.addEventListener('canplaythrough', done, { once: true });
      audio.addEventListener('loadeddata', done, { once: true });
      audio.addEventListener('error', fail, { once: true });
      audio.src = url;
      audio.load();
    } catch (err) {
      reportAssetError(slug, url, err);
      reject(err);
    }
  });
}

function classifyAsset(url, hint) {
  if (hint === 'audio' || /\.(mp3|ogg|wav|m4a)(\?.*)?$/i.test(url)) return 'audio';
  if (hint === 'image' || /\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(url)) return 'image';
  return null;
}

export async function preloadFirstFrameAssets(slug) {
  if (!slug) return;
  let game = null;
  try {
    game = await getGameById(slug);
  } catch (err) {
    console.warn('[assets] unable to read catalog for slug', slug, err);
  }
  const meta = game?.firstFrame || game?.firstFrameAssets || null;
  if (!meta) return;
  const sprites = normalizeList(meta.sprites || meta.images);
  const audio = normalizeList(meta.audio || meta.sounds);
  const misc = normalizeList(meta.assets);
  const pending = [];
  const seen = new Set();
  for (const raw of [...sprites, ...audio, ...misc]) {
    const href = toAbsoluteUrl(raw);
    const type = classifyAsset(href, sprites.includes(raw) ? 'image' : (audio.includes(raw) ? 'audio' : null));
    if (!type) continue;
    const key = `${type}|${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ensureLink(href, type);
    if (type === 'image') {
      pending.push(loadImage(href, slug).catch(() => {}));
    } else if (type === 'audio') {
      pending.push(loadAudio(href, slug).catch(() => {}));
    }
  }
  if (pending.length) {
    try {
      await Promise.allSettled(pending);
    } catch (_) {
      // handled per-asset
    }
  }
}

export default preloadFirstFrameAssets;
