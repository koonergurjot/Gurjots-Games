// === Gamepad polling ===
export function createGamepad(fn) {
  let raf = null;
  function loop() {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (pads[0]) fn(pads[0]);
    raf = requestAnimationFrame(loop);
  }
  const start = () => { if (!raf) loop(); };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = null; };
  window.addEventListener('gamepadconnected', start);
  window.addEventListener('gamepaddisconnected', stop);
  start();
  return { start, stop };
}

export function standardAxesToDir(pad, dead = 0.2) {
  const [lx = 0, ly = 0] = pad.axes || [];
  const dx = Math.abs(lx) > dead ? lx : 0;
  const dy = Math.abs(ly) > dead ? ly : 0;
  return { dx, dy };
}
