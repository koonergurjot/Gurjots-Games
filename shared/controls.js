export function enableGamepadHint(el) {
  const show = () => { el.style.display = ''; };
  const hide = () => { el.style.display = 'none'; };
  window.addEventListener('gamepadconnected', show);
  window.addEventListener('gamepaddisconnected', hide);
}

export function virtualButtons(codes) {
  const element = document.createElement('div');
  const state = new Map();
  for (const code of codes) {
    state.set(code, false);
    const btn = document.createElement('button');
    btn.dataset.k = code;
    const press = () => state.set(code, true);
    const release = () => state.set(code, false);
    btn.addEventListener('touchstart', press);
    btn.addEventListener('touchend', release);
    btn.addEventListener('touchcancel', release);
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);
    element.appendChild(btn);
  }
  return {
    element,
    read: () => new Map(state)
  };
}

