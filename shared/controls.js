// Basic controls helpers — fresh build

export function keyState() {
  const keys = new Set();
  const down = e => keys.add(e.key.toLowerCase());
  const up = e => keys.delete(e.key.toLowerCase());
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return { has: k => keys.has(k.toLowerCase()), destroy: () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  }};
}

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

export function enableGamepadHint(element) {
  const show = () => { element.style.display = ''; };
  const hide = () => { element.style.display = 'none'; };
  window.addEventListener('gamepadconnected', show);
  window.addEventListener('gamepaddisconnected', hide);
}

export function virtualButtons(codes = []) {
  const state = new Map();
  const wrapper = document.createElement('div');
  wrapper.className = 'virtual-buttons';
  for (const code of codes) {
    state.set(code, false);
    const btn = document.createElement('button');
    btn.dataset.k = code;
    btn.addEventListener('touchstart', e => {
      e.preventDefault();
      state.set(code, true);
    });
    btn.addEventListener('touchend', e => {
      e.preventDefault();
      state.set(code, false);
    });
    wrapper.appendChild(btn);
  }
  return { element: wrapper, read: () => new Map(state) };
}
