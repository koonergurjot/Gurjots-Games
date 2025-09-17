
// shared/force-unpause.js — runs inside iframe (play.html) to guarantee unpaused start
(function(){
  function clear(){
    try{
      document.querySelectorAll('.pause-overlay, #gg-pause-overlay, .gg-overlay.gg-pause, .modal-paused, #hud .paused, .hud-paused').forEach(el=>{
        el.style.display='none'; el.classList.add('hidden'); el.setAttribute('aria-hidden','true');
      });
      if (window.GG_HUD && typeof GG_HUD.hidePause==='function') GG_HUD.hidePause();
    }catch{}
  }
  clear(); setTimeout(clear, 100); setTimeout(clear, 350);
  window.addEventListener('message', (e)=>{ const d=e.data||{}; if (d.type==='GAME_RESUME') clear(); });
})();
