import { loadAudio, loadImage } from './assets.js';
import { getGameById } from './game-catalog.js';

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
  const meta =
    game?.assets ||
    game?.firstFrame ||
    game?.firstFrameAssets ||
    null;
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
      pending.push(loadImage(href, { slug }).catch(() => {}));
    } else if (type === 'audio') {
      pending.push(loadAudio(href, { slug }).catch(() => {}));
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
