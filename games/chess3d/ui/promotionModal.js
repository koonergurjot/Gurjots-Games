export function showPromotionModal(color = 'w') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background: 'rgba(0,0,0,0.8)',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '8px',
      padding: '12px',
      display: 'flex',
      gap: '8px',
    });

    const pieces = ['q', 'r', 'b', 'n'];

    function cleanup(choice = 'q') {
      overlay.remove();
      resolve(choice);
    }

    pieces.forEach((p) => {
      const btn = document.createElement('button');
      btn.textContent = p.toUpperCase();
      Object.assign(btn.style, {
        border: '1px solid rgba(255,255,255,0.25)',
        background: 'rgba(255,255,255,0.1)',
        color: '#e6e7ea',
        padding: '8px 12px',
        borderRadius: '6px',
        font: '600 14px Inter,system-ui',
        cursor: 'pointer',
      });
      btn.onclick = () => cleanup(p);
      box.appendChild(btn);
    });

    overlay.onclick = (e) => { if (e.target === overlay) cleanup(); };

    document.body.appendChild(overlay);
    overlay.appendChild(box);
  });
}
