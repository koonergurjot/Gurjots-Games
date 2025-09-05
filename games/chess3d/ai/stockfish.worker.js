
/**
 * Placeholder worker. Replace with real Stockfish integration (see Phase 10a).
 */
self.addEventListener('message', (ev)=>{
  const data = ev.data || {};
  if (data.type === 'go'){
    // Fake engine: wait briefly and "pass"
    setTimeout(()=>{
      self.postMessage({ type:'bestmove', uci:null });
    }, 200);
  }
});
