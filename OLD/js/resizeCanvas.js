// Resize utility: scales a canvas to fit the viewport while keeping aspect ratio.
export function fitCanvasToParent(canvas, maxW = 1000, maxH = 700, padding = 16) {
  const pr = window.devicePixelRatio || 1;
  const W = Math.min(window.innerWidth - padding*2, maxW);
  const H = Math.min(window.innerHeight - padding*2, maxH);
  // Maintain original aspect ratio using current canvas width/height
  const ar = canvas.width / canvas.height;
  let vw = W, vh = W / ar;
  if (vh > H) { vh = H; vw = H * ar; }
  canvas.style.width = vw + 'px';
  canvas.style.height = vh + 'px';
  // Keep internal resolution high for crispness
  canvas.width = Math.round(vw * pr);
  canvas.height = Math.round(vh * pr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(pr,0,0,pr,0,0);
}
