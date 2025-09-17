// js/game-shell.js — with contrast/readability fixes for overlays
const qs = new URLSearchParams(location.search);
const DEBUG = qs.get('debug') === '1' || qs.get('debug') === 'true';
const FORCE = qs.get('force'); // 'iframe' | 'script'
const FORCE_MODULE = qs.has('module') ? (qs.get('module') === '1' || qs.get('module') === 'true') : null;
const slug = qs.get('slug') || qs.get('id') || qs.get('game');
var $ = function(s){ return document.querySelector(s); };

function el(tag, cls){ var e = document.createElement(tag); if(cls) e.className = cls; return e; }

var state = { timer:null, muted:true, gameInfo:null, iframe:null };

// NEW: inject high-contrast styles for shell overlays
function injectShellStyles(){
  if (document.getElementById('gg-shell-contrast')) return;
  var style = document.createElement('style');
  style.id = 'gg-shell-contrast';
  style.textContent = `
  /* shell overlay readability */
  #error { position:absolute; inset:0; display:none; align-items:center; justify-content:center; }
  #error.show { display:flex; }
  #error .panel{
    background: rgba(10, 16, 46, 0.96);
    color: #f5f7ff;
    border: 1px solid #3a4a8a;
    border-radius: 12px;
    padding: 14px 16px;
    box-shadow: 0 12px 40px rgba(0,0,0,.5);
    max-width: 520px;
    line-height: 1.4;
    font-size: 15px;
  }
  #error .message{ font-weight:700; margin-bottom:6px; }
  #error .toggle{ margin-top:8px; cursor:pointer; opacity:.9; text-decoration:underline; }
  #error .details{
    background: #0b133b;
    border: 1px solid #2a3a7a;
    color: #e8eefc;
    padding: 10px;
    border-radius: 8px;
    max-height: 220px;
    overflow:auto;
    margin-top:8px;
  }
  #open-new, #btn-restart, .btn{
    background:#1b2a6b;
    color:#ffffff;
    border:1px solid #3d59b3;
    border-radius:10px;
    padding:8px 12px;
    display:inline-block;
  }
  #open-new:hover, #btn-restart:hover, .btn:hover{
    background:#2546a3;
  }
  /* loader dots more visible */
  #loader.loader{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:10px; }
  #loader .dot{ width:10px; height:10px; background:#aac6ff; border-radius:50%; animation: gg-bounce 1s infinite ease-in-out; }
  #loader .dot:nth-child(2){ animation-delay:.15s } 
  #loader .dot:nth-child(3){ animation-delay:.3s }
  @keyframes gg-bounce { 0%,80%,100%{ transform:scale(0.6); opacity:.6 } 40%{ transform:scale(1); opacity:1 } }
  `;
  document.head.appendChild(style);
}

function cacheBust(url) {
  try {
    var u = new URL(url, location.origin);
    if (qs.get('bust') === '1' || DEBUG) {
      u.searchParams.set('_v', String(Date.now()));
    }
    return u.pathname + (u.search ? u.search : '');
  } catch(_) { return url; }
}

async function boot(){
  injectShellStyles();
  if(!slug){ return render404("Missing ?slug= parameter"); }
  var catalog;
  try{
    var res = await fetch('/games.json', {cache:'no-cache'});
    catalog = await res.json();
  }catch(e){ return renderError("Could not load games.json", e); }
  var list = Array.isArray(catalog) ? catalog : (catalog.games || []);
  var info = list.find(function(g){ return (g.slug||g.id) === slug; });
  if(!info){ return render404("Unknown game: "+slug); }
  state.gameInfo = info;
  renderShell(info);
  loadGame(info);
}

function render404(msg){
  var root = $('#app');
  root.innerHTML = '\n    <div class="container">\n      <div class="card">\n        <h2>Game not found</h2>\n        <p>'+msg+'</p>\n        <p><a class="btn" href="./">← Back to Home</a></p>\n      </div>\n    </div>';
}

function renderShell(info){
  var title = $('#title'); if (title) title.textContent = info.title || info.name || slug;
  var tags = info.tags || info.genres || [];
  var t = $('.tags'); if (t){ t.innerHTML=''; tags.slice(0,6).forEach(function(tag){ var chip = el('span','tag'); chip.textContent = tag; t.appendChild(chip); }); }

  var about = $('#about-text'); if (about) about.textContent = info.description || info.short || 'Ready to play?';
  var openNew = document.getElementById('open-new'); if (openNew) openNew.href = location.href;

  var cl = document.getElementById('controls-list');
  if (cl) cl.innerHTML = '\n    <li><kbd>← →</kbd> Move</li>\n    <li><kbd>Space</kbd> Action / Jump</li>\n    <li><kbd>P</kbd> Pause</li>\n    <li><kbd>F</kbd> Fullscreen</li>';

  var btnRestart = document.getElementById('btn-restart'); if (btnRestart) btnRestart.onclick = function(){ reloadGame(); };
  var btnFs = document.getElementById('btn-fullscreen'); if (btnFs) btnFs.onclick = function(){
    var stage = $('#stage');
    var req = stage && (stage.requestFullscreen || stage.webkitRequestFullscreen || stage.msRequestFullscreen);
    if (req) try{ req.call(stage); }catch(_){}
  };
  var btnMute = document.getElementById('btn-mute'); if (btnMute) btnMute.onclick = function(){ toggleMute(); };
  var btnHow = document.getElementById('btn-how'); if (btnHow) btnHow.onclick = function(){ var a=document.getElementById('about'); if (a) a.scrollIntoView({behavior:'smooth'}); };

  document.addEventListener('visibilitychange', function(){
    if(document.hidden){ try { window.postMessage({type:'GAME_PAUSE'}, '*'); } catch(_){ } }
  });
}

function loadGame(info){
  var stage = $('#stage');
  var overlays = ensureOverlays();
  var loader = overlays.loader, err = overlays.err;
  try { err.classList.remove('show'); } catch(_){}
  try { loader.style.display = 'flex'; } catch(_){}

  ensureLegacyElements();

  var entry = info.launch && info.launch.path || info.entry || info.url;
  var isModule = (info.launch && info.launch.module) || info.module || false;
  var type = (info.launch && info.launch.type) || (entry && entry.endsWith('.html') ? 'iframe' : 'script');
  if (FORCE === 'iframe') type = 'iframe'; else if (FORCE === 'script') type = 'script';

  if(type === 'iframe'){
    var debugEntry = DEBUG ? (entry + (entry.indexOf('?')>=0?'&':'?') + 'debug=1') : entry;
    var iframe = document.createElement('iframe');
    iframe.id = 'frame';
    iframe.allow = 'autoplay; fullscreen';
    iframe.src = cacheBust(debugEntry);
    iframe.onload = function(){ /* wait for GAME_READY */ };
    if (stage) stage.innerHTML = '';
    (stage || document.body).appendChild(iframe);
    state.iframe = iframe;
    createDiagUI(info, type, debugEntry);
  } else {
    if (stage) stage.innerHTML = '<div id="game-root"></div><canvas id="gameCanvas" width="800" height="600" aria-label="Game canvas"></canvas>';
    if (DEBUG) {
      var d = document.createElement('script');
      d.src = '/js/runtime-diagnostics.js';
      document.body.appendChild(d);
    }
    var s = document.createElement('script');
    var useModule = (FORCE_MODULE !== null) ? FORCE_MODULE : isModule;
    if(useModule){ s.type='module'; }
    s.src = cacheBust(entry);
    s.onerror = function(e){ renderError('Failed to load game script', e); };
    document.body.appendChild(s);
    createDiagUI(info, type, entry);
  }

  if(state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(function(){
    var overlays2 = ensureOverlays();
    try { overlays2.loader.style.display = 'none'; } catch(_){}
    showSoftLoading();
  }, 6000);
}

function reloadGame(){
  if(state.iframe){
    var src = state.iframe.src; state.iframe.src = src;
  } else {
    location.reload();
  }
}

function toggleMute(){
  state.muted = !state.muted;
  var btn = document.getElementById('btn-mute'); if (btn) btn.innerText = state.muted ? 'Unmute' : 'Mute';
  try{
    if(state.iframe && state.iframe.contentWindow){
      state.iframe.contentWindow.postMessage({type:'GAME_MUTE', muted: state.muted}, '*');
    }
  }catch(e){}
}

function ensureLegacyElements(){
  if(!document.getElementById('game')) { var d = document.createElement('div'); d.id = 'game'; d.style.position='relative'; document.body.appendChild(d); }
  if(!document.getElementById('game-root')){ var d2 = document.createElement('div'); d2.id = 'game-root'; document.body.appendChild(d2); }
  if(!document.getElementById('gameCanvas')){ var c = document.createElement('canvas'); c.id='gameCanvas'; c.width=800; c.height=600; c.setAttribute('aria-label','Game canvas'); document.body.appendChild(c); }
}

function ensureOverlays(){
  var stage = document.getElementById('stage') || document.body;

  var loader = document.getElementById('loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'loader';
    loader.className = 'loader';
    loader.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    stage.appendChild(loader);
  }

  var err = document.getElementById('error');
  if (!err) {
    err = document.createElement('div');
    err.id = 'error';
    err.className = 'error';
    err.innerHTML = '\n      <div class="panel">\n        <div class="message"></div>\n        <div class="toggle">Show details</div>\n        <pre class="details"></pre>\n        <div style="margin-top:10px;display:flex;gap:8px;justify-content:center">\n          <button class="btn" id="btn-restart">Retry</button>\n          <a class="btn" id="open-new" target="_blank" rel="noopener">Open in new tab</a>\n        </div>\n      </div>';
    stage.appendChild(err);
  }

  var btn = err.querySelector('#btn-restart');
  if (btn) btn.onclick = function(){ reloadGame(); };
  var openNew = err.querySelector('#open-new');
  if (openNew) openNew.href = location.href;

  return { loader: loader, err: err };
}

function showSoftLoading(){
  var _ov = ensureOverlays();
  var loader = _ov.loader, err = _ov.err;
  try { loader.style.display = 'none'; } catch(_) {}
  try { err.classList.add('show'); } catch(_) {}
  var msg = err.querySelector('.message'); if (msg) msg.textContent = 'Still loading… This game may take longer on first load.';
  var details = err.querySelector('.details'); if (details) details.style.display = 'none';
  var toggle = err.querySelector('.toggle'); if (toggle) toggle.style.display = 'none';
}

function renderError(msg, e){
  var _ov = ensureOverlays();
  var loader = _ov.loader, err = _ov.err;
  try { loader.style.display='none'; } catch(_) {}
  try { err.classList.add('show'); } catch(_) {}
  var d = err.querySelector('.details');
  if (d) { d.textContent = (e && (e.message || e.toString())) || ''; d.style.display = 'none'; }
  var m = err.querySelector('.message'); if (m) m.textContent = msg;
  var tog = err.querySelector('.toggle');
  if (tog && d) tog.onclick = function(){ d.style.display = (d.style.display==='none' ? 'block' : 'none'); };
}

window.addEventListener('message', function(ev){
  var data = ev.data || {};
  if(data.type === 'GAME_READY'){
    var _ov = ensureOverlays();
    try { _ov.loader.style.display='none'; } catch(_) {}
    try { _ov.err.classList.remove('show'); } catch(_) {}
  } else if(data.type === 'GAME_ERROR'){
    renderError('Game error', {message: data.message || 'Unknown error'});
  }
});

function createDiagUI(info, type, entry) {
  if (!DEBUG) return;
  var btn = document.createElement('button');
  btn.textContent = '🧪 Diagnostics';
  btn.style.position='fixed'; btn.style.right='12px'; btn.style.bottom='12px';
  btn.style.zIndex='1000'; btn.className='btn';
  document.body.appendChild(btn);

  var panel = document.createElement('div');
  panel.style.position='fixed'; panel.style.right='12px'; panel.style.bottom='56px';
  panel.style.background='#0b0f2a'; panel.style.color='#e8eefc';
  panel.style.border='1px solid #25305a'; panel.style.borderRadius='10px';
  panel.style.padding='10px'; panel.style.width='360px'; panel.style.maxHeight='60vh'; panel.style.overflow='auto';
  panel.style.display='none'; panel.style.boxShadow='0 10px 30px rgba(0,0,0,.4)';
  var forced = FORCE ? ' (forced)' : '';
  var meta = ''+
    '<div style="font-weight:700;margin-bottom:6px">Game Diagnostics</div>'+
    '<div><b>Slug</b>: ' + (info.slug || 'n/a') + '</div>'+
    '<div><b>Title</b>: ' + (info.title || 'n/a') + '</div>'+
    '<div><b>Entry</b>: ' + entry + '</div>'+
    '<div><b>Type</b>: ' + type + forced + '</div>'+
    '<div><b>Module</b>: ' + String((info.launch && info.launch.module) || info.module || false) + '</div>'+
    '<hr style="border-color:#25305a">'+
    '<div id="diag-logs" style="font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap"></div>';
  panel.innerHTML = meta;
  document.body.appendChild(panel);

  btn.onclick = function(){ panel.style.display = (panel.style.display==='none'?'block':'none'); };

  var sink = panel.querySelector('#diag-logs');
  var add = function(e){
    try{
      var d = e.data;
      if(d && d.type==='DIAG_LOG'){
        var ent = d.entry;
        sink.textContent += '[+'+ent.t+'ms] '+String(ent.level||'LOG').toUpperCase()+': '+ent.msg+'\n';
      } else if (d && d.type==='GAME_READY') {
        sink.textContent += '[event] GAME_READY\n';
      } else if (d && d.type==='GAME_ERROR') {
        sink.textContent += '[event] GAME_ERROR: '+ (d.message||'') + '\n';
      }
    }catch(_){}
  };
  window.addEventListener('message', add);

  window.addEventListener('error', function(e){
    sink.textContent += '[shell] window.error: '+e.message+'\n';
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason && (e.reason.message || e.reason.toString());
    sink.textContent += '[shell] unhandledrejection: '+ r +'\n';
  });
}

boot();
