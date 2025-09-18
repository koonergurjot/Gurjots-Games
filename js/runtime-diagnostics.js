// js/runtime-diagnostics.js — stop HB after READY (self-contained)
(function(){
  if (window.__RUNTIME_DIAG__) return;
  window.__RUNTIME_DIAG__ = true;

  const start = performance.now();
  let hbTimer = null;
  const logs = [];
  const push = (level, msg, extra) => {
    const entry = { t: +(performance.now()-start).toFixed(1), level, msg: String(msg) };
    if (extra) entry.extra = extra;
    logs.push(entry);
    try { parent && parent.postMessage({ type: 'DIAG_LOG', entry }, '*'); } catch(_) {}
  };

  function formatArg(arg) {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) {
      if (arg.stack) return String(arg.stack);
      if (arg.message) return String(arg.message);
    }
    try {
      return String(arg);
    } catch (_) {
      try { return Object.prototype.toString.call(arg); } catch (__) { return '[unrenderable]'; }
    }
  }

  ['log','info','warn','error'].forEach(k=>{
    const orig = console[k];
    console[k] = function(...args){
      push(k, args.map(formatArg).join(' '));
      try{ orig.apply(console, args);}catch(_){}
    };
  });

  function stopHB(){ if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }

  window.addEventListener('error', (e)=>{
    push('error', 'window.error', { message: e.message, source: e.filename, line: e.lineno, col: e.colno });
    try { parent && parent.postMessage({ type: 'GAME_ERROR', message: e.message }, '*'); } catch(_) {}
  });
  window.addEventListener('unhandledrejection', (e)=>{
    push('error', 'unhandledrejection', { reason: (e.reason && (e.reason.message || e.reason.toString())) || 'unknown' });
  });

  hbTimer = setInterval(()=>push('info', 'hb#'+Math.round((performance.now()-start)/1000)), 1000);

  window.addEventListener('message', (ev)=>{
    if (ev?.data?.type === 'GAME_READY'){ stopHB(); push('info','GAME_READY heard'); }
  });

  window.DIAG = {
    ready(){
      stopHB();
      try { parent && parent.postMessage({ type:'GAME_READY' }, '*'); push('info','sent GAME_READY'); } catch(_){ }
    },
    error(message){
      stopHB();
      try { parent && parent.postMessage({ type:'GAME_ERROR', message }, '*'); push('error','sent GAME_ERROR: '+message); } catch(_){ }
    },
    dump(){ return logs.slice(); }
  };

  push('info', 'runtime-diagnostics booted');
})();
