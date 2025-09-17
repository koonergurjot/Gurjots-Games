(function(){
  function createCanvasLoop(canvas, render, opts){
    opts = opts || {};
    var onResize = opts.onResize;
    var raf = null;
    var ro = null;
    function resize(){
      var style = getComputedStyle(canvas);
      var cssW = parseFloat(style.width) || canvas.width;
      var cssH = parseFloat(style.height) || canvas.height;
      var dpr = window.devicePixelRatio || 1;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      if(onResize) onResize(canvas.width, canvas.height, dpr);
    }
    if(typeof ResizeObserver !== 'undefined'){
      ro = new ResizeObserver(function(){ resize(); });
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }
    resize();
    function loop(t){
      raf = requestAnimationFrame(loop);
      render(t);
    }
    function start(){
      if(raf==null) raf = requestAnimationFrame(loop);
    }
    function stop(){
      if(raf!=null){
        cancelAnimationFrame(raf);
        raf = null;
      }
    }
    function dispose(){
      stop();
      if(ro) ro.disconnect(); else window.removeEventListener('resize', resize);
    }
    return { start:start, stop:stop, dispose:dispose, resize:resize };
  }
  window.createCanvasLoop = createCanvasLoop;
})();
