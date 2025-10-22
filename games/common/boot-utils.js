const OVERLAY_ID = 'gg-game-error-overlay';

function getCanvasSize(canvas) {
  const width = Number.isFinite(canvas?.width) ? canvas.width : 0;
  const height = Number.isFinite(canvas?.height) ? canvas.height : 0;
  if (width > 0 && height > 0) {
    return { width, height };
  }
  try {
    const rect = canvas?.getBoundingClientRect?.();
    if (rect && rect.width && rect.height) {
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    }
  } catch (_err) {
    /* ignore measurement failures */
  }
  return { width: 640, height: 360 };
}

export function drawBootPlaceholder(canvas, ctx, message = 'Loading…') {
  if (!canvas || !ctx) return;
  const { width, height } = getCanvasSize(canvas);
  const prevTransform = ctx.getTransform?.();
  if (typeof ctx.setTransform === 'function') {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#8fb9ff';
  ctx.font = '16px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, width / 2, height / 2);
  if (prevTransform && typeof ctx.setTransform === 'function') {
    ctx.setTransform(prevTransform);
  }
}

export function showErrorOverlay(message = 'The game could not start.') {
  if (typeof document === 'undefined') return;
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(9, 13, 24, 0.92)';
    overlay.style.color = '#e2e8f0';
    overlay.style.fontFamily = 'system-ui, sans-serif';
    overlay.style.fontSize = '1rem';
    overlay.style.zIndex = '1000';
    overlay.style.padding = '24px';
    overlay.style.textAlign = 'center';
    overlay.setAttribute('role', 'alert');
    document.body?.appendChild(overlay);
  }
  overlay.textContent = message;
}
