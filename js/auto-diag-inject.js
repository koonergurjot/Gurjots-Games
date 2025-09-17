// js/auto-diag-inject.js
// Auto-injects /games/common/diag-upgrades.js into the game iframe on game.html
// so you can just upload files (no per-game edits). Requires same-origin.
(function(){
  function injectIntoFrame(frame){
    try{
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if(!doc) return;
      if(doc.getElementById('gg-diag-upgrades')) return; // already injected
      const s = doc.createElement('script');
      s.id = 'gg-diag-upgrades';
      // Use absolute path from loader to avoid relative path issues
      const base = location.pathname.replace(/\/[^/]*$/, '');
      s.src = base + '/games/common/diag-upgrades.js';
      s.defer = true;
      (doc.body || doc.documentElement).appendChild(s);
    }catch(_){}
  }
  function boot(){
    const frame = document.querySelector('iframe, #game-frame, .game-frame');
    if(!frame) return;
    if(frame.contentDocument?.readyState === 'complete') injectIntoFrame(frame);
    frame.addEventListener('load', ()=> injectIntoFrame(frame), {passive:true});
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();