// Resize utility: scales a canvas to fit a viewport while preserving aspect ratio.
export function fitCanvasToParent(canvas, arg1, arg2, arg3) {
  if (!canvas) return;

  const baseWidth = Number.parseInt(canvas.dataset?.basew, 10);
  const baseHeight = Number.parseInt(canvas.dataset?.baseh, 10);
  const fallbackWidth = Number.isFinite(baseWidth) ? baseWidth : canvas.width;
  const fallbackHeight = Number.isFinite(baseHeight) ? baseHeight : canvas.height;
  const aspectRatio = fallbackHeight === 0 ? 1 : fallbackWidth / fallbackHeight;

  const options = resolveOptions(canvas, arg1, arg2, arg3);
  const minWidth = Number.isFinite(options.minWidth) ? options.minWidth : fallbackWidth;
  const minHeight = Number.isFinite(options.minHeight) ? options.minHeight : fallbackHeight;

  const { width: measuredWidth, height: measuredHeight } = measureContainer(options);
  const availableWidth = Math.max(minWidth, measuredWidth);
  const availableHeight = Math.max(minHeight, measuredHeight);

  let targetWidth = availableWidth;
  let targetHeight = aspectRatio === 0 ? availableHeight : targetWidth / aspectRatio;
  if (targetHeight > availableHeight) {
    targetHeight = availableHeight;
    targetWidth = availableHeight * aspectRatio;
  }

  targetWidth = Math.max(minWidth, targetWidth);
  targetHeight = Math.max(minHeight, targetHeight);

  const pixelRatio = window.devicePixelRatio || 1;
  canvas.style.width = `${targetWidth}px`;
  canvas.style.height = `${targetHeight}px`;
  canvas.width = Math.round(targetWidth * pixelRatio);
  canvas.height = Math.round(targetHeight * pixelRatio);

  const ctx = canvas.getContext('2d');
  if (ctx && typeof ctx.setTransform === 'function') {
    const scaleX = targetWidth === 0 ? 1 : canvas.width / targetWidth;
    const scaleY = targetHeight === 0 ? 1 : canvas.height / targetHeight;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  }
}

function resolveOptions(canvas, arg1, arg2, arg3) {
  if (typeof arg1 === 'object' && arg1 !== null) {
    return arg1;
  }

  return {
    maxWidth: Number.isFinite(arg1) ? arg1 : undefined,
    maxHeight: Number.isFinite(arg2) ? arg2 : undefined,
    padding: Number.isFinite(arg3) ? arg3 : undefined,
    canvas,
  };
}

function measureContainer(options) {
  const padding = Number.isFinite(options.padding) ? options.padding : 16;
  let width;
  let height;

  if (options.container && typeof options.container.getBoundingClientRect === 'function') {
    const rect = options.container.getBoundingClientRect();
    width = rect.width - padding * 2;
    height = rect.height - padding * 2;
  }

  if (Number.isFinite(options.width)) width = options.width;
  if (Number.isFinite(options.height)) height = options.height;

  const viewportWidth = Math.max(0, window.innerWidth - padding * 2);
  const viewportHeight = Math.max(0, window.innerHeight - padding * 2);

  if (!Number.isFinite(width)) {
    width = viewportWidth;
    if (Number.isFinite(options.maxWidth)) {
      width = Math.min(width, options.maxWidth);
    }
  }

  if (!Number.isFinite(height)) {
    height = viewportHeight;
    if (Number.isFinite(options.maxHeight)) {
      height = Math.min(height, options.maxHeight);
    }
  }

  return {
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}
