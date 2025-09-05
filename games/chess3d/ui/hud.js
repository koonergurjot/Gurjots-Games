export function initHUD({ onNewGame, onFlipBoard, onToggleCoords } = {}) {
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 9999,
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    background: 'rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '12px',
    padding: '8px 10px',
    backdropFilter: 'saturate(140%) blur(8px)',
  });
  document.body.appendChild(bar);

  function mk(label) {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      border: '1px solid rgba(255,255,255,0.25)',
      background: 'rgba(255,255,255,0.08)',
      color: '#e6e7ea',
      padding: '6px 10px',
      borderRadius: '8px',
      font: '600 13px Inter,system-ui',
      cursor: 'pointer',
      touchAction: 'manipulation',
    });
    return btn;
  }

  const newBtn = mk('New Game');
  newBtn.onclick = () => onNewGame?.();

  const flipBtn = mk('Flip Board');
  flipBtn.onclick = () => onFlipBoard?.();

  const coordsBtn = mk('Coords');
  const key = 'chess3d_coords';
  let coordsVisible = localStorage.getItem(key) !== '0';
  function applyCoords() {
    coordsBtn.style.opacity = coordsVisible ? '1' : '0.5';
    onToggleCoords?.(coordsVisible);
  }
  coordsBtn.onclick = () => {
    coordsVisible = !coordsVisible;
    localStorage.setItem(key, coordsVisible ? '1' : '0');
    applyCoords();
  };
  applyCoords();

  const status = document.createElement('div');
  Object.assign(status.style, {
    marginLeft: '8px',
    font: '600 13px/1.2 Inter,system-ui',
    color: '#e6e7ea',
  });
  bar.append(newBtn, flipBtn, coordsBtn, status);

  return {
    setStatus(text) {
      status.textContent = text;
    },
  };
}
