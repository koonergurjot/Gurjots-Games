(function (global) {
  if (typeof document === 'undefined') return;

  const gameUI = global.gameUI = global.gameUI || {};

  function localCreatePauseOverlay(opts = {}) {
    const overlay = (global.pauseOverlay && typeof global.pauseOverlay.createPauseOverlay === 'function')
      ? global.pauseOverlay.createPauseOverlay({
          ...opts,
          gameId: 'pong',
          hint: opts.hint || 'Press Esc or P to resume'
        })
      : createFallbackOverlay(opts);
    return overlay;
  }

  function createFallbackOverlay(opts = {}) {
    const { onResume, onRestart } = opts;
    const existing = document.querySelector('.pause-overlay[data-game="pong"]');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'pause-overlay hidden';
    overlay.setAttribute('data-game', 'pong');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="panel" role="document">
        <h3 style="margin:0 0 12px 0; font: 700 18px Inter,system-ui">Paused</h3>
        <p class="hint" style="margin:0 0 12px 0; font:500 14px/1.4 Inter,system-ui; color:var(--muted,#9aa0a6);">Press Enter to resume or Esc to return to the match.</p>
        <div class="keys" style="display:flex; flex-direction:column; gap:6px; margin:0 0 16px 0; font:500 13px/1.3 Inter,system-ui; color:var(--muted,#9aa0a6);">
          <span><strong style="font-weight:600;color:var(--fg,#e8eaed)">Move:</strong> W/S or ↑/↓</span>
          <span><strong style="font-weight:600;color:var(--fg,#e8eaed)">Serve:</strong> Enter</span>
          <span><strong style="font-weight:600;color:var(--fg,#e8eaed)">Pause:</strong> Space or Esc</span>
        </div>
        <div style="display:flex; gap:10px; justify-content:center">
          <button type="button" class="btn" data-action="resume">Resume</button>
          <button type="button" class="btn" data-action="restart">Restart</button>
        </div>
      </div>`;
    const attach = () => {
      (document.body || document.documentElement).appendChild(overlay);
    };
    if (document.body) attach();
    else document.addEventListener('DOMContentLoaded', attach, { once: true });
    const resumeBtn = overlay.querySelector('[data-action="resume"]');
    const restartBtn = overlay.querySelector('[data-action="restart"]');
    const hintEl = overlay.querySelector('.hint');
    let lastFocus = null;
    const focusable = Array.from(overlay.querySelectorAll('button'));
    const handleKeydown = (event) => {
      if(event.key === 'Tab' && focusable.length){
        event.preventDefault();
        const dir = event.shiftKey ? -1 : 1;
        let index = focusable.indexOf(document.activeElement);
        if(index === -1) index = dir > 0 ? 0 : focusable.length - 1;
        else index = (index + dir + focusable.length) % focusable.length;
        focusable[index]?.focus();
      } else if(event.key === 'Enter' && document.activeElement === resumeBtn){
        event.preventDefault();
        resumeBtn?.click();
      }
    };
    overlay.addEventListener('keydown', handleKeydown);

    const hide = () => {
      overlay.classList.add('hidden');
      if(lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    };
    const show = () => {
      overlay.classList.remove('hidden');
      lastFocus = document.activeElement;
      resumeBtn?.focus();
    };
    resumeBtn?.addEventListener('click', () => {
      hide();
      if (typeof onResume === 'function') onResume();
    });
    restartBtn?.addEventListener('click', () => {
      hide();
      if (typeof onRestart === 'function') onRestart();
    });
    return {
      show,
      hide,
      element: overlay,
      setHint(text) {
        if (hintEl && typeof text === 'string') hintEl.textContent = text;
      }
    };
  }

  global.PongPauseOverlay = { create: localCreatePauseOverlay };
})(typeof window !== 'undefined' ? window : globalThis);
