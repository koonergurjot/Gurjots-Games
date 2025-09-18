/* Common diagnostics helpers (optional per-game include)
   - Attaches window.onerror + unhandledrejection and posts GAME_ERROR
   - Posts GAME_READY after first animation frame if a loop starts
*/
(function(){
  if (window.__diagUpInstalled) return; window.__diagUpInstalled = true;
  const once = (fn) => { let done=false; return (...a)=>{ if(!done){done=true; try{fn(...a)}catch(e){} } } };
  const post = (type, extra) => { try{ window.parent && window.parent.postMessage({ type, ...extra }, "*"); }catch(e){} };
  const postError = once((msg) => post("GAME_ERROR", { error: String(msg||"Unknown error") }));

  window.addEventListener("error", (e)=> postError(e && (e.message || e.error) ));
  window.addEventListener("unhandledrejection", (e)=> postError(e && (e.reason || e.message)));

  // If the game calls start()/init() and runs a loop, nudge READY after next frame
  let raf = window.requestAnimationFrame;
  let loopDetected = false;
  window.requestAnimationFrame = function(fn){
    loopDetected = true;
    return raf.call(window, function(t){ fn(t); });
  };

  // Fallback READY if a loop appears
  setTimeout(function(){
    if (loopDetected) post("GAME_READY");
  }, 500);
})();