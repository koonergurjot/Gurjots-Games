// Basic controls helpers — now with user mappings

const DEFAULT_MAPPING = {
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  jump: ' ',
  fire: ' ',
  pause: 'p',
  restart: 'r',
  p1up: 'w',
  p1down: 's',
  p2up: 'arrowup',
  p2down: 'arrowdown',
  serve: ' '
};

export function loadMappings() {
  try {
    return { ...DEFAULT_MAPPING, ...(JSON.parse(localStorage.getItem('controls')) || {}) };
  } catch {
    return { ...DEFAULT_MAPPING };
  }
}

let mapping = loadMappings();

export function getKey(action) {
  return (mapping[action] || action || '').toLowerCase();
}

export function saveMappings(newMap) {
  mapping = { ...mapping, ...newMap };
  localStorage.setItem('controls', JSON.stringify(mapping));
}

export function reloadMappings() {
  mapping = loadMappings();
}

export function keyState() {
  const keys = new Set();
  const down = e => keys.add(e.key.toLowerCase());
  const up = e => keys.delete(e.key.toLowerCase());
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return {
    has: a => keys.has(getKey(a)),
    press: a => keys.add(getKey(a)),
    release: a => keys.delete(getKey(a)),
    destroy: () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    }
  };
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
  const destroy = () => {
    stop();
    window.removeEventListener('gamepadconnected', start);
    window.removeEventListener('gamepaddisconnected', stop);
  };
  return { start, stop, destroy };
}

export function standardAxesToDir(pad, dead = 0.2) {
  const [lx = 0, ly = 0] = pad.axes || [];
  const dx = Math.abs(lx) > dead ? lx : 0;
  const dy = Math.abs(ly) > dead ? ly : 0;
  return { dx, dy };
}

export function enableGamepadHint(hintEl) {
  const show = () => { hintEl.style.display = ''; };
  const hide = () => { hintEl.style.display = 'none'; };
  window.addEventListener('gamepadconnected', show);
  window.addEventListener('gamepaddisconnected', hide);
  hide();
  return {
    destroy: () => {
      window.removeEventListener('gamepadconnected', show);
      window.removeEventListener('gamepaddisconnected', hide);
    }
  };
}

export function virtualButtons(codes) {
  const element = document.createElement('div');
  const state = new Map();
  const up = code => () => state.set(code, false);
  for (const code of codes) {
    const btn = document.createElement('button');
    btn.dataset.k = code;
    state.set(code, false);
    btn.addEventListener('touchstart', e => { state.set(code, true); e.preventDefault(); }, { passive: false });
    btn.addEventListener('touchend', up(code));
    btn.addEventListener('touchcancel', up(code));
    element.appendChild(btn);
  }
  return {
    element,
    read: () => new Map(state)
  };
}
