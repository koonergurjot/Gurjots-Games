// shared/debug/post-ready.js
// Posts a message to the parent window when the document is ready.

export function postReady(data = {}){
  function send(){
    try { window.parent && window.parent.postMessage({ type: 'ready', ...data }, '*'); }
    catch {}
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    send();
  } else {
    window.addEventListener('DOMContentLoaded', send, { once: true });
  }
}
