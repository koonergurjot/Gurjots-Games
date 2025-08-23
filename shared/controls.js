export function enableGamepadHint(el) {
  if (!el) return;
  const update = () => {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    const any = pads.some(p => p);
    el.style.display = any ? '' : 'none';
  };
  window.addEventListener('gamepadconnected', update);
  window.addEventListener('gamepaddisconnected', update);
  update();
}

function ensureStyles() {
  if (document.getElementById('virtual-buttons-style')) return;
  const style = document.createElement('style');
  style.id = 'virtual-buttons-style';
  style.textContent = `
.virtual-buttons {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  padding: 10px;
  pointer-events: none;
  z-index: 9999;
}
.virtual-buttons .vb-group {
  display: flex;
  gap: 10px;
}
.virtual-buttons button {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.2);
  color: #fff;
  font-size: 20px;
  pointer-events: auto;
  touch-action: none;
}
`; 
  document.head.appendChild(style);
}

export function virtualButtons(config = {}) {
  const state = {};
  for (const key of Object.keys(config)) state[key] = false;

  const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!coarse) {
    return {
      read: () => ({ ...state })
    };
  }

  ensureStyles();

  const container = document.createElement('div');
  container.className = 'virtual-buttons';

  const leftGroup = document.createElement('div');
  leftGroup.className = 'vb-group vb-left';
  const rightGroup = document.createElement('div');
  rightGroup.className = 'vb-group vb-right';
  container.append(leftGroup, rightGroup);

  const addButton = (key, parent) => {
    const label = config[key] === true || config[key] == null ? key : config[key];
    const btn = document.createElement('button');
    btn.className = `vb-btn vb-${key}`;
    btn.textContent = label;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      state[key] = true;
      if (btn.setPointerCapture && e.pointerId != null) {
        btn.setPointerCapture(e.pointerId);
      }
    });
    const clear = e => {
      e.preventDefault();
      state[key] = false;
      if (btn.releasePointerCapture && e.pointerId != null) {
        btn.releasePointerCapture(e.pointerId);
      }
    };
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointercancel', clear);
    parent.appendChild(btn);
  };

  if (config.left) addButton('left', leftGroup);
  if (config.right) addButton('right', leftGroup);

  for (const key of Object.keys(config)) {
    if (key === 'left' || key === 'right') continue;
    addButton(key, rightGroup);
  }

  document.body.appendChild(container);

  return {
    read: () => ({ ...state })
  };
}

export default { enableGamepadHint, virtualButtons };
