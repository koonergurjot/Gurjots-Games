(function(){
  if (typeof window === 'undefined') return;
  window.GG = window.GG || {};
  if (typeof window.GG.incPlays !== 'function') window.GG.incPlays = function(){};
  if (typeof window.GG.playSnd !== 'function') window.GG.playSnd = function(){};
  if (typeof window.GG.log !== 'function') window.GG.log = function(){};
  if (typeof window.fitCanvasToParent !== 'function') {
    window.fitCanvasToParent = function(canvas) {
      if (!canvas || !canvas.getContext) return;
      function fit() {
        const parent = canvas.parentElement || document.body;
        const w = parent.clientWidth || 800;
        const h = parent.clientHeight || 600;
        const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.width = Math.max(1, w * dpr);
        canvas.height = Math.max(1, h * dpr);
        const ctx = canvas.getContext('2d');
        if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      window.addEventListener('resize', fit);
      setTimeout(fit, 0);
      fit();
    };
  }
  if (typeof window.Replay !== 'function') window.Replay = function () {};
})();