const state = {};
let container;
let styleInjected = false;

export function virtualButtons(buttons = {}) {
  if (!container) {
    container = document.createElement('div');
    container.className = 'virtual-buttons';
    document.body.appendChild(container);

    if (!styleInjected) {
      const style = document.createElement('style');
      style.textContent = `
        .virtual-buttons{
          position:fixed;
          bottom:20px;
          right:20px;
          display:flex;
          gap:12px;
          z-index:1000;
        }
        .virtual-buttons button{
          width:64px;
          height:64px;
          border-radius:50%;
          border:1px solid #27314b;
          background:#0e1422;
          color:#cfe6ff;
          font-size:14px;
          font-weight:700;
        }
      `;
      document.head.appendChild(style);
      styleInjected = true;
    }
  }

  for (const name of Object.keys(buttons)) {
    if (buttons[name]) {
      const btn = document.createElement('button');
      btn.textContent = name[0].toUpperCase() + name.slice(1);
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        state[name] = true;
      });
      container.appendChild(btn);
      state[name] = false;
    }
  }
}

virtualButtons.read = function () {
  const snapshot = { ...state };
  for (const k in state) state[k] = false;
  return snapshot;
};

