(async function(){
  const params = new URLSearchParams(location.search);
  const slug = params.get('id') || params.get('slug');
  if(!slug){ console.error('[loader] missing slug'); return; }

  function loadModule(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.type='module'; s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
  function loadClassic(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
  async function ensureHelpers(){
    try{ await loadClassic('/shared/gg-shim.js'); }catch{}
    try{ await loadClassic('/js/preflight.js'); }catch{}
    try{ await loadClassic('/js/three-global-shim.js'); }catch{}
  }
  await ensureHelpers();

  (function(){
    const root = document.getElementById('game-root') || (function(){ const d=document.createElement('div'); d.id='game-root'; document.body.appendChild(d); return d; })();
    const ids=['status','level','lives','board','game','c','canvas','gameCanvas','fx','hud','score','t'];
    ids.forEach(id=>{
      if(document.getElementById(id)) return;
      const el = (id==='c'||id==='board'||id==='game'||id==='canvas'||id==='gameCanvas'||id==='fx'||id==='t') ? document.createElement('canvas') : document.createElement('div');
      el.id=id; root.appendChild(el);
      if (el.tagName==='CANVAS' && typeof window.fitCanvasToParent==='function') window.fitCanvasToParent(el);
    });
  })();

  try{
    const moduleTag = document.querySelector('script[type=\"module\"][data-entry]');
    if (!moduleTag){
      const guess = ['/games/'+slug+'/main.js','/games/'+slug+'/'+slug+'.js','/games/'+slug+'/index.js','/games/'+slug+'/engine.js'];
      let loaded=false;
      for(const url of guess){
        try{ await loadModule(url); console.log('[loader] loaded (module)', url); loaded=true; break; }catch(e1){
          try{ await loadClassic(url); console.log('[loader] loaded (classic)', url); loaded=true; break; }catch(e2){}
        }
      }
      if(!loaded) console.warn('[loader] no known entry found; relying on page self-boot');
    }

    const boot = window.GameInit||window.init||window.startGame||window.start||window.boot;
    if(typeof boot==='function'){ boot({ mount:'#game-root', meta:{slug} }); }
    window.parent?.postMessage?.({type:'GAME_READY', slug}, '*');
  }catch(e){
    console.error('[loader] error', e);
    window.parent?.postMessage?.({type:'GAME_ERROR', slug, message:String(e?.message||e)}, '*');
  }
})();