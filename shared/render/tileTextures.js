const globalScope = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null;

const textureRegistry = Object.freeze({
  block: Object.freeze({ src: '/assets/tilesets/grass.png', repeat: 'repeat' }),
  brick: Object.freeze({ src: '/assets/tilesets/dirt.png', repeat: 'repeat' }),
  lava: Object.freeze({ src: '/assets/tilesets/stone.png', repeat: 'repeat-x' }),
  industrial: Object.freeze({ src: '/assets/tilesets/industrial.png', repeat: 'repeat' }),
});

const gemSprite = Object.freeze({
  src: '/assets/sprites/collectibles/gem_blue.png',
  frame: Object.freeze({ sx: 0, sy: 0, sw: 32, sh: 32 }),
});

const keySprite = Object.freeze({
  src: '/assets/sprites/collectibles/key.png',
  frame: Object.freeze({ sx: 0, sy: 0, sw: 32, sh: 32 }),
});

const doorSprite = Object.freeze({
  src: '/assets/sprites/collectibles/door.png',
  frame: Object.freeze({ sx: 0, sy: 0, sw: 32, sh: 48 }),
});

const checkpointSprite = Object.freeze({
  src: '/assets/sprites/collectibles/checkpoint_flag.png',
  frame: Object.freeze({ sx: 0, sy: 0, sw: 32, sh: 48 }),
});

const cloudSpriteOne = Object.freeze({
  src: '/assets/effects/clouds/cloud1.png',
  frame: Object.freeze({ sx: 0, sy: 0, sw: 128, sh: 64 }),
});

const cloudSpriteTwo = Object.freeze({
  src: '/assets/effects/clouds/cloud2.png',
  frame: Object.freeze({ sx: 0, sy: 0, sw: 128, sh: 64 }),
});

const portalSprite = Object.freeze({
  src: '/assets/effects/portal.png',
  frame: Object.freeze({ sx: 0, sy: 0, sw: 256, sh: 64 }),
});

const spriteRegistry = Object.freeze({
  gem: gemSprite,
  coin: gemSprite,
  key: keySprite,
  goal: doorSprite,
  door: doorSprite,
  checkpoint: checkpointSprite,
  cloud1: cloudSpriteOne,
  cloud2: cloudSpriteTwo,
  portal: portalSprite,
});

const imageCache = new Map();
const imagePromises = new Map();
const patternCache = new WeakMap();

const biomeOverlayRegistry = Object.freeze({
  default: Object.freeze({
    tint: 'rgba(62, 90, 133, 0.24)',
    topHighlight: 'rgba(214, 226, 255, 0.16)',
    topHighlightHeight: 5,
    bottomShade: 'rgba(8, 12, 21, 0.22)',
    bottomShadeHeight: 5,
  }),
  'default-hazard': Object.freeze({
    tint: 'rgba(199, 92, 92, 0.28)',
    topHighlight: 'rgba(255, 222, 222, 0.18)',
    topHighlightHeight: 4,
  }),
  forest: Object.freeze({
    pattern: 'block',
    patternAlpha: 0.16,
    tint: 'rgba(64, 117, 86, 0.26)',
    topHighlight: 'rgba(186, 238, 196, 0.2)',
    topHighlightHeight: 6,
    bottomShade: 'rgba(16, 24, 19, 0.24)',
    bottomShadeHeight: 6,
  }),
  'forest-hazard': Object.freeze({
    pattern: 'lava',
    patternAlpha: 0.12,
    tint: 'rgba(196, 96, 76, 0.3)',
    topHighlight: 'rgba(255, 210, 190, 0.18)',
    topHighlightHeight: 5,
  }),
  cavern: Object.freeze({
    pattern: 'lava',
    patternAlpha: 0.2,
    tint: 'rgba(72, 86, 130, 0.28)',
    topHighlight: 'rgba(164, 186, 230, 0.18)',
    topHighlightHeight: 5,
    bottomShade: 'rgba(10, 16, 28, 0.25)',
    bottomShadeHeight: 7,
  }),
  'cavern-hazard': Object.freeze({
    pattern: 'lava',
    patternAlpha: 0.14,
    tint: 'rgba(204, 108, 92, 0.3)',
    topHighlight: 'rgba(255, 194, 176, 0.2)',
    topHighlightHeight: 4,
  }),
  industrial: Object.freeze({
    pattern: 'industrial',
    patternAlpha: 0.18,
    tint: 'rgba(164, 148, 112, 0.28)',
    topHighlight: 'rgba(255, 224, 170, 0.18)',
    topHighlightHeight: 5,
    stripe: 'rgba(46, 42, 38, 0.3)',
    stripeWidth: 6,
    stripeAlpha: 0.24,
  }),
  'industrial-hazard': Object.freeze({
    pattern: 'industrial',
    patternAlpha: 0.16,
    tint: 'rgba(210, 104, 96, 0.3)',
    topHighlight: 'rgba(255, 206, 202, 0.18)',
    topHighlightHeight: 4,
    stripe: 'rgba(80, 30, 28, 0.32)',
    stripeWidth: 5,
    stripeAlpha: 0.26,
  }),
});

function createImage(src) {
  if (imageCache.has(src)) {
    return Promise.resolve(imageCache.get(src));
  }
  if (imagePromises.has(src)) {
    return imagePromises.get(src);
  }
  if (!globalScope || typeof globalScope.Image !== 'function') {
    return Promise.resolve(null);
  }
  const promise = new Promise((resolve, reject) => {
    const img = new globalScope.Image();
    try {
      img.decoding = 'async';
    } catch (_) {
      /* noop */
    }
    if ('loading' in img) {
      img.loading = 'eager';
    }
    img.onload = () => {
      imageCache.set(src, img);
      imagePromises.delete(src);
      resolve(img);
    };
    img.onerror = (err) => {
      imagePromises.delete(src);
      reject(err);
    };
    img.src = src;
  });
  imagePromises.set(src, promise);
  return promise;
}

function uniqueSources() {
  const sources = new Set();
  Object.values(textureRegistry).forEach((def) => sources.add(def.src));
  Object.values(spriteRegistry).forEach((def) => sources.add(def.src));
  return Array.from(sources);
}

export function preloadTileTextures() {
  return Promise.all(
    uniqueSources().map((src) =>
      createImage(src).catch(() => {
        // Ignore failures so other textures can continue loading.
        return null;
      }),
    ),
  );
}

export function getTilePattern(ctx, key) {
  if (!ctx || typeof ctx.createPattern !== 'function') return null;
  const texture = textureRegistry[key];
  if (!texture) return null;
  let ctxCache = patternCache.get(ctx);
  if (!ctxCache) {
    ctxCache = new Map();
    patternCache.set(ctx, ctxCache);
  }
  if (ctxCache.has(key)) {
    return ctxCache.get(key);
  }
  const image = imageCache.get(texture.src);
  if (!image) return null;
  const pattern = ctx.createPattern(image, texture.repeat || 'repeat');
  if (!pattern) return null;
  ctxCache.set(key, pattern);
  return pattern;
}

function resolveSpriteDefinition(keyOrDef) {
  if (!keyOrDef) return null;
  if (typeof keyOrDef === 'string') {
    return spriteRegistry[keyOrDef] || null;
  }
  if (typeof keyOrDef === 'object') {
    if (keyOrDef.src && keyOrDef.frame) return keyOrDef;
    if (keyOrDef.key && spriteRegistry[keyOrDef.key]) {
      return spriteRegistry[keyOrDef.key];
    }
  }
  return null;
}

function imageForSprite(def) {
  if (!def) return null;
  const cached = imageCache.get(def.src);
  if (cached) return cached;
  if (!globalScope || typeof globalScope.Image !== 'function') return null;
  // Kick off loading if it hasn't started yet.
  createImage(def.src).catch(() => null);
  return null;
}

export function drawTileSprite(ctx, keyOrDef, dx, dy, dw, dh, frameOverride) {
  if (!ctx || typeof ctx.drawImage !== 'function') return false;
  const def = resolveSpriteDefinition(keyOrDef);
  if (!def) return false;
  const image = imageForSprite(def);
  if (!image) return false;
  const frame = frameOverride || def.frame;
  if (!frame) return false;
  const width = typeof dw === 'number' ? dw : frame.sw;
  const height = typeof dh === 'number' ? dh : frame.sh;
  ctx.drawImage(image, frame.sx, frame.sy, frame.sw, frame.sh, dx, dy, width, height);
  return true;
}

export function getSpriteFrame(key) {
  if (!key) return null;
  const normalizedKey = key === 'coin' ? 'gem' : key;
  return spriteRegistry[normalizedKey]?.frame ?? null;
}

function applyStripeOverlay(ctx, color, dx, dy, size, width, alpha) {
  const stripeWidth = Math.max(2, Math.min(size, Math.floor(width ?? size / 5)));
  ctx.globalAlpha = typeof alpha === 'number' ? alpha : 0.25;
  ctx.fillStyle = color;
  for (let x = 0; x < size; x += stripeWidth * 2) {
    ctx.fillRect(dx + x, dy, stripeWidth, size);
  }
}

export function drawTileOverlay(ctx, key, dx, dy, size, options = {}) {
  if (!ctx || typeof ctx.fillRect !== 'function') return false;
  const def = biomeOverlayRegistry[key] || biomeOverlayRegistry.default;
  if (!def) return false;
  let drawn = false;
  ctx.save();
  try {
    if (def.pattern) {
      const pattern = getTilePattern(ctx, def.pattern);
      if (pattern) {
        ctx.globalAlpha = typeof def.patternAlpha === 'number' ? def.patternAlpha : 0.18;
        ctx.fillStyle = pattern;
        ctx.fillRect(dx, dy, size, size);
        drawn = true;
      }
    }
    if (def.tint) {
      ctx.globalAlpha = typeof def.tintAlpha === 'number' ? def.tintAlpha : 0.24;
      ctx.fillStyle = def.tint;
      ctx.fillRect(dx, dy, size, size);
      drawn = true;
    }
    if (def.stripe) {
      applyStripeOverlay(ctx, def.stripe, dx, dy, size, def.stripeWidth, def.stripeAlpha);
      drawn = true;
    }
    if (def.topHighlight && options.topExposed) {
      const height = Math.max(2, Math.min(size, def.topHighlightHeight ?? Math.ceil(size * 0.18)));
      ctx.globalAlpha = typeof def.topHighlightAlpha === 'number' ? def.topHighlightAlpha : 0.4;
      ctx.fillStyle = def.topHighlight;
      ctx.fillRect(dx, dy, size, height);
      drawn = true;
    }
    if (def.bottomShade) {
      const height = Math.max(2, Math.min(size, def.bottomShadeHeight ?? Math.ceil(size * 0.18)));
      ctx.globalAlpha = typeof def.bottomShadeAlpha === 'number' ? def.bottomShadeAlpha : 0.24;
      ctx.fillStyle = def.bottomShade;
      ctx.fillRect(dx, dy + size - height, size, height);
      drawn = true;
    }
  } finally {
    ctx.restore();
  }
  return drawn;
}

export const tileTextureDefinitions = textureRegistry;
export const tileSpriteDefinitions = spriteRegistry;
export const tileOverlayDefinitions = biomeOverlayRegistry;
