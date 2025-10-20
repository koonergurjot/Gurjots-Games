// shared/boot.js — startup diagnostics overlay
(function(){
  if (window.__GG_BOOT_INSTALLED__) return; 
  window.__GG_BOOT_INSTALLED__ = true;

  const START_TIMEOUT = 3500;
  const overlayId = "gg-diag-overlay";
  let firstFrame = false, overlayShown = false;

  function showOverlay(msg, err){
    if (overlayShown) return;
    overlayShown = true;
    const el = document.createElement('div');
    el.id = overlayId;
    el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.85);color:#fff;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;font:14px/1.5 system-ui";
    el.innerHTML = `
      <div style="max-width:800px">
        <h2>Game failed to start</h2>
        <p>${msg || 'No frame rendered within 3.5s'}</p>
        <pre style="background:#111;padding:12px;border-radius:8px;max-height:50vh;overflow:auto;">${err ? String(err.stack || err) : ''}</pre>
        <button id="gg-retry" style="margin-top:12px;padding:8px 16px;border:0;border-radius:6px;background:#3b82f6;color:#fff;cursor:pointer">Retry</button>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('gg-retry')?.addEventListener('click',()=>location.reload());
    console.warn('[GG] startup overlay displayed', err);
  }

  window.ggFirstFrame = ()=>{ firstFrame = true; };

  window.addEventListener('error', e=>{
    if(!firstFrame) showOverlay('Unhandled startup error', e.error||e.message);
  });
  window.addEventListener('unhandledrejection', e=>{
    if(!firstFrame) showOverlay('Unhandled promise rejection', e.reason);
  });

  function unlockAudio(){
    try {
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const b = ctx.createBuffer(1,1,22050);
      const s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
      if (ctx.state==='suspended') ctx.resume();
      setTimeout(()=>ctx.close(),200);
    } catch(_){}
  }
  ['pointerdown','keydown','touchstart'].forEach(ev=>addEventListener(ev, unlockAudio,{once:true}));

  setTimeout(()=>{ 
    if (!firstFrame && !document.getElementById(overlayId))
      showOverlay('No frame rendered after '+START_TIMEOUT+'ms'); 
  }, START_TIMEOUT);
})();
