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

function toPositiveNumber(value) {
  if (value == null) return 0;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num;
}

function toPositiveInt(value) {
  const num = toPositiveNumber(value);
  if (!num) return 0;
  return Math.floor(num);
}

function normalizeStripKey(src, frameWidth, frameHeight, opts) {
  const columns = toPositiveInt(opts?.columns ?? opts?.framesPerRow);
  const rows = toPositiveInt(opts?.rows ?? opts?.framesPerColumn);
  const total = toPositiveInt(opts?.totalFrames ?? opts?.frames ?? opts?.count);
  const width = toPositiveInt(frameWidth);
  const height = toPositiveInt(frameHeight);
  return `${src}|${width}|${height}|${columns}|${rows}|${total}`;
}

function computeStripMetadata(image, frameWidth, frameHeight, opts = {}) {
  const width = Math.max(0, image?.naturalWidth || image?.width || 0);
  const height = Math.max(0, image?.naturalHeight || image?.height || 0);
  if (!width || !height) {
    throw createError('strip image has no dimensions');
  }
  const hints = opts || {};
  const hintColumns = toPositiveInt(hints.columns ?? hints.framesPerRow);
  const hintRows = toPositiveInt(hints.rows ?? hints.framesPerColumn);
  const hintTotal = toPositiveInt(hints.totalFrames ?? hints.frames ?? hints.count);

  let columns = hintColumns;
  let rows = hintRows;
  let fw = toPositiveNumber(frameWidth);
  let fh = toPositiveNumber(frameHeight);

  if (!fw && columns) fw = width / columns;
  if (!fh && rows) fh = height / rows;

  if (!fw && hintTotal && rows) {
    columns = columns || Math.max(1, Math.ceil(hintTotal / rows));
    fw = columns ? width / columns : 0;
  }

  if (!fh && hintTotal && columns) {
    rows = rows || Math.max(1, Math.ceil(hintTotal / columns));
    fh = rows ? height / rows : 0;
  }

  if (!fw) fw = columns ? width / columns : width;
  if (!fh) fh = rows ? height / rows : fw || height;
  if (!fh) fh = height;

  fw = Math.max(1, Math.floor(fw));
  fh = Math.max(1, Math.floor(fh));

  if (!columns && fw) columns = Math.max(1, Math.floor(width / fw));
  if (!rows && fh) rows = Math.max(1, Math.floor(height / fh));

  if (!columns) columns = Math.max(1, hintTotal || 1);
  if (!rows) rows = Math.max(1, hintTotal ? Math.ceil(hintTotal / columns) : 1);

  const frameCount = hintTotal ? Math.min(hintTotal, columns * rows) : columns * rows;

  return Object.freeze({
    image,
    width,
    height,
    frameWidth: fw,
    frameHeight: fh,
    columns,
    rows,
    framesPerRow: columns,
    framesPerColumn: rows,
    frameCount,
  });
}

/**
 * Load an evenly spaced sprite strip and provide metadata describing its layout.
 * The helper reuses {@link loadImage} so cached images are shared and the
 * computed frame data is memoized for subsequent callers.
 *
 * @param {string} src - Image source URL.
 * @param {number} frameWidth - Optional fixed frame width (pixels).
 * @param {number} frameHeight - Optional fixed frame height (pixels).
 * @param {object} [opts] - Options forwarded to {@link loadImage} plus layout hints.
 * @param {string} [opts.slug] - Identifier used when reporting load errors.
 * @param {string} [opts.crossOrigin] - Cross-origin mode for the image request.
 * @param {number} [opts.columns] - Expected number of frames per row.
 * @param {number} [opts.rows] - Expected number of frame rows.
 * @param {number} [opts.totalFrames] - Total frames contained in the strip.
 * @returns {Promise<object>} Resolves with metadata containing the image, frame
 * dimensions, and counts.
 */
export function loadStrip(src, frameWidth, frameHeight, opts = {}) {
  if (!src) {
    const err = createError('strip src required');
    reportAssetError(opts?.slug, src, err);
    return Promise.reject(err);
  }
  const key = normalizeStripKey(src, frameWidth, frameHeight, opts);
  if (stripCache.has(key)) {
    return Promise.resolve(stripCache.get(key));
  }
  if (stripPromises.has(key)) {
    return stripPromises.get(key);
  }
  const promise = loadImage(src, opts)
    .then((image) => {
      try {
        const metadata = computeStripMetadata(image, frameWidth, frameHeight, opts);
        stripCache.set(key, metadata);
        return metadata;
      } catch (err) {
        reportAssetError(opts?.slug, src, err);
        throw err;
      } finally {
        stripPromises.delete(key);
      }
    })
    .catch((err) => {
      stripPromises.delete(key);
      throw err;
    });
  stripPromises.set(key, promise);
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
