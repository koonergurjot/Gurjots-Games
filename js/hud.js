(function () {
  function createHUD(options) {
    const { title = 'Game', onPauseToggle = () => {}, onRestart = () => {} } = options || {};

    const toolbar = document.createElement('div');
    toolbar.setAttribute('role', 'toolbar');
    Object.assign(toolbar.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: 9999,
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      background: 'rgba(15,23,42,0.72)',
      border: '1px solid rgba(148,163,184,0.35)',
      borderRadius: '14px',
      padding: '10px 12px',
      backdropFilter: 'saturate(140%) blur(10px)'
    });

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    Object.assign(titleEl.style, {
      font: '700 14px/1.2 Inter,system-ui',
      letterSpacing: '.02em',
      color: '#f8fafc',
      marginRight: '6px'
    });

    const makeButton = (label) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('aria-label', label);

      const baseBackground = 'rgba(30,41,59,0.82)';
      const activeBackground = 'rgba(30,64,175,0.82)';
      const baseBorder = 'rgba(148,163,184,0.55)';
      const activeBorder = 'rgba(96,165,250,0.95)';

      const applyBaseState = () => {
        button.style.background = baseBackground;
        button.style.borderColor = baseBorder;
        button.style.boxShadow = 'none';
      };

      const applyActiveState = () => {
        button.style.background = activeBackground;
        button.style.borderColor = activeBorder;
      };

      Object.assign(button.style, {
        border: `1px solid ${baseBorder}`,
        color: '#f9fafb',
        padding: '12px 14px',
        borderRadius: '12px',
        font: '600 14px Inter,system-ui',
        cursor: 'pointer',
        minWidth: '84px',
        touchAction: 'manipulation',
        outline: '2px solid transparent',
        outlineOffset: '2px',
        transition: 'box-shadow 120ms ease,background-color 120ms ease,border-color 120ms ease'
      });

      applyBaseState();

      button.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          button.click();
        }
      };

      button.addEventListener('focus', () => {
        applyActiveState();
        button.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.65)';
      });

      button.addEventListener('blur', () => {
        applyBaseState();
      });

      button.addEventListener('mouseenter', () => {
        applyActiveState();
      });

      button.addEventListener('mouseleave', () => {
        if (document.activeElement !== button) {
          applyBaseState();
        }
      });

      return button;
    };

    const pauseButton = makeButton('Pause');
    const restartButton = makeButton('Restart');

    pauseButton.onclick = () => onPauseToggle();
    restartButton.onclick = () => onRestart();

    toolbar.append(titleEl, pauseButton, restartButton);
    document.body.appendChild(toolbar);

    if (document.activeElement === document.body || !document.activeElement) {
      requestAnimationFrame(() => {
        pauseButton.focus({ preventScroll: true });
      });
    }

    function setPaused(isPaused) {
      pauseButton.textContent = isPaused ? 'Resume' : 'Pause';
      pauseButton.setAttribute('aria-pressed', String(isPaused));
    }

    return { setPaused };
  }

  window.HUD = { create: createHUD };
})();
