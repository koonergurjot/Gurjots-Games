/**
 * Idempotent DOM preflight: create common nodes games expect.
 * Safe to run multiple times.
 */
function need(id, tag = 'div', attrs = {}) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    Object.assign(el, attrs);
    document.body.appendChild(el);
    console.info('[preflight] created missing #' + id);
  }
  return el;
}
need('status');
need('level');
need('lives');
need('board');
const game = need('game');
const cvs = document.getElementById('gameCanvas') || (() => {
  const c = document.createElement('canvas');
  c.id = 'gameCanvas';
  c.width = 800; c.height = 600;
  c.setAttribute('aria-label', 'Game canvas');
  document.body.appendChild(c);
  return c;
})();
game.style.position ||= 'relative';
game.style.minHeight ||= '400px';
export {};

// shim: some games call reportReady(slug)
    window.reportReady = window.reportReady || function(slug){
      try { window.parent && window.parent.postMessage({ type:'GAME_READY', slug: slug }, '*'); }
      catch(e) { /* no-op */ }
    };


// Fallback: if no game posts READY/ERROR, auto-post GAME_READY so diagnostics don't stall.
    (function(){
      if (window.__GG_ready_fallback) return;
      window.__GG_ready_fallback = true;
      // mark when any child posts an explicit GAME_READY/GAME_ERROR
      try {
        window.addEventListener('message', function(e){
          if (!e || !e.data || typeof e.data !== 'object') return;
          if (e.data.type === 'GAME_READY' || e.data.type === 'GAME_ERROR') {
            window.__GG_ready_pinged = true;
          }
        });
      } catch(e){}
      // after a short delay, if nothing pinged, post a synthetic GAME_READY
      setTimeout(function(){
        if (window.__GG_ready_pinged) return;
        var slug = (window.GG && window.GG.slug) ||
                   (document.body && document.body.dataset && document.body.dataset.slug) ||
                   (new URLSearchParams(location.search).get('slug')) ||
                   'unknown';
        try { window.parent && window.parent.postMessage({ type:'GAME_READY', slug: slug, synthetic:true }, '*'); }
        catch(e) {}
        window.__GG_ready_pinged = true;
      }, 2500);
    })();
