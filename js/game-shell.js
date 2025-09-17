// js/game-shell.js — Diagnostics always on + readability
(function(){
  const qs = new URLSearchParams(location.search);
  const slug = qs.get('slug') || qs.get('id') || qs.get('game');
  const FORCE = qs.get('force'); // 'iframe' | 'script'
  const FORCE_MODULE = qs.has('module') ? (qs.get('module') === '1' || qs.get('module') === 'true') : null;
  const $ = (s)=>document.querySelector(s);
  const state = { iframe:null, timer:null, ready:false, logs:[] };

  function style(){
    if (document.getElementById('gg-shell-css')) return;
    const st = document.createElement('style'); st.id='gg-shell-css';
    st.textContent = `
    #error{position:absolute;inset:0;display:none;align-items:center;justify-content:center}
    #error.show{display:flex}
    #error .panel{background:rgba(10,16,46,.96);color:#f5f7ff;border:1px solid #3a4a8a;border-radius:12px;padding:14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.5);max-width:560px;font-size:15px;line-height:1.4}
    #error .details{background:#0b133b;border:1px solid #2a3a7a;color:#e8eefc;padding:10px;border-radius:8px;max-height:220px;overflow:auto;white-space:pre-wrap;margin-top:8px}
    #open-new,#btn-restart,.btn{background:#1b2a6b;color:#fff;border:1px solid #3d59b3;border-radius:10px;padding:8px 12px;display:inline-block}
    #open-new:hover,#btn-restart:hover,.btn:hover{background:#2546a3}
    #loader.loader{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:10px}
    #loader .dot{width:10px;height:10px;background:#aac6ff;border-radius:50%;animation:gg-bounce 1s infinite ease-in-out}
    #loader .dot:nth-child(2){animation-delay:.15s}#loader .dot:nth-child(3){animation-delay:.3s}
    @keyframes gg-bounce{0%,80%,100%{transform:scale(.6);opacity:.6}40%{transform:scale(1);opacity:1}}
    .diag-btn{position:fixed;right:12px;bottom:12px;z-index:1000}
    .diag-panel{position:fixed;right:12px;bottom:56px;background:#0b0f2a;color:#e8eefc;border:1px solid #25305a;border-radius:10px;padding:10px;width:420px;max-height:64vh;overflow:auto;display:none;box-shadow:0 10px 30px rgba(0,0,0,.4);font-size:13px;line-height:1.4}
    .diag-panel pre{white-space:pre-wrap;background:#0d153b;border:1px solid #2a3a7a;padding:8px;border-radius:8px;max-height:44vh;overflow:auto}
    .diag-panel .row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}`;
    document.head.appendChild(st);
  }

  function ensureOverlays(){
    const stage = document.getElementById('stage') || document.body;
    let loader = document.getElementById('loader');
    if (!loader){ loader = document.createElement('div'); loader.id='loader'; loader.className='loader'; loader.innerHTML='<div class="dot"></div><div class="dot"></div><div class="dot"></div>'; stage.appendChild(loader); }
    let err = document.getElementById('error');
    if (!err){
      err = document.createElement('div'); err.id='error'; err.className='error';
      err.innerHTML = '<div class="panel"><div class="message"></div><div class="toggle">Show details</div><pre class="details"></pre><div style="margin-top:10px;display:flex;gap:8px;justify-content:center"><button class="btn" id="btn-restart">Retry</button><a class="btn" id="open-new" target="_blank" rel="noopener">Open in new tab</a></div></div>';
      stage.appendChild(err);
    }
    const btn = err.querySelector('#btn-restart'); if (btn) btn.onclick = reloadGame;
    const openNew = err.querySelector('#open-new'); if (openNew) openNew.href = location.href;
    return { loader, err };
  }

  function showSoftLoading(){
    const {loader, err} = ensureOverlays();
    loader.style.display = 'none';
    err.classList.add('show');
    const m = err.querySelector('.message'); if (m) m.textContent = 'Still loading… This game may take longer on first load.';
    err.querySelector('.details').style.display='none';
    err.querySelector('.toggle').style.display='none';
  }

  function renderError(msg, e){
    const {loader, err} = ensureOverlays();
    loader.style.display='none'; err.classList.add('show');
    const d = err.querySelector('.details'); d.textContent = (e && (e.message||e.toString())) || ''; d.style.display='none';
    const m = err.querySelector('.message'); if (m) m.textContent = msg;
    const t = err.querySelector('.toggle'); t.onclick = ()=> d.style.display = (d.style.display==='none'?'block':'none');
  }

  function cacheBust(url){
    try{ const u = new URL(url, location.origin); if (qs.get('bust')==='1' || qs.get('debug')==='1') u.searchParams.set('_v', String(Date.now())); return u.pathname+(u.search||''); }catch(_){ return url; }
  }

  function diag(info, type, entry){
    let btn = document.getElementById('gg-diag-btn');
    if (!btn){ btn = document.createElement('button'); btn.id='gg-diag-btn'; btn.textContent='🧪 Diagnostics'; btn.className='btn diag-btn'; document.body.appendChild(btn); }
    let panel = document.getElementById('gg-diag');
    if (!panel){
      panel = document.createElement('div'); panel.id='gg-diag'; panel.className='diag-panel';
      panel.innerHTML = '<div style="font-weight:700;margin-bottom:6px">Game Diagnostics</div>' +
      '<div><b>Slug</b>: <span id="diag-slug"></span></div>' +
      '<div><b>Entry</b>: <span id="diag-entry"></span></div>' +
      '<div><b>Type</b>: <span id="diag-type"></span></div>' +
      '<div><b>Module</b>: <span id="diag-mod"></span></div>' +
      '<div><b>Ready</b>: <span id="diag-ready">false</span></div><hr>' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><div style="opacity:.9">Logs</div><div><button class="btn" id="diag-copy">Copy</button><button class="btn" id="diag-clear">Clear</button></div></div>' +
      '<pre id="diag-logs"></pre><div class="row"><button class="btn" id="diag-close">Close</button></div>';
      document.body.appendChild(panel);
    }
    document.getElementById('diag-slug').textContent = info.slug || slug;
    document.getElementById('diag-entry').textContent = entry;
    document.getElementById('diag-type').textContent = type + (FORCE? ' (forced)':'');
    document.getElementById('diag-mod').textContent = String((info.launch&&info.launch.module)||info.module||false);
    document.getElementById('diag-ready').textContent = String(state.ready);
    btn.onclick = ()=> panel.style.display = (panel.style.display==='none'?'block':'none');
    document.getElementById('diag-close').onclick = ()=> panel.style.display='none';
    document.getElementById('diag-copy').onclick = ()=> {
      const txt = 'slug='+slug+'\nentry='+entry+'\ntype='+type+'\nmodule='+String((info.launch&&info.launch.module)||info.module||false)+'\nready='+state.ready+'\n\n'+state.logs.map(l=>l.level.toUpperCase()+': '+l.msg).join('\n');
      navigator.clipboard.writeText(txt).catch(()=>{});
    };
    document.getElementById('diag-clear').onclick = ()=> { state.logs.length=0; document.getElementById('diag-logs').textContent=''; };

    // Hook parent console
    ['log','info','warn','error'].forEach(k=>{
      const orig = console[k];
      console[k] = function(...args){
        try{ orig.apply(console,args);}catch(_){}
        const str = args.map(a=> typeof a==='string'?a:JSON.stringify(a)).join(' ');
        state.logs.push({level:k,msg:str}); const sink=$('#diag-logs'); if (sink) sink.textContent += k.toUpperCase()+': '+str+'\n';
      };
    });

    // Hook iframe if same-origin
    if (state.iframe && state.iframe.contentWindow){
      try{
        const iw = state.iframe.contentWindow;
        iw.addEventListener('error', e=> console.error('[iframe] error:', e.message));
        iw.addEventListener('unhandledrejection', e=> console.error('[iframe] unhandledrejection:', (e.reason&&(e.reason.message||e.reason.toString()))));
        ['log','info','warn','error'].forEach(k=>{
          const orig = iw.console[k];
          iw.console[k] = function(...args){ try{ orig.apply(iw.console,args);}catch(_){}
            console[k]('[iframe]', ...args);
          };
        });
      }catch(_){ console.warn('iframe console hook skipped (cross-origin)'); }
    }
  }

  function boot(){
    style();
    if(!slug){ return render404('Missing ?slug='); }
    fetch('/games.json', {cache:'no-cache'}).then(r=>r.json()).then(catalog=>{
      const list = Array.isArray(catalog)? catalog : (catalog.games||[]);
      const info = list.find(g => (g.slug||g.id) === slug);
      if(!info) return render404('Unknown game: '+slug);
      renderShell(info); loadGame(info);
    }).catch(e=> renderError('Could not load games.json', e));
  }

  function renderShell(info){
    const title=$('#title'); if (title) title.textContent = info.title || info.name || slug;
    const about=$('#about-text'); if (about) about.textContent = info.description || info.short || 'Ready to play?';
  }

  function loadGame(info){
    const stage = document.getElementById('stage');
    const {loader, err} = ensureOverlays();
    err.classList.remove('show'); loader.style.display='flex';

    const entry = info.launch && info.launch.path || info.entry || info.url;
    const isModule = (info.launch && info.launch.module) || info.module || false;
    let type = (info.launch && info.launch.type) || (entry && entry.endsWith('.html') ? 'iframe' : 'script');
    if (FORCE==='iframe') type='iframe'; else if (FORCE==='script') type='script';

    if (type==='iframe'){
      const f = document.createElement('iframe'); f.id='frame'; f.allow='autoplay; fullscreen'; f.src = cacheBust(entry);
      f.onload = ()=> console.info('iframe loaded:', entry);
      f.onerror = (e)=> { console.error('iframe onerror'); renderError('Failed to load game iframe', e); };
      if (stage) stage.innerHTML=''; (stage||document.body).appendChild(f);
      state.iframe = f; diag(info, type, entry);
    } else {
      if (stage) stage.innerHTML='<div id="game-root"></div><canvas id="gameCanvas" width="800" height="600" aria-label="Game canvas"></canvas>';
      const s = document.createElement('script'); if ((FORCE_MODULE!=null?FORCE_MODULE:isModule)) s.type='module';
      s.src = cacheBust(entry); s.onerror = (e)=> { console.error('script load error:', entry); renderError('Failed to load game script', e); };
      document.body.appendChild(s); diag(info, type, entry);
    }

    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(()=>{
      loader.style.display='none';
      if (!state.ready){ showSoftLoading(); console.warn('No GAME_READY from game within timeout'); }
    }, 7000);
  }

  function reloadGame(){ if (state.iframe){ const u=state.iframe.src; state.iframe.src=u; } else { location.reload(); }}

  window.addEventListener('message', (ev)=>{
    const d=ev.data||{};
    if (d.type==='GAME_READY'){ state.ready=true; ensureOverlays().loader.style.display='none'; $('#error')?.classList.remove('show'); $('#diag-ready') and (document.getElementById('diag-ready').textContent='true'); console.info('[event] GAME_READY'); }
    else if (d.type==='GAME_ERROR'){ console.error('[event] GAME_ERROR:', d.message||''); renderError('Game error', {message:d.message||'Unknown error'}); }
    else if (d.type==='DIAG_LOG'){ const e=d.entry; if (e) console[e.level||'info'](e.msg); }
  });

  function render404(msg){
    const root=$('#app'); root.innerHTML='<div class="container"><div class="card"><h2>Game not found</h2><p>'+msg+'</p><p><a class="btn" href="./">← Back to Home</a></p></div></div>';
  }

  boot();
})();