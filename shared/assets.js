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
const stripCache = new Map();
const imagePromises = new Map();
const audioPromises = new Map();
const stripPromises = new Map();

export { imageCache, audioCache, stripCache };

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

/**
 * Load a sprite strip (sprite sheet) and return metadata describing its layout.
 * Cached metadata ensures repeated calls are cheap and leverage the image cache.
 */
export function loadStrip(src, frameWidth, frameHeight, opts = {}) {
  const {
    slug,
    framesPerRow: requestedRows = 0,
    framesPerColumn: requestedColumns = 0,
    totalFrames: requestedTotal = 0,
    image: providedImage = null,
  } = opts;

  if (!src) {
    const err = createError('strip src required');
    reportAssetError(slug, src, err);
    return Promise.reject(err);
  }

  const cacheKey = [
    src,
    Number.isFinite(frameWidth) ? Number(frameWidth) : 0,
    Number.isFinite(frameHeight) ? Number(frameHeight) : 0,
    Number.isFinite(requestedRows) ? Number(requestedRows) : 0,
    Number.isFinite(requestedColumns) ? Number(requestedColumns) : 0,
    Number.isFinite(requestedTotal) ? Number(requestedTotal) : 0,
  ].join('|');

  if (stripCache.has(cacheKey)) {
    return Promise.resolve(stripCache.get(cacheKey));
  }
  if (stripPromises.has(cacheKey)) {
    return stripPromises.get(cacheKey);
  }

  const loadPromise = (providedImage
    ? Promise.resolve(providedImage)
    : loadImage(src, opts)
  ).then((image) => {
    if (!image) {
      throw createError('strip image unavailable');
    }

    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;

    let frameW = Number.isFinite(frameWidth) ? Number(frameWidth) : 0;
    let frameH = Number.isFinite(frameHeight) ? Number(frameHeight) : 0;
    const reqRows = Number.isFinite(requestedRows) ? Number(requestedRows) : 0;
    const reqCols = Number.isFinite(requestedColumns) ? Number(requestedColumns) : 0;
    const reqTotal = Number.isFinite(requestedTotal) ? Number(requestedTotal) : 0;

    const safeDiv = (value, divisor) => {
      if (!divisor) return 0;
      return Math.floor(value / divisor);
    };

    if (reqRows > 0 && frameW <= 0 && width > 0) {
      frameW = safeDiv(width, reqRows) || 0;
    }
    if (reqCols > 0 && frameH <= 0 && height > 0) {
      frameH = safeDiv(height, reqCols) || 0;
    }

    if (frameW <= 0 && frameH > 0) {
      frameW = frameH;
    }
    if (frameH <= 0 && frameW > 0) {
      frameH = frameW;
    }

    if ((frameW <= 0 || frameH <= 0) && width > 0 && height > 0) {
      const square = Math.min(width, height);
      if (frameW <= 0) frameW = square || width;
      if (frameH <= 0) frameH = square || height;
    }

    if (frameW <= 0 && width > 0) frameW = width;
    if (frameH <= 0 && height > 0) frameH = height;
    if (frameW <= 0) frameW = 1;
    if (frameH <= 0) frameH = 1;

    let framesPerRow = Math.max(1, safeDiv(width, frameW) || 1);
    let framesPerColumn = Math.max(1, safeDiv(height, frameH) || 1);

    if (reqRows > 0) {
      framesPerRow = Math.max(1, reqRows);
      if (frameW <= 0 && width > 0) {
        frameW = safeDiv(width, framesPerRow) || frameW;
      }
    }
    if (reqCols > 0) {
      framesPerColumn = Math.max(1, reqCols);
      if (frameH <= 0 && height > 0) {
        frameH = safeDiv(height, framesPerColumn) || frameH;
      }
    }

    let frameCount = framesPerRow * framesPerColumn;
    if (reqTotal > 0) {
      const total = Math.max(1, reqTotal);
      frameCount = Math.min(total, frameCount);
      if (reqRows > 0 && reqCols <= 0) {
        framesPerColumn = Math.max(1, Math.ceil(frameCount / framesPerRow));
        if (height > 0) {
          frameH = safeDiv(height, framesPerColumn) || frameH;
        }
      } else if (reqCols > 0 && reqRows <= 0) {
        framesPerRow = Math.max(1, Math.ceil(frameCount / framesPerColumn));
        if (width > 0) {
          frameW = safeDiv(width, framesPerRow) || frameW;
        }
      } else if (reqRows <= 0 && reqCols <= 0) {
        framesPerRow = Math.max(1, Math.min(frameCount, framesPerRow));
        framesPerColumn = Math.max(1, Math.ceil(frameCount / framesPerRow));
        if (width > 0) {
          frameW = safeDiv(width, framesPerRow) || frameW;
        }
        if (height > 0) {
          frameH = safeDiv(height, framesPerColumn) || frameH;
        }
      }
    }

    if (frameW <= 0) frameW = 1;
    if (frameH <= 0) frameH = 1;

    const metadata = {
      image,
      width,
      height,
      frameWidth: frameW,
      frameHeight: frameH,
      framesPerRow,
      framesPerColumn,
      frameCount,
    };

    stripCache.set(cacheKey, metadata);
    stripPromises.delete(cacheKey);
    return metadata;
  });

  stripPromises.set(cacheKey, loadPromise);
  loadPromise.catch(() => {
    stripPromises.delete(cacheKey);
  });
  return loadPromise;
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
