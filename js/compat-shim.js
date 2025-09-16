// compat-shim.js
// Lightweight, non-invasive shims to help older game modules boot on a static site.
// - Creates common DOM targets (#game-root exists already, we ensure a <canvas id="game"> exists)
// - Provides a VERY SMALL window.GG stub if not defined (avoid "GG is not defined" hard failures)
// This tries not to interfere with games that already set these up themselves.

(function(){
  function ensureEl(tag, id, parent){
    var el = document.getElementById(id);
    if (el) return el;
    el = document.createElement(tag);
    el.id = id;
    (parent || document.body).appendChild(el);
    return el;
  }

  function createPlaceholderCanvas(id, parent){
    var c = document.createElement('canvas');
    if (id) c.id = id;
    c.width = window.innerWidth || 800;
    c.height = window.innerHeight || 600;
    c.dataset.compatShimPlaceholder = '1';
    (parent || document.body).appendChild(c);
    return c;
  }

  function ensureMounted(node, parent){
    if (node && !node.parentElement) (parent || document.body).appendChild(node);
  }

  function uniqueId(base){
    if (!document.getElementById(base)) return base;
    var i = 1;
    while (document.getElementById(base + '-' + i)) i++;
    return base + '-' + i;
  }

  // Mount area
  var root = document.querySelector('#game-root') || ensureEl('div', 'game-root', document.body);
  var canvas = null;
  var mount = document.getElementById('game');

  if (!mount) {
    canvas = createPlaceholderCanvas('game', root);
  } else if (mount instanceof HTMLCanvasElement) {
    canvas = mount;
    ensureMounted(canvas, root);
  } else {
    ensureMounted(mount, root);
    var existing = mount.querySelector('canvas');
    if (existing && typeof existing.getContext === 'function') {
      canvas = existing;
    } else {
      canvas = createPlaceholderCanvas('game', mount);
    }
    if (canvas !== mount) {
      if (mount.id === 'game') {
        mount.dataset.compatShimOriginalId = 'game';
        mount.id = uniqueId('game-container');
      }
      if (canvas.id && canvas.id !== 'game') {
        canvas.dataset.compatShimPreviousId = canvas.id;
      }
      if (canvas.id !== 'game') {
        canvas.id = 'game';
      }
    }
  }

  if (!canvas) {
    canvas = createPlaceholderCanvas('game', root);
  }

  ensureMounted(canvas, root);
  var isPlaceholder = canvas.dataset.compatShimPlaceholder === '1';

  // Minimal GG stub (only if absent)
  if (!('GG' in window)) {
    window.GG = {
      raf: null,
      // Simple main loop; games can replace it
      loop: {
        start(fn){
          if (this._running) return;
          this._running = true;
          const step = (t)=>{ if (!this._running) return; try{ fn(t); }catch(e){ console.error(e); this.stop(); } window.GG.raf = requestAnimationFrame(step); };
          window.GG.raf = requestAnimationFrame(step);
        },
        stop(){ this._running = false; if (window.GG.raf) cancelAnimationFrame(window.GG.raf); }
      },
      clamp(n, a, b){ return Math.max(a, Math.min(b, n)); },
      rand(min, max){ if (max==null){ max=min; min=0; } return Math.random()*(max-min)+min; },
      log: (...a)=>console.log('[GG]', ...a)
    };
    console.warn('[compat-shim] Installed minimal window.GG stub. Replace with your real engine if needed.');
  }

  // Resize canvas to fit viewport if it's our placeholder
  function fit(){
    if (!isPlaceholder) return;
    canvas.width = window.innerWidth || 800;
    canvas.height = window.innerHeight || 600;
  }
  window.addEventListener('resize', fit, { passive: true });
  fit();
})();