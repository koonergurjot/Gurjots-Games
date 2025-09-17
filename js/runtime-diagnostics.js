
// js/runtime-diagnostics.js — lightweight, opt-in game/runtime logger
(function(){
  if (window.__RUNTIME_DIAG__) return;
  window.__RUNTIME_DIAG__ = true;

  const start = performance.now();
  const logs = [];
  const push = (level, msg, extra) => {
    const entry = { t: +(performance.now()-start).toFixed(1), level, msg: String(msg) };
    if (extra) entry.extra = extra;
    logs.push(entry);
    try { parent && parent.postMessage({ type: 'DIAG_LOG', entry }, '*'); } catch(_) {}
  };

  // wrap console
  ['log','info','warn','error'].forEach(k=>{
    const orig = console[k];
    console[k] = function(...args){
      push(k, args.map(a=> typeof a==='string'?a:JSON.stringify(a)).join(' '));
      try{ orig.apply(console, args);}catch(_){}
    };
  });

  // window errors
  window.addEventListener('error', (e)=>{
    push('error', 'window.error', { message: e.message, source: e.filename, line: e.lineno, col: e.colno });
    try { parent && parent.postMessage({ type: 'GAME_ERROR', message: e.message }, '*'); } catch(_) {}
  });
  window.addEventListener('unhandledrejection', (e)=>{
    push('error', 'unhandledrejection', { reason: (e.reason && (e.reason.message || e.reason.toString())) || 'unknown' });
  });

  // simple heartbeat while loading
  let n=0; const hb = setInterval(()=>push('info', 'hb#'+(++n)), 1000);
  window.addEventListener('message', (ev)=>{
    if (ev?.data?.type === 'GAME_READY'){ clearInterval(hb); push('info','GAME_READY heard'); }
  });

  // expose a tiny helper
  window.DIAG = {
    ready(){ try { parent && parent.postMessage({ type:'GAME_READY' }, '*'); push('info','sent GAME_READY'); } catch(_){ } },
    error(message){ try { parent && parent.postMessage({ type:'GAME_ERROR', message }, '*'); push('error','sent GAME_ERROR: '+message); } catch(_){ } },
    dump(){ return logs.slice(); }
  };

  // auto-note
  push('info', 'runtime-diagnostics booted');
})();
