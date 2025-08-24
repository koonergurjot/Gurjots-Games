export function enableGamepadHint(el) {
  if (!el) return;

  function update() {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    el.hidden = pads.length === 0;
  }

  window.addEventListener('gamepadconnected', update);
  window.addEventListener('gamepaddisconnected', update);

  update();
}

export function virtualButtons(codes) {
  const state = new Map(codes.map((c) => [c, false]));
  const element = document.createElement('div');
  for (const code of codes) {
    const btn = document.createElement('button');
    btn.dataset.k = code;
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      state.set(code, true);
    });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      state.set(code, false);
    });
    element.appendChild(btn);
  }
  return {
    element,
    read: () => new Map(state)
  };
}
