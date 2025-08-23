export function enableGamepadHint(hint){
  const show = () => { hint.style.display = ''; };
  const hide = () => { hint.style.display = 'none'; };
  window.addEventListener('gamepadconnected', show);
  window.addEventListener('gamepaddisconnected', hide);
}

export function virtualButtons(codes){
  const state = new Map(codes.map(code => [code, false]));
  const element = document.createElement('div');
  for (const code of codes){
    const btn = document.createElement('button');
    btn.dataset.k = code;
    const press = (e) => { e.preventDefault(); state.set(code, true); };
    const release = (e) => { e.preventDefault(); state.set(code, false); };
    btn.addEventListener('touchstart', press);
    btn.addEventListener('touchend', release);
    btn.addEventListener('touchcancel', release);
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);
    element.appendChild(btn);
  }
  return { element, read: () => state };
}

export function applyToon(outline, toon){
  outline.enabled = toon;
}
