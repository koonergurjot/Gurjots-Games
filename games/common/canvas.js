const DEFAULT_BASE_WIDTH = 1280;
const DEFAULT_BASE_HEIGHT = 720;
const DEFAULT_GUTTER = 24;
const DESKTOP_MAX_DPR = 3;
const MOBILE_MAX_DPR = 2;

const MOBILE_UA_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

const SKIP_CONTEXT_SYMBOL = typeof Symbol === 'function'
  ? Symbol.for('ggshell.canvas.skip2dContext')
  : null;

function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  if (typeof navigator !== 'undefined' && MOBILE_UA_PATTERN.test(navigator.userAgent || '')) {
    return true;
  }
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches) {
      return true;
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

function clampDpr(value, maxDpr) {
  const native = Number.isFinite(value) ? value : 1;
  const max = Number.isFinite(maxDpr) ? maxDpr : (isMobileViewport() ? MOBILE_MAX_DPR : DESKTOP_MAX_DPR);
  return Math.max(1, Math.min(native || 1, max));
}

function coerceNumber(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num)) return num;
  return fallback;
}

function measure(container, gutter) {
  if (typeof window === 'undefined') {
    return { width: DEFAULT_BASE_WIDTH, height: DEFAULT_BASE_HEIGHT };
  }
  const padding = Number.isFinite(gutter) ? Math.max(0, gutter) : DEFAULT_GUTTER;
  const fallbackWidth = Math.max(1, window.innerWidth - padding * 2);
  const fallbackHeight = Math.max(1, window.innerHeight - padding * 2);

  if (!container) {
    return { width: fallbackWidth, height: fallbackHeight };
  }

  let rect;
  try {
    rect = typeof container.getBoundingClientRect === 'function'
      ? container.getBoundingClientRect()
      : null;
  } catch (_) {
    rect = null;
  }

  const width = Number.isFinite(rect?.width) ? rect.width - padding * 2 : fallbackWidth;
  const height = Number.isFinite(rect?.height) ? rect.height - padding * 2 : fallbackHeight;

  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function resolveOptions(canvas, arg1, arg2, arg3) {
  const base = { canvas };
  if (arg1 && typeof arg1 === 'object') {
    return { ...base, ...arg1 };
  }
  return {
    ...base,
    maxWidth: Number.isFinite(arg1) ? arg1 : undefined,
    maxHeight: Number.isFinite(arg2) ? arg2 : undefined,
    gutter: Number.isFinite(arg3) ? arg3 : undefined,
  };
}

function computeTargetSize(baseWidth, baseHeight, availableWidth, availableHeight) {
  const fallbackWidth = baseWidth > 0 ? baseWidth : DEFAULT_BASE_WIDTH;
  const fallbackHeight = baseHeight > 0 ? baseHeight : DEFAULT_BASE_HEIGHT;
  const aspect = fallbackHeight === 0 ? 1 : fallbackWidth / fallbackHeight;

  let cssWidth = availableWidth;
  let cssHeight = cssWidth / aspect;

  if (cssHeight > availableHeight) {
    cssHeight = availableHeight;
    cssWidth = cssHeight * aspect;
  }

  return {
    cssWidth: Math.max(1, cssWidth),
    cssHeight: Math.max(1, cssHeight),
  };
}

export function getHudSafeGutter() {
  return DEFAULT_GUTTER;
}

export function scaleCanvas(canvas, arg1, arg2, arg3) {
  if (!canvas) return null;
  const options = resolveOptions(canvas, arg1, arg2, arg3);
  const baseWidth = coerceNumber(options.baseWidth ?? canvas.dataset?.basew, canvas.width || DEFAULT_BASE_WIDTH);
  const baseHeight = coerceNumber(options.baseHeight ?? canvas.dataset?.baseh, canvas.height || DEFAULT_BASE_HEIGHT);
  const gutter = Number.isFinite(options.gutter) ? options.gutter : DEFAULT_GUTTER;

  const container = options.container || canvas.parentElement || (typeof document !== 'undefined' ? document.body : null);
  const available = measure(container, gutter);

  const maxWidth = Number.isFinite(options.maxWidth) ? options.maxWidth : undefined;
  const maxHeight = Number.isFinite(options.maxHeight) ? options.maxHeight : undefined;

  if (Number.isFinite(maxWidth)) available.width = Math.min(available.width, maxWidth);
  if (Number.isFinite(maxHeight)) available.height = Math.min(available.height, maxHeight);

  const { cssWidth, cssHeight } = computeTargetSize(baseWidth, baseHeight, available.width, available.height);

  const nativeDpr = typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
    ? window.devicePixelRatio
    : 1;
  const dpr = clampDpr(nativeDpr, options.maxDpr);
  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.max(1, pixelWidth);
  canvas.height = Math.max(1, pixelHeight);

  let ctx = null;
  const shouldSkipContext = SKIP_CONTEXT_SYMBOL && canvas?.[SKIP_CONTEXT_SYMBOL];
  const view = canvas?.ownerDocument?.defaultView;
  const has2dContext = !!(view?.CanvasRenderingContext2D);
  const nativeGetContext = view?.HTMLCanvasElement?.prototype?.getContext;
  const isNativeGetContext = typeof nativeGetContext === 'function'
    ? canvas?.getContext === nativeGetContext
    : false;

  if (!shouldSkipContext && canvas && typeof canvas.getContext === 'function') {
    if (!has2dContext && isNativeGetContext && SKIP_CONTEXT_SYMBOL) {
      canvas[SKIP_CONTEXT_SYMBOL] = true;
    } else {
      try {
        ctx = canvas.getContext('2d');
        if (!ctx && SKIP_CONTEXT_SYMBOL) {
          canvas[SKIP_CONTEXT_SYMBOL] = true;
        }
      } catch (err) {
        if (SKIP_CONTEXT_SYMBOL) {
          canvas[SKIP_CONTEXT_SYMBOL] = true;
        }
        ctx = null;
      }
    }
  }
  if (ctx && typeof ctx.setTransform === 'function') {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  return {
    width: canvas.width,
    height: canvas.height,
    cssWidth,
    cssHeight,
    dpr,
    gutter,
  };
}

export function autoScaleCanvas(canvas, options) {
  if (!canvas || typeof window === 'undefined') return () => {};
  const handler = () => scaleCanvas(canvas, options);
  handler();
  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);
  const disconnect = () => {
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
  };
  if (typeof window.ResizeObserver === 'function' && canvas.parentElement) {
    const ro = new ResizeObserver(handler);
    ro.observe(canvas.parentElement);
    const prevDisconnect = disconnect;
    return () => {
      ro.disconnect();
      prevDisconnect();
    };
  }
  return disconnect;
}

export function installCanvasScaler(options) {
  if (typeof window === 'undefined') return () => {};
  const defaultOptions = options;
  const scaler = (canvas, arg1, arg2, arg3) => scaleCanvas(canvas, arg1 ?? defaultOptions, arg2, arg3);
  if (typeof window.fitCanvasToParent !== 'function') {
    window.fitCanvasToParent = scaler;
  }
  const api = Object.assign(window.GGShellCanvas || {}, {
    scaleCanvas: scaler,
    autoScaleCanvas,
    getHudSafeGutter,
    fit(canvas, arg1, arg2, arg3) {
      return scaler(canvas, arg1, arg2, arg3);
    }
  });
  window.GGShellCanvas = api;
  return scaler;
}

export default {
  scaleCanvas,
  autoScaleCanvas,
  installCanvasScaler,
  getHudSafeGutter,
};
