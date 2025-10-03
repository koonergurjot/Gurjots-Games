// js/auto-diag-inject.js
// Requests that the child frame load /games/common/diag-autowire.js via postMessage.
(function(){
  const MESSAGE_TYPE = 'GG_ENABLE_DIAG';

  function diagSrc(){
    const base = location.pathname.replace(/\/[^/]*$/, '');
    return base + '/games/common/diag-autowire.js';
  }

  function requestDiag(frame){
    try {
      const target = frame.contentWindow;
      if (!target) return;
      target.postMessage({ type: MESSAGE_TYPE, src: diagSrc() }, '*');
    } catch (_) {}
  }

  function boot(){
    const frame = document.querySelector('iframe, #game-frame, .game-frame');
    if(!frame) return;
    const send = () => requestDiag(frame);
    frame.addEventListener('load', send, { passive: true });
    // Attempt immediately in case the frame is already ready.
    send();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();