const reportedFailures = new Set();
const globalWindow = typeof window !== 'undefined' ? window : null;

function reportAssetError(slug, url, err) {
  const key = `${slug || 'unknown'}|${url}`;
  if (reportedFailures.has(key)) return;
  reportedFailures.add(key);
  const detail = `[assets] failed to load ${url}: ${err?.message || err || 'unknown error'}`;
  console.error(detail);
  try {
    globalWindow?.parent?.postMessage?.({
      type: 'GAME_ERROR',
      slug,
      error: detail,
      message: detail
    }, '*');
  } catch (_) {}
}

function createError(message) {
  return new Error(message);
}

const imageCache = new Map();
const audioCache = new Map();
const imagePromises = new Map();
const audioPromises = new Map();

export { imageCache, audioCache };

export function getCachedImage(src) {
  return imageCache.get(src) || null;
}

export function getCachedAudio(src) {
  return audioCache.get(src) || null;
}

export function loadImage(src, opts = {}) {
  const { slug, crossOrigin } = opts;
  if (!src) {
    const err = createError('image src required');
    reportAssetError(slug, src, err);
    return Promise.reject(err);
  }
  if (imageCache.has(src)) {
    return Promise.resolve(imageCache.get(src));
  }
  if (imagePromises.has(src)) {
    return imagePromises.get(src);
  }
  if (typeof Image === 'undefined') {
    const err = createError('Image constructor not available');
    reportAssetError(slug, src, err);
    return Promise.reject(err);
  }
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    if (crossOrigin) img.crossOrigin = crossOrigin;
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      imagePromises.delete(src);
    };
    const onLoad = () => {
      cleanup();
      imageCache.set(src, img);
      resolve(img);
    };
    const onError = (event) => {
      cleanup();
      const err = event?.error || createError('image load error');
      reportAssetError(slug, src, err);
      reject(err);
    };
    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
    try {
      img.src = src;
    } catch (err) {
      cleanup();
      reportAssetError(slug, src, err);
      reject(err);
    }
  });
  imagePromises.set(src, promise);
  promise.catch(() => {
    imagePromises.delete(src);
  });
  return promise;
}

export function loadAudio(src, opts = {}) {
  const { slug, crossOrigin = 'anonymous', preload = 'auto' } = opts;
  if (!src) {
    const err = createError('audio src required');
    reportAssetError(slug, src, err);
    return Promise.reject(err);
  }
  if (audioCache.has(src)) {
    return Promise.resolve(audioCache.get(src));
  }
  if (audioPromises.has(src)) {
    return audioPromises.get(src);
  }
  if (typeof Audio === 'undefined') {
    const err = createError('Audio constructor not available');
    reportAssetError(slug, src, err);
    return Promise.reject(err);
  }
  const promise = new Promise((resolve, reject) => {
    try {
      const audio = new Audio();
      audio.preload = preload;
      if (crossOrigin) audio.crossOrigin = crossOrigin;
      const cleanup = () => {
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('loadeddata', onReady);
        audio.removeEventListener('error', onError);
        audioPromises.delete(src);
      };
      const onReady = () => {
        cleanup();
        audioCache.set(src, audio);
        resolve(audio);
      };
      const onError = () => {
        cleanup();
        const err = createError('audio load error');
        reportAssetError(slug, src, err);
        reject(err);
      };
      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener('loadeddata', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });
      audio.src = src;
      audio.load();
    } catch (err) {
      audioPromises.delete(src);
      reportAssetError(slug, src, err);
      reject(err);
    }
  });
  audioPromises.set(src, promise);
  promise.catch(() => {
    audioPromises.delete(src);
  });
  return promise;
}

export function drawTiledBackground(ctx, image, x, y, width, height) {
  if (!ctx || typeof ctx.drawImage !== 'function') return;
  if (width <= 0 || height <= 0) return;
  const img = typeof image === 'string' ? getCachedImage(image) : image;
  const tileW = img?.naturalWidth || img?.width;
  const tileH = img?.naturalHeight || img?.height;
  if (!img || !tileW || !tileH || tileW <= 0 || tileH <= 0) return;
  const prevSmoothing = ctx.imageSmoothingEnabled;
  const hasSave = typeof ctx.save === 'function' && typeof ctx.restore === 'function';
  if (hasSave) ctx.save();
  ctx.imageSmoothingEnabled = false;
  let drew = false;
  if (typeof ctx.createPattern === 'function') {
    try {
      const pattern = ctx.createPattern(img, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(x, y, width, height);
        drew = true;
      }
    } catch (_) {}
  }
  if (!drew) {
    const maxX = x + width;
    const maxY = y + height;
    for (let drawY = y; drawY < maxY; drawY += tileH) {
      const remainingH = Math.min(tileH, maxY - drawY);
      for (let drawX = x; drawX < maxX; drawX += tileW) {
        const remainingW = Math.min(tileW, maxX - drawX);
        ctx.drawImage(
          img,
          0,
          0,
          remainingW,
          remainingH,
          drawX,
          drawY,
          remainingW,
          remainingH
        );
      }
    }
  }
  if (hasSave) {
    ctx.restore();
    ctx.imageSmoothingEnabled = prevSmoothing;
  } else {
    ctx.imageSmoothingEnabled = prevSmoothing;
  }
}
