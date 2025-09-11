// compat-shim.js
// Lightweight, non-invasive shims to help older game modules boot on a static site.
// - Creates common DOM targets (#game-root exists already, we add #game and a <canvas id="canvas"> if missing)
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

  function ensureCanvas(id, parent){
    var c = document.getElementById(id);
    if (c && c.getContext) return c;
    c = document.createElement('canvas');
    c.id = id;
    c.width = window.innerWidth || 800;
    c.height = window.innerHeight || 600;
    (parent || document.body).appendChild(c);
    return c;
  }

  // Mount area
  var root = document.querySelector('#game-root') || ensureEl('div', 'game-root', document.body);
  // Common legacy IDs some games expect:
  var gameDiv = document.getElementById('game') || (function(){ 
    var d = document.createElement('div'); d.id = 'game'; root.appendChild(d); return d; 
  })();
  // If no canvas exists at all, provide a generic one.
  if (!document.querySelector('canvas')) {
    ensureCanvas('canvas', gameDiv);
  }

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
    var c = document.getElementById('canvas');
    if (c && c.parentElement === gameDiv) {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    }
  }
  window.addEventListener('resize', fit, { passive: true });
  fit();
})();