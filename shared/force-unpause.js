
// shared/force-unpause.js — runs inside iframe (play.html) to guarantee unpaused start
(function(){
  const global = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this;

  function fallbackForceClear(){
    try {
      const nodes = document.querySelectorAll('.pause-overlay, #gg-pause-overlay, .gg-overlay.gg-pause, .modal-paused, #hud .paused, .hud-paused');
      nodes.forEach(el => {
        el.style.display = 'none';
        el.classList.add('hidden');
        el.setAttribute('aria-hidden', 'true');
      });
      if (global.GG_HUD && typeof global.GG_HUD.hidePause === 'function') global.GG_HUD.hidePause();
    } catch (err) {
      // ignore errors in the fallback implementation
    }
  }

  const gameUI = global.gameUI = global.gameUI || {};
  if (typeof gameUI.forceClearPause !== 'function') {
    gameUI.forceClearPause = fallbackForceClear;
  }

  function clear(){
    try {
      gameUI.forceClearPause();
    } catch (err) {
      fallbackForceClear();
    }
  }

  clear();
  setTimeout(clear, 100);
  setTimeout(clear, 350);
  global.addEventListener('message', (e)=>{ const d=e.data||{}; if (d.type==='GAME_RESUME') clear(); });
})();
