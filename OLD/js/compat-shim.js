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

  function tagShimCanvas(c){
    if (!c) return c;
    try { c.classList.add('compat-shim-canvas'); } catch (e) {}
    c.dataset.compatShimCanvas = '1';
    return c;
  }

  function createPlaceholderCanvas(id, parent){
    var c = document.createElement('canvas');
    if (id) c.id = id;
    c.width = window.innerWidth || 800;
    c.height = window.innerHeight || 600;
    c.dataset.compatShimPlaceholder = '1';
    tagShimCanvas(c);
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
  var placeholderCanvas = isPlaceholder ? canvas : null;

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

  if (placeholderCanvas) {
    var placeholderObserver = null;
    var placeholderPoll = null;
    var observerTargets = [];

    function pushObserverTarget(node){
      if (!node) return;
      if (observerTargets.indexOf(node) !== -1) return;
      if (typeof node.querySelectorAll !== 'function') return;
      observerTargets.push(node);
    }

    var placeholderParent = placeholderCanvas.parentElement;
    pushObserverTarget(placeholderParent);
    if (mount && mount.contains(placeholderCanvas)) pushObserverTarget(mount);
    pushObserverTarget(root);

    function findReplacementCanvas(){
      var searchRoots = [];
      var currentGameEl = document.getElementById('game');
      if (placeholderParent && placeholderParent.isConnected && searchRoots.indexOf(placeholderParent) === -1) searchRoots.push(placeholderParent);
      if (mount && mount.isConnected && searchRoots.indexOf(mount) === -1) searchRoots.push(mount);
      if (currentGameEl && searchRoots.indexOf(currentGameEl) === -1) searchRoots.push(currentGameEl);
      if (root && searchRoots.indexOf(root) === -1) searchRoots.push(root);

      for (var i = 0; i < searchRoots.length; i++) {
        var candidateRoot = searchRoots[i];
        if (!candidateRoot || typeof candidateRoot.querySelectorAll !== 'function') continue;
        var canvases = candidateRoot.querySelectorAll('canvas');
        for (var j = 0; j < canvases.length; j++) {
          var candidate = canvases[j];
          if (candidate === placeholderCanvas) continue;
          if (candidate.dataset && candidate.dataset.compatShimCanvas === '1') continue;
          return candidate;
        }
      }
      return null;
    }

    function stopPolling(){
      if (placeholderPoll != null) {
        clearInterval(placeholderPoll);
        placeholderPoll = null;
      }
    }

    function promoteReplacement(replacement){
      if (!replacement || replacement === placeholderCanvas) return false;
      isPlaceholder = false;
      window.removeEventListener('resize', fit);
      if (placeholderObserver) {
        placeholderObserver.disconnect();
        placeholderObserver = null;
      }
      stopPolling();
      if (placeholderCanvas && placeholderCanvas.parentElement) {
        placeholderCanvas.parentElement.removeChild(placeholderCanvas);
      } else if (placeholderCanvas && typeof placeholderCanvas.remove === 'function') {
        placeholderCanvas.remove();
      }
      placeholderCanvas = null;
      canvas = replacement;
      return true;
    }

    function checkForReplacement(){
      var replacement = findReplacementCanvas();
      if (!replacement) return false;
      return promoteReplacement(replacement);
    }

    if (!checkForReplacement()) {
      var observed = false;
      if ('MutationObserver' in window) {
        placeholderObserver = new MutationObserver(function(){
          if (checkForReplacement()) {
            if (placeholderObserver) {
              placeholderObserver.disconnect();
              placeholderObserver = null;
            }
            stopPolling();
          }
        });
        for (var t = 0; t < observerTargets.length; t++) {
          var target = observerTargets[t];
          if (!target || !target.isConnected) continue;
          try {
            placeholderObserver.observe(target, { childList: true, subtree: true });
            observed = true;
          } catch (e) {}
        }
        if (!observed && placeholderObserver) {
          placeholderObserver.disconnect();
          placeholderObserver = null;
        }
      }
      if (!observed) {
        placeholderPoll = setInterval(function(){
          if (checkForReplacement()) {
            stopPolling();
            if (placeholderObserver) {
              placeholderObserver.disconnect();
              placeholderObserver = null;
            }
          }
        }, 250);
      }
    }
  }
})();
