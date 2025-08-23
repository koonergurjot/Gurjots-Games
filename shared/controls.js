export function virtualButtons(opts = {}) {
  if (virtualButtons._mounted) return;
  virtualButtons._mounted = true;

  const state = virtualButtons._state;

  const container = document.createElement('div');
  container.className = 'virtual-buttons';

  function addButton(name, label) {
    const btn = document.createElement('button');
    btn.className = `vb-btn vb-${name}`;
    btn.textContent = label;
    btn.addEventListener('pointerdown', (e) => {
      state[name] = true;
      e.preventDefault();
    });
    const reset = () => { state[name] = false; };
    btn.addEventListener('pointerup', reset);
    btn.addEventListener('pointercancel', reset);
    btn.addEventListener('pointerleave', reset);
    container.appendChild(btn);
  }

  if (opts.left) addButton('left', '◀');
  if (opts.right) addButton('right', '▶');

  document.body.appendChild(container);

  if (!document.getElementById('virtual-buttons-style')) {
    const style = document.createElement('style');
    style.id = 'virtual-buttons-style';
    style.textContent = `
      .virtual-buttons {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: 12px;
        display: flex;
        justify-content: space-between;
        pointer-events: none;
      }
      .virtual-buttons .vb-btn {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: #1b1e24c0;
        border: 1px solid #27314b;
        color: #cfe6ff;
        font-size: 32px;
        pointer-events: auto;
        touch-action: none;
      }
    `;
    document.head.appendChild(style);
  }
}

virtualButtons._state = { left: false, right: false };
virtualButtons._mounted = false;
virtualButtons.read = () => ({ ...virtualButtons._state });
