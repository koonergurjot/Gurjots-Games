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
