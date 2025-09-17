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
