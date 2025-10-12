// js/game-shell.js — with contrast/readability fixes for overlays
const qs = new URLSearchParams(location.search);
const DEBUG = qs.get('debug') === '1' || qs.get('debug') === 'true';
const FORCE = qs.get('force'); // 'iframe' | 'script'
const FORCE_MODULE = qs.has('module') ? (qs.get('module') === '1' || qs.get('module') === 'true') : null;
// Feature flag for Diagnostics v2
let diagV2Flag = false;
try {
  const stored = localStorage.getItem('diag_v2');
  diagV2Flag = stored === '1' || stored === 'true';
} catch (_err) {
  diagV2Flag = false;
}
const DIAG_V2 = diagV2Flag;

if (typeof window !== 'undefined') {
  try {
    const features = (typeof window.__GG_FEATURES === 'object' && window.__GG_FEATURES) ? window.__GG_FEATURES : {};
    features.diag_v2 = DIAG_V2;
    window.__GG_FEATURES = features;
    const existingOpts = (typeof window.__GG_DIAG_OPTS === 'object' && window.__GG_DIAG_OPTS) ? window.__GG_DIAG_OPTS : {};
    const mergedOpts = Object.assign({}, existingOpts, { diagV2: DIAG_V2 });
    if (DIAG_V2) {
      mergedOpts.suppressButton = true;
    }
    window.__GG_DIAG_OPTS = mergedOpts;
  } catch (_err) {
    // ignore
  }
}
const slug = qs.get('slug') || qs.get('id') || qs.get('game');
var $ = function(s){ return document.querySelector(s); };

function el(tag, cls){ var e = document.createElement(tag); if(cls) e.className = cls; return e; }

var state = { timer:null, failTimer:null, muted:true, gameInfo:null, iframe:null };
var diagState = { sink:null, listenerBound:false, errorListenerBound:false };
var diagV2State = {
  initialized: false,
  pending: [],
  bus: null,
  loadPromise: null,
  overlay: null,
  overlayPromise: null,
  overlayApi: null,
  overlayQueue: [],
  overlayScriptPromise: null,
  shortcutBound: false,
  consoleWrapped: false,
  errorBound: false,
  buttonReady: false,
  stylesLoaded: false,
  loadStartedAt: null,
  mountDuration: null,
  currentSlug: slug || '—',
  assetsModulePromise: null,
  supportScriptsPromise: null,
  assetPreflightPromise: null,
  assetScanState: null,
  assetScanToken: 0,
  assetScanRefreshTimer: null
};

function cleanupLegacyDiagnosticsUI() {
  if (!DIAG_V2) return;

  ['#diag-btn', '#diag-panel'].forEach(function(sel){
    try {
      var node = document.querySelector(sel);
      if (node && typeof node.remove === 'function') {
        node.remove();
      }
    } catch(_){ }
  });

  diagState.sink = null;
}

async function fetchCatalogJSON(init){
  var urls = ['/games.json', '/public/games.json'];
  var lastError = null;
  for (var i = 0; i < urls.length; i++) {
    try {
      var res = await fetch(urls[i], init);
      if (!res || !res.ok) throw new Error('bad status ' + (res && res.status));
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('catalog unavailable');
}

function clearBootTimers(){
  try {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  } catch(_){ }
  try {
    if (state.failTimer) {
      clearTimeout(state.failTimer);
      state.failTimer = null;
    }
  } catch(_){ }
}

function setLoaderVisibility(loader, isVisible) {
  if (!loader) return;
  try { loader.style.display = isVisible ? 'flex' : 'none'; } catch(_){}
  try { loader.setAttribute('aria-hidden', isVisible ? 'false' : 'true'); } catch(_){}
  try { loader.setAttribute('aria-busy', isVisible ? 'true' : 'false'); } catch(_){}
}

function setLoaderMessage(loader, text) {
  if (!loader) return;
  var node = loader.querySelector('.loader-text');
  if (node) node.textContent = text;
}

function setErrorVisibility(err, isVisible) {
  if (!err) return;
  try {
    if (isVisible) { err.classList.add('show'); }
    else { err.classList.remove('show'); }
  } catch(_){}
  try { err.setAttribute('aria-hidden', isVisible ? 'false' : 'true'); } catch(_){}
}

function ensureCanvasLabels(root) {
  var scope = root || document;
  if (!scope || !scope.querySelectorAll) return;
  try {
    var canvases = scope.querySelectorAll('canvas');
    var unlabeledCount = 0;
    for (var i = 0; i < canvases.length; i++) {
      var canvas = canvases[i];
      if (!canvas) continue;
      if (canvas.hasAttribute('aria-label') || canvas.hasAttribute('aria-labelledby')) continue;
      canvas.setAttribute('role', 'img');
      var label = 'Game canvas';
      try {
        if (state.gameInfo && state.gameInfo.title) {
          label += ': ' + state.gameInfo.title;
        }
      } catch(_){}
      unlabeledCount += 1;
      if (unlabeledCount > 1) {
        label += ' (' + unlabeledCount + ')';
      }
      canvas.setAttribute('aria-label', label);
    }
  } catch(_){ }
}

// NEW: inject high-contrast styles for shell overlays
function injectShellStyles(){
  if (document.getElementById('gg-shell-contrast')) return;
  var style = document.createElement('style');
  style.id = 'gg-shell-contrast';
  style.textContent = `
  /* shell overlay readability */
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); border:0; white-space:nowrap; }
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
  #error .toggle{ margin-top:8px; cursor:pointer; opacity:.9; text-decoration:underline; background:none; border:0; color:inherit; font:inherit; }
  #error .toggle:focus-visible{ outline:2px solid #89b4ff; outline-offset:2px; }
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
  #loader.loader{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
  #loader .loader-inner{ display:flex; flex-direction:column; align-items:center; gap:12px; background:rgba(10,16,46,0.92); padding:16px 20px; border-radius:12px; border:1px solid #3a4a8a; box-shadow:0 12px 40px rgba(0,0,0,.5); text-align:center; }
  #loader .loader-text{ font-size:16px; font-weight:600; color:#f5f7ff; }
  #loader .loader-dots{ display:flex; gap:10px; }
  #loader .dot{ width:10px; height:10px; background:#aac6ff; border-radius:50%; animation: gg-bounce 1s infinite ease-in-out; }
  #loader .dot:nth-child(2){ animation-delay:.15s }
  #loader .dot:nth-child(3){ animation-delay:.3s }
  @keyframes gg-bounce { 0%,80%,100%{ transform:scale(0.6); opacity:.6 } 40%{ transform:scale(1); opacity:1 } }
  `;
  document.head.appendChild(style);
}

function ensureRuntimeDiagnostics(targetDoc) {
  var doc = targetDoc || document;
  try {
    if (!doc) return;
    if (doc.getElementById('__runtime-diag')) return;
    var script = doc.createElement('script');
    script.id = '__runtime-diag';
    script.src = '/js/runtime-diagnostics.js';
    var host = doc.body || doc.head || doc.documentElement;
    if (host) {
      host.appendChild(script);
    }
  } catch (err) {
    try { console.warn('Failed to inject runtime diagnostics', err); } catch(_){ }
  }
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
    catalog = await fetchCatalogJSON({cache:'no-cache'});
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

  cleanupLegacyDiagnosticsUI();
}

function resolveLaunchEntry(info) {
  var fallback = (info && info.launch && info.launch.path) || (info && info.entry) || (info && info.url) || '';
  var base = (info && (info.playUrl || info.path)) || fallback;
  if (!base) return '';
  try {
    var parsed = new URL(base, location.origin);
    var path = parsed.pathname || '';
    var lastSegment = path.substring(path.lastIndexOf('/') + 1);
    if (!lastSegment || lastSegment.indexOf('.') === -1) {
      if (!path.endsWith('/')) path += '/';
      path += 'index.html';
    }
    parsed.pathname = path;
    return parsed.pathname + (parsed.search || '') + (parsed.hash || '');
  } catch (_err) {
    try {
      var withoutHash = base;
      var hashIndex = withoutHash.indexOf('#');
      var hash = '';
      if (hashIndex >= 0) {
        hash = withoutHash.substring(hashIndex);
        withoutHash = withoutHash.substring(0, hashIndex);
      }
      var queryIndex = withoutHash.indexOf('?');
      var query = '';
      if (queryIndex >= 0) {
        query = withoutHash.substring(queryIndex);
        withoutHash = withoutHash.substring(0, queryIndex);
      }
      var pathOnly = withoutHash;
      var seg = pathOnly.substring(pathOnly.lastIndexOf('/') + 1);
      if (!seg || seg.indexOf('.') === -1) {
        if (pathOnly && !pathOnly.endsWith('/')) pathOnly += '/';
        pathOnly += 'index.html';
      }
      return pathOnly + query + hash;
    } catch(__err) {
      return base;
    }
  }
}

function appendQueryParam(url, key, value) {
  if (!url) return url;
  try {
    var parsed = new URL(url, location.origin);
    parsed.searchParams.set(key, value);
    return parsed.pathname + (parsed.search || '') + (parsed.hash || '');
  } catch(_) {
    var hasQuery = url.indexOf('?') >= 0;
    return url + (hasQuery ? '&' : '?') + encodeURIComponent(key) + '=' + encodeURIComponent(value);
  }
}

function loadGame(info){
  var stage = $('#stage');
  var overlays = ensureOverlays();
  var loader = overlays.loader, err = overlays.err;
  diagV2State.loadStartedAt = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now();
  diagV2State.mountDuration = null;
  var slugValue = (info && (info.slug || info.id || info.game)) || slug || '—';
  diagV2State.currentSlug = slugValue;
  if (diagV2State.overlayApi && typeof diagV2State.overlayApi.setMeta === 'function') {
    try {
      diagV2State.overlayApi.setMeta({ mountTimeMs: null, slug: diagV2State.currentSlug });
    } catch(_){ }
  }
  triggerAssetPreflight(info);
  setErrorVisibility(err, false);
  if (err) {
    err.setAttribute('role', 'status');
    err.setAttribute('aria-live', 'polite');
  }
  var gameName = info && (info.title || info.name || info.slug || slug) || 'game';
  setLoaderMessage(loader, 'Loading ' + gameName + '…');
  setLoaderVisibility(loader, true);

  ensureLegacyElements();
  ensureCanvasLabels(stage || document);

  var fallbackEntry = (info && info.launch && info.launch.path) || (info && info.entry) || (info && info.url) || '';
  var resolvedEntry = resolveLaunchEntry(info);
  var candidate = resolvedEntry || fallbackEntry;
  var isModule = (info.launch && info.launch.module) || info.module || false;

  var type;
  if (candidate) {
    var entryPath = candidate.split('#')[0];
    entryPath = entryPath.split('?')[0];
    var lower = entryPath.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      type = 'iframe';
    } else {
      type = 'script';
    }
  } else {
    type = 'script';
  }

  var loadTarget = candidate;

  if (!loadTarget) {
    setLoaderVisibility(loader, false);
    renderError('Game missing launch entry', {message: 'No playable URL defined for this game.'});
    return;
  }

  if (FORCE === 'iframe') type = 'iframe'; else if (FORCE === 'script') type = 'script';

  if (type === 'iframe' && DEBUG && loadTarget) {
    loadTarget = appendQueryParam(loadTarget, 'debug', '1');
  }

  var cachedTarget = loadTarget ? cacheBust(loadTarget) : '';

  if(type === 'iframe'){
    var iframe = document.createElement('iframe');
    iframe.id = 'frame';
    iframe.allow = 'autoplay; fullscreen';
    iframe.src = cachedTarget;
    iframe.onload = function(){ /* wait for GAME_READY */ };
    iframe.addEventListener('load', function(){
      try {
        var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
        ensureRuntimeDiagnostics(doc);
      } catch(_){ }
    });
    if (stage) stage.innerHTML = '';
    (stage || document.body).appendChild(iframe);
    state.iframe = iframe;
    if (!DIAG_V2) {
      createDiagUI(info, type, resolvedEntry, loadTarget);
    }
  } else {
    if (stage) stage.innerHTML = '<div id="game-root"></div><canvas id="gameCanvas" width="800" height="600" aria-label="Game canvas" role="img"></canvas>';
    ensureRuntimeDiagnostics(document);
    var s = document.createElement('script');
    var useModule = (FORCE_MODULE !== null) ? FORCE_MODULE : isModule;
    if(useModule){ s.type='module'; }
    s.src = cachedTarget;
    s.onerror = function(e){ renderError('Failed to load game script', e); };
    document.body.appendChild(s);
    if (!DIAG_V2) {
      createDiagUI(info, type, resolvedEntry, loadTarget);
    }
    ensureCanvasLabels(stage || document);
  }

  clearBootTimers();
  state.timer = setTimeout(function(){
    var overlays2 = ensureOverlays();
    setLoaderVisibility(overlays2.loader, false);
    showSoftLoading();
  }, 6000);
  state.failTimer = setTimeout(function(){
    var overlays3 = ensureOverlays();
    setLoaderVisibility(overlays3.loader, false);
    renderError('Game failed to start', {message: 'We never received GAME_READY. The game may have crashed during load.'});
  }, 15000);
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
  if(!document.getElementById('gameCanvas')){ var c = document.createElement('canvas'); c.id='gameCanvas'; c.width=800; c.height=600; c.setAttribute('role','img'); c.setAttribute('aria-label','Game canvas'); document.body.appendChild(c); }
  ensureCanvasLabels(document);
}

function ensureOverlays(){
  var stage = document.getElementById('stage') || document.body;

  var loader = document.getElementById('loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'loader';
    loader.className = 'loader';
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-live', 'polite');
    loader.setAttribute('aria-atomic', 'true');
    loader.setAttribute('aria-hidden', 'false');
    loader.setAttribute('aria-busy', 'true');
    loader.innerHTML = '<div class="loader-inner"><div class="loader-text">Loading game…</div><div class="loader-dots" aria-hidden="true"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>';
    stage.appendChild(loader);
  }

  var err = document.getElementById('error');
  if (!err) {
    err = document.createElement('div');
    err.id = 'error';
    err.className = 'error';
    err.setAttribute('role', 'status');
    err.setAttribute('aria-live', 'polite');
    err.setAttribute('aria-atomic', 'true');
    err.setAttribute('aria-hidden', 'true');
    err.setAttribute('aria-labelledby', 'error-message');
    err.setAttribute('aria-describedby', 'error-details');
    err.innerHTML = `
        <div class="panel">
          <div class="message" id="error-message"></div>
          <button type="button" class="toggle" aria-expanded="false">Show details</button>
          <pre class="details" id="error-details" aria-hidden="true"></pre>
          <div style="margin-top:10px;display:flex;gap:8px;justify-content:center">
            <button class="btn" id="btn-restart">Retry</button>
            <a class="btn" id="open-new" target="_blank" rel="noopener">Open in new tab</a>
          </div>
        </div>`;
    stage.appendChild(err);
  }

  var btn = err.querySelector('#btn-restart');
  if (btn) btn.onclick = function(){ reloadGame(); };
  var openNew = err.querySelector('#open-new');
  if (openNew) openNew.href = location.href;
  var details = err.querySelector('.details');
  if (details) {
    details.style.display = 'none';
    details.setAttribute('aria-hidden', 'true');
  }
  var toggle = err.querySelector('.toggle');
  if (toggle && details) {
    toggle.style.display = '';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.onclick = function(){
      var hidden = details.style.display === 'none';
      details.style.display = hidden ? 'block' : 'none';
      details.setAttribute('aria-hidden', hidden ? 'false' : 'true');
      toggle.textContent = hidden ? 'Hide details' : 'Show details';
      toggle.setAttribute('aria-expanded', hidden ? 'true' : 'false');
    };
  }

  return { loader: loader, err: err };
}


function showSoftLoading(){
  var _ov = ensureOverlays();
  var loader = _ov.loader, err = _ov.err;
  setLoaderVisibility(loader, false);
  if (err) {
    err.setAttribute('role', 'status');
    err.setAttribute('aria-live', 'polite');
  }
  setErrorVisibility(err, true);
  var msg = err.querySelector('.message'); if (msg) msg.textContent = 'Still loading… This game may take longer on first load.';
  var details = err.querySelector('.details'); if (details) { details.style.display = 'none'; details.setAttribute('aria-hidden', 'true'); }
  var toggle = err.querySelector('.toggle');
  if (toggle) {
    toggle.style.display = 'none';
    toggle.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Show details';
    toggle.onclick = null;
  }
}

function renderError(msg, e){
  var _ov = ensureOverlays();
  var loader = _ov.loader, err = _ov.err;
  setLoaderVisibility(loader, false);
  if (err) {
    err.setAttribute('role', 'alert');
    err.setAttribute('aria-live', 'assertive');
  }
  setErrorVisibility(err, true);
  var d = err.querySelector('.details');
  if (d) {
    d.textContent = (e && (e.message || e.toString())) || '';
    d.style.display = 'none';
    d.setAttribute('aria-hidden', 'true');
  }
  var m = err.querySelector('.message'); if (m) m.textContent = msg;
  var tog = err.querySelector('.toggle');
  if (tog) {
    if (d && d.textContent) {
      tog.style.display = '';
      tog.textContent = 'Show details';
      tog.setAttribute('aria-hidden', 'false');
      tog.setAttribute('aria-expanded', 'false');
      tog.onclick = function(){
        var hidden = d.style.display === 'none';
        d.style.display = hidden ? 'block' : 'none';
        d.setAttribute('aria-hidden', hidden ? 'false' : 'true');
        tog.textContent = hidden ? 'Hide details' : 'Show details';
        tog.setAttribute('aria-expanded', hidden ? 'true' : 'false');
      };
    } else {
      tog.style.display = 'none';
      tog.setAttribute('aria-hidden', 'true');
      tog.onclick = null;
    }
  }
}

window.addEventListener('message', function(ev){
  var data = ev.data || {};
  if(data.type === 'GAME_READY'){
    clearBootTimers();
    var _ov = ensureOverlays();
    setLoaderVisibility(_ov.loader, false);
    setErrorVisibility(_ov.err, false);
    if (_ov.err) {
      _ov.err.setAttribute('role', 'status');
      _ov.err.setAttribute('aria-live', 'polite');
    }
    ensureCanvasLabels(document);
    if (diagV2State.loadStartedAt != null) {
      var now = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now();
      diagV2State.mountDuration = now - diagV2State.loadStartedAt;
      if (diagV2State.overlayApi && typeof diagV2State.overlayApi.setMeta === 'function') {
        try {
          diagV2State.overlayApi.setMeta({ mountTimeMs: diagV2State.mountDuration });
        } catch(_){ }
      }
    }
  } else if(data.type === 'GAME_ERROR'){
    clearBootTimers();
    renderError('Game error', {message: data.message || 'Unknown error'});
  }
});

function appendDiag(text) {
  if (diagState.sink) {
    diagState.sink.textContent += text;
  }
}

function ensureDiagListeners() {
  if (!diagState.listenerBound) {
    window.addEventListener('message', function(e){
      if (!diagState.sink) return;
      var d = e && e.data;
      if (d && d.type === 'DIAG_LOG' && d.entry) {
        var ent = d.entry;
        appendDiag('[+'+ent.t+'ms] '+String(ent.level || 'LOG').toUpperCase()+': '+ent.msg+'\n');
      } else if (d && d.type === 'GAME_READY') {
        appendDiag('[event] GAME_READY\n');
      } else if (d && d.type === 'GAME_ERROR') {
        appendDiag('[event] GAME_ERROR: ' + (d.message || '') + '\n');
      }
    });
    diagState.listenerBound = true;
  }
  if (!diagState.errorListenerBound) {
    window.addEventListener('error', function(e){
      appendDiag('[shell] window.error: ' + e.message + '\n');
    });
    window.addEventListener('unhandledrejection', function(e){
      var r = e && e.reason && (e.reason.message || e.reason.toString());
      appendDiag('[shell] unhandledrejection: ' + (r || 'unknown') + '\n');
    });
    diagState.errorListenerBound = true;
  }
}

function ensureDiagnosticsBus(){
  ensureDiagnosticsSupportScripts();
  if (diagV2State.bus && typeof diagV2State.bus.emit === 'function') {
    return Promise.resolve(diagV2State.bus);
  }
  if (typeof window !== 'undefined' && window.DiagnosticsBus && typeof window.DiagnosticsBus.emit === 'function') {
    diagV2State.bus = window.DiagnosticsBus;
    return Promise.resolve(diagV2State.bus);
  }
  if (diagV2State.loadPromise) {
    return diagV2State.loadPromise;
  }
  diagV2State.loadPromise = new Promise(function(resolve){
    try {
      var script = document.createElement('script');
      script.src = '/js/diagnostics/bus.js';
      script.async = false;
      script.onload = function(){
        diagV2State.bus = (window && window.DiagnosticsBus) || null;
        ensureDiagnosticsSupportScripts();
        resolve(diagV2State.bus);
      };
      script.onerror = function(){ resolve(null); };
      (document.head || document.body || document.documentElement).appendChild(script);
    } catch(_) {
      resolve(null);
    }
  });
  return diagV2State.loadPromise;
}

function ensureDiagnosticsAssetsModule(){
  if (diagV2State.assetsModulePromise) {
    return diagV2State.assetsModulePromise;
  }
  if (typeof window !== 'undefined' && window.DiagnosticsAssets && typeof window.DiagnosticsAssets.preflight === 'function') {
    diagV2State.assetsModulePromise = Promise.resolve(window.DiagnosticsAssets);
    return diagV2State.assetsModulePromise;
  }
  diagV2State.assetsModulePromise = new Promise(function(resolve){
    try {
      var script = document.createElement('script');
      script.src = '/js/diagnostics/assets.js';
      script.async = false;
      script.onload = function(){
        resolve((typeof window !== 'undefined' && window.DiagnosticsAssets) || null);
      };
      script.onerror = function(){ resolve(null); };
      (document.head || document.body || document.documentElement).appendChild(script);
    } catch(_){
      resolve(null);
    }
  });
  return diagV2State.assetsModulePromise;
}

function scheduleAssetScanIndicatorRefresh(){
  if (!diagV2State.assetScanState) return;
  if (diagV2State.assetScanRefreshTimer) {
    try { clearTimeout(diagV2State.assetScanRefreshTimer); } catch(_){ }
    diagV2State.assetScanRefreshTimer = null;
  }
  diagV2State.assetScanRefreshTimer = setTimeout(function(){
    diagV2State.assetScanRefreshTimer = null;
    applyAssetScanState();
  }, 32);
}

function applyAssetScanState(){
  var override = diagV2State.assetScanState;
  if (!override) return;
  var api = diagV2State.overlayApi;
  var root = api && api.root;
  if (!root || !root.querySelector) return;
  try {
    var summary = root.querySelector('#diagnostics-assets-summary');
    if (!summary) return;
    var textNode = summary.querySelector('.diagnostics-assets-text');
    if (textNode) {
      textNode.textContent = override.text || '';
    }
    var indicator = summary.querySelector('.diagnostics-assets-indicator');
    var color = override.color || '#9aa3c7';
    if (indicator) {
      indicator.style.backgroundColor = color;
      indicator.style.boxShadow = '0 0 12px ' + color;
    }
  } catch(_){ }
}

function setAssetScanState(next){
  if (!next) {
    if (diagV2State.assetScanRefreshTimer) {
      try { clearTimeout(diagV2State.assetScanRefreshTimer); } catch(_){ }
      diagV2State.assetScanRefreshTimer = null;
    }
    diagV2State.assetScanState = null;
    return;
  }
  var colorMap = {
    pending: '#9aa3c7',
    none: '#9aa3c7',
    warn: '#f6c945',
    warning: '#f6c945',
    error: '#ff5f56',
    ok: '#37d67a'
  };
  var normalized = {
    status: next.status || 'pending',
    text: next.text || '',
    color: next.color || colorMap[next.status] || colorMap.pending
  };
  diagV2State.assetScanState = normalized;
  scheduleAssetScanIndicatorRefresh();
}

function ensureDiagnosticsSupportScripts() {
  if (diagV2State.supportScriptsPromise) {
    return diagV2State.supportScriptsPromise;
  }
  if (typeof document === 'undefined') {
    diagV2State.supportScriptsPromise = Promise.resolve(false);
    return diagV2State.supportScriptsPromise;
  }
  var urls = ['/js/diagnostics/network.js', '/js/diagnostics/perf.js'];
  diagV2State.supportScriptsPromise = new Promise(function(resolve){
    var index = 0;
    function next() {
      if (index >= urls.length) {
        resolve(true);
        return;
      }
      var src = urls[index++];
      try {
        var script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.onload = function(){ next(); };
        script.onerror = function(){ next(); };
        (document.head || document.body || document.documentElement).appendChild(script);
      } catch(_){
        next();
      }
    }
    next();
  });
  return diagV2State.supportScriptsPromise;
}

function flushDiagV2Pending(){
  if (!diagV2State.bus || typeof diagV2State.bus.emit !== 'function') return;
  if (!diagV2State.pending.length) return;
  for (var i = 0; i < diagV2State.pending.length; i++) {
    try { diagV2State.bus.emit(diagV2State.pending[i]); } catch(_){ }
  }
  diagV2State.pending.length = 0;
}

function collectDeclaredAssets(input, bucket){
  if (!bucket) bucket = [];
  if (input == null) return bucket;
  if (typeof input === 'string') {
    var trimmed = input.trim();
    if (trimmed) bucket.push(trimmed);
    return bucket;
  }
  if (Array.isArray(input)) {
    for (var i = 0; i < input.length; i++) {
      collectDeclaredAssets(input[i], bucket);
    }
    return bucket;
  }
  if (typeof input === 'object') {
    for (var key in input) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        collectDeclaredAssets(input[key], bucket);
      }
    }
  }
  return bucket;
}

function gatherDeclaredAssets(info){
  var collected = [];
  var baseSources = [];
  if (info && typeof info === 'object') {
    baseSources.push(info.assets);
    baseSources.push(info.firstFrame);
    baseSources.push(info.preload);
    baseSources.push(info.preloads);
    baseSources.push(info.resources);
    baseSources.push(info.assetManifest);
    baseSources.push(info.assetManifestUrl);
    baseSources.push(info.assetList);
    baseSources.push(info.assetBundle);
    baseSources.push(info.media && info.media.assets);
    baseSources.push(info.media && info.media.preload);
    baseSources.push(info.manifest && info.manifest.assets);
    baseSources.push(info.manifest && info.manifest.preload);
    baseSources.push(info.bundle && info.bundle.assets);
    baseSources.push(info.diagnostics && info.diagnostics.assets);
    baseSources.push(info.diagnostics && info.diagnostics.preload);
    if (info.launch && typeof info.launch === 'object') {
      baseSources.push(info.launch.assets);
      baseSources.push(info.launch.preload);
      baseSources.push(info.launch.resources);
    }
    if (info.data && typeof info.data === 'object') {
      baseSources.push(info.data.assets);
      baseSources.push(info.data.preload);
    }
  }
  for (var idx = 0; idx < baseSources.length; idx++) {
    collectDeclaredAssets(baseSources[idx], collected);
  }
  try {
    if (typeof window !== 'undefined' && window.game && typeof window.game.getMeta === 'function') {
      var meta = window.game.getMeta();
      if (meta && meta.assets) {
        collectDeclaredAssets(meta.assets, collected);
      }
      if (meta && meta.preload) {
        collectDeclaredAssets(meta.preload, collected);
      }
    }
  } catch(_){ }
  var seen = Object.create(null);
  var deduped = [];
  for (var i = 0; i < collected.length; i++) {
    var item = collected[i];
    if (!item) continue;
    var key = String(item);
    if (key && !seen[key]) {
      seen[key] = true;
      deduped.push(key);
    }
  }
  return deduped;
}

function triggerAssetPreflight(info){
  var assets = gatherDeclaredAssets(info);
  diagV2State.assetScanToken += 1;
  var token = diagV2State.assetScanToken;
  if (!assets.length) {
    setAssetScanState({ status: 'none', text: 'No assets declared' });
    diagV2State.assetPreflightPromise = null;
    return;
  }

  var countText = assets.length === 1 ? 'Scanning 1 asset…' : ('Scanning ' + assets.length + ' assets…');
  setAssetScanState({ status: 'pending', text: countText });

  ensureDiagnosticsBus();

  var preflight = ensureDiagnosticsAssetsModule().then(function(module){
    if (!module || typeof module.preflight !== 'function') {
      if (diagV2State.assetScanToken === token) {
        setAssetScanState({ status: 'warn', text: 'Asset scan unavailable' });
      }
      return null;
    }
    return module.preflight(assets, 5000).then(function(result){
      if (diagV2State.assetScanToken !== token) return result;
      var hasEvents = result && Array.isArray(result.events) && result.events.length;
      if (hasEvents) {
        var skipBus = !!(result && result.emitted);
        for (var i = 0; i < result.events.length; i++) {
          var evt = result.events[i];
          if (!evt || typeof evt !== 'object') continue;
          if (skipBus) emitDiagV2Event(evt, { skipBus: true });
          else emitDiagV2Event(evt);
        }
        setAssetScanState(null);
      } else if (result && result.error) {
        setAssetScanState({ status: 'error', text: 'Asset scan failed' });
        emitDiagV2Event({
          topic: 'asset',
          level: 'error',
          message: 'Asset preflight failed',
          details: {
            url: '[preflight]',
            status: result.error && result.error.name ? result.error.name : 'error',
            duration: 0,
            error: result.error ? String(result.error) : null
          }
        });
      } else {
        setAssetScanState({ status: 'warn', text: 'No scan results' });
      }
      return result;
    }).catch(function(err){
      if (diagV2State.assetScanToken !== token) return null;
      setAssetScanState({ status: 'error', text: 'Asset scan failed' });
      emitDiagV2Event({
        topic: 'asset',
        level: 'error',
        message: err && err.message ? 'Asset preflight failed: ' + err.message : 'Asset preflight failed',
        details: {
          url: '[preflight]',
          status: err && err.name ? err.name : 'error',
          duration: 0,
          error: err ? String(err) : null
        }
      });
      return null;
    });
  }).catch(function(err){
    if (diagV2State.assetScanToken !== token) return null;
    setAssetScanState({ status: 'warn', text: 'Asset scan unavailable' });
    try { if (err) console.warn('Asset preflight unavailable', err); } catch(_){ }
    return null;
  });

  diagV2State.assetPreflightPromise = preflight;
  if (preflight && typeof preflight.then === 'function') {
    preflight.then(function(){
      if (diagV2State.assetScanToken === token) {
        diagV2State.assetPreflightPromise = null;
      }
    }, function(){
      if (diagV2State.assetScanToken === token) {
        diagV2State.assetPreflightPromise = null;
      }
    });
  }
}

function emitDiagV2Event(evt, options){
  if (!evt || typeof evt !== 'object') return;
  var payload = {};
  for (var key in evt) {
    if (Object.prototype.hasOwnProperty.call(evt, key)) {
      payload[key] = evt[key];
    }
  }
  if (payload.ts == null) {
    payload.ts = Date.now();
  }
  var skipBus = options && options.skipBus === true;
  if (!skipBus) {
    if (diagV2State.bus && typeof diagV2State.bus.emit === 'function') {
      try { diagV2State.bus.emit(payload); } catch(_){ }
    } else {
      diagV2State.pending.push(payload);
      if (diagV2State.pending.length > 2000) {
        diagV2State.pending.shift();
      }
    }
  }
  if (diagV2State.overlayApi && typeof diagV2State.overlayApi.ingest === 'function') {
    try { diagV2State.overlayApi.ingest(payload); } catch(_){ }
  } else {
    diagV2State.overlayQueue.push(payload);
    if (diagV2State.overlayQueue.length > 2000) {
      diagV2State.overlayQueue.shift();
    }
  }
  if (diagV2State.assetScanState) {
    scheduleAssetScanIndicatorRefresh();
  }
}

function bindDiagV2ErrorHandlers(){
  if (diagV2State.errorBound) return;
  diagV2State.errorBound = true;
  window.addEventListener('error', function(event){
    var message = event && event.message ? event.message : 'Unknown error';
    var error = event && event.error;
    emitDiagV2Event({
      topic: 'error',
      source: 'window.error',
      message: message,
      stack: error && error.stack ? String(error.stack) : null,
      data: {
        filename: event && event.filename,
        lineno: event && event.lineno,
        colno: event && event.colno
      }
    });
  });
  window.addEventListener('unhandledrejection', function(event){
    var reason = event && event.reason;
    var message = 'Unhandled promise rejection';
    var stack = null;
    if (reason && typeof reason === 'object') {
      if (reason.message) message = reason.message;
      if (reason.stack) stack = String(reason.stack);
    } else if (typeof reason === 'string') {
      message = reason;
    }
    emitDiagV2Event({
      topic: 'error',
      source: 'unhandledrejection',
      message: message,
      stack: stack
    });
  });
}

function normalizeDiagArg(value){
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: value.message || '',
      stack: value.stack ? String(value.stack) : null
    };
  }
  if (value === null || value === undefined) return value;
  var type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch(_){
      try { return String(value); } catch(__){ return '[unserializable]'; }
    }
  }
  try { return String(value); } catch(_){ return '[unserializable]'; }
}

function wrapConsoleForDiagnostics(){
  if (diagV2State.consoleWrapped) return;
  diagV2State.consoleWrapped = true;
  var methods = ['log', 'info', 'warn', 'error', 'debug'];
  methods.forEach(function(method){
    var original = console && console[method];
    if (typeof original !== 'function') return;
    console[method] = function(){
      var args = Array.prototype.slice.call(arguments);
      try {
        var topic = (method === 'error' || method === 'warn') ? 'error' : 'launch';
        emitDiagV2Event({
          topic: topic,
          source: 'console.' + method,
          args: args.map(normalizeDiagArg)
        });
      } catch(_){ }
      return original.apply(console, arguments);
    };
  });
}

function ensureDiagnosticsStyles(){
  if (diagV2State.stylesLoaded) return;
  if (document.getElementById('diagnostics-overlay-styles')) {
    diagV2State.stylesLoaded = true;
    return;
  }
  try {
    var link = document.createElement('link');
    link.id = 'diagnostics-overlay-styles';
    link.rel = 'stylesheet';
    link.href = '/css/diagnostics.css';
    link.onload = function(){ diagV2State.stylesLoaded = true; };
    link.onerror = function(){ };
    (document.head || document.documentElement || document.body).appendChild(link);
    diagV2State.stylesLoaded = true;
  } catch(_){ }
}

function loadDiagnosticsOverlayScript(){
  if (diagV2State.overlayScriptPromise) {
    return diagV2State.overlayScriptPromise;
  }
  if (typeof window !== 'undefined' && window.DiagnosticsOverlay && typeof window.DiagnosticsOverlay.create === 'function') {
    diagV2State.overlayScriptPromise = Promise.resolve(true);
    return diagV2State.overlayScriptPromise;
  }
  diagV2State.overlayScriptPromise = new Promise(function(resolve){
    try {
      var script = document.createElement('script');
      script.src = '/js/diagnostics/overlay.js';
      script.async = false;
      script.onload = function(){ resolve(true); };
      script.onerror = function(){ resolve(false); };
      (document.head || document.body || document.documentElement).appendChild(script);
    } catch(_){
      resolve(false);
    }
  });
  return diagV2State.overlayScriptPromise;
}

function ensureDiagV2Overlay(){
  if (diagV2State.overlayApi && diagV2State.overlayApi.root && diagV2State.overlayApi.root.isConnected) {
    return Promise.resolve(diagV2State.overlayApi);
  }
  if (diagV2State.overlayPromise) {
    return diagV2State.overlayPromise;
  }

  ensureDiagnosticsStyles();

  var createOverlay = function(){
    if (!window.DiagnosticsOverlay || typeof window.DiagnosticsOverlay.create !== 'function') return null;
    var api = null;
    try {
      api = window.DiagnosticsOverlay.create({
        slug: diagV2State.currentSlug || slug || '—',
        mountTime: diagV2State.mountDuration,
        bus: diagV2State.bus,
        initialEvents: diagV2State.overlayQueue.slice()
      });
    } catch(_){
      api = null;
    }
    if (api) {
      diagV2State.overlayApi = api;
      diagV2State.overlay = api.root || null;
      diagV2State.overlayQueue.length = 0;
      try {
        api.setMeta({ slug: diagV2State.currentSlug || slug || '—', mountTimeMs: diagV2State.mountDuration });
      } catch(_){ }
      if (diagV2State.bus && typeof api.setBus === 'function') {
        try { api.setBus(diagV2State.bus); } catch(_){ }
      }
      if (diagV2State.assetScanState) {
        scheduleAssetScanIndicatorRefresh();
      }
    }
    return api;
  };

  if (typeof window !== 'undefined' && window.DiagnosticsOverlay && typeof window.DiagnosticsOverlay.create === 'function') {
    var existing = createOverlay();
    var resolved = Promise.resolve(existing).then(function(result){
      if (!result) {
        diagV2State.overlayPromise = null;
      }
      return result;
    });
    diagV2State.overlayPromise = resolved;
    return resolved;
  }

  var loading = loadDiagnosticsOverlayScript().then(function(loaded){
    if (!loaded) {
      diagV2State.overlayPromise = null;
      return null;
    }
    var created = createOverlay();
    if (!created) {
      diagV2State.overlayPromise = null;
    }
    return created;
  });
  diagV2State.overlayPromise = loading;
  return loading;
}

function toggleDiagV2Overlay(forceShow){
  ensureDiagV2Overlay().then(function(api){
    if (!api || typeof api.open !== 'function' || typeof api.close !== 'function') return;
    var shouldShow;
    var currentlyOpen = false;
    if (typeof api.isOpen === 'function') {
      try { currentlyOpen = !!api.isOpen(); } catch(_){ currentlyOpen = false; }
    }
    if (typeof forceShow === 'boolean') {
      shouldShow = forceShow;
    } else {
      shouldShow = !currentlyOpen;
    }
    if (shouldShow) api.open();
    else api.close();
  }).catch(function(){ });
}

function openDiagV2Overlay(){
  var diag = null;
  try {
    if (typeof window !== 'undefined') {
      diag = window.__GG_DIAG;
    }
  } catch(_){ diag = null; }
  var opened = false;
  if (diag && typeof diag.open === 'function') {
    try {
      diag.open();
      opened = true;
    } catch(_){ opened = false; }
  }
  if (opened) return;
  ensureDiagV2Overlay().then(function(api){
    if (!api || typeof api.open !== 'function') return;
    try { api.open(); } catch(_){ }
  }).catch(function(){ });
}

function ensureDiagV2Button(){
  var init = function(){
    var buttons = document.querySelectorAll('#diagnostics-btn');
    var button = buttons.length ? buttons[0] : null;
    if (buttons.length > 1) {
      for (var i = 1; i < buttons.length; i++) {
        try { buttons[i].remove(); } catch(_){ }
      }
    }
    if (!button) {
      button = document.createElement('button');
      button.id = 'diagnostics-btn';
      button.type = 'button';
      button.textContent = 'Diagnostics';
      button.className = 'btn';
      button.style.position = 'fixed';
      button.style.right = '12px';
      button.style.bottom = '12px';
      button.style.zIndex = '1150';
      document.body.appendChild(button);
    }
    button.title = 'Open diagnostics (Alt+D)';
    button.setAttribute('aria-label', 'Open diagnostics (Alt+D)');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    if (!button._diagV2Bound) {
      button._diagV2Bound = true;
      button.addEventListener('click', function(event){
        if (event && typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        var diag = null;
        try {
          if (typeof window !== 'undefined') diag = window.__GG_DIAG;
        } catch(_){ diag = null; }
        if (diag && typeof diag.toggle === 'function') {
          try { diag.toggle(); return; } catch(_){ }
        }
        openDiagV2Overlay();
      });
    }
    diagV2State.buttonReady = true;
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}

function bindDiagV2Shortcut(){
  if (diagV2State.shortcutBound) return;
  diagV2State.shortcutBound = true;
  window.addEventListener('keydown', function(event){
    var key = event.key || '';
    var lower = key.toLowerCase ? key.toLowerCase() : key;
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (lower === 'd') {
      event.preventDefault();
      openDiagV2Overlay();
    }
  });
}

function setupDiagnosticsV2(){
  if (diagV2State.initialized) return;
  diagV2State.initialized = true;
  ensureDiagnosticsStyles();
  ensureDiagV2Overlay().catch(function(){ });
  ensureDiagV2Button();
  bindDiagV2Shortcut();
  bindDiagV2ErrorHandlers();
  wrapConsoleForDiagnostics();
  ensureDiagnosticsBus().then(function(){
    if (typeof window !== 'undefined' && window.DiagnosticsBus) {
      diagV2State.bus = window.DiagnosticsBus;
    }
    if (diagV2State.overlayApi && typeof diagV2State.overlayApi.setBus === 'function') {
      try { diagV2State.overlayApi.setBus(diagV2State.bus); } catch(_){ }
    } else if (diagV2State.overlayPromise) {
      diagV2State.overlayPromise.then(function(api){
        if (api && typeof api.setBus === 'function') {
          try { api.setBus(diagV2State.bus); } catch(_){ }
        }
      }).catch(function(){ });
    }
    flushDiagV2Pending();
  });
}

function createDiagUI(info, type, resolvedEntry, loadedEntry) {
  if (DIAG_V2) {
    cleanupLegacyDiagnosticsUI();
    return;
  }

  if (!DIAG_V2) {
    var btn = document.getElementById('diag-btn');
    var panel = document.getElementById('diag-panel');
    if (!btn || !panel) {
      if (btn) try { btn.remove(); } catch(_){}
      if (panel) try { panel.remove(); } catch(_){}

      btn = document.createElement('button');
      btn.id = 'diag-btn';
      btn.textContent = '🧪 Diagnostics';
      btn.style.position='fixed'; btn.style.right='12px'; btn.style.bottom='12px';
      btn.style.zIndex='1000'; btn.className='btn';
      document.body.appendChild(btn);

      panel = document.createElement('div');
      panel.id = 'diag-panel';
      panel.style.position='fixed'; panel.style.right='12px'; panel.style.bottom='56px';
      panel.style.background='#0b0f2a'; panel.style.color='#e8eefc';
      panel.style.border='1px solid #25305a'; panel.style.borderRadius='10px';
      panel.style.padding='10px'; panel.style.width='360px'; panel.style.maxHeight='60vh'; panel.style.overflow='auto';
      panel.style.display='none'; panel.style.boxShadow='0 10px 30px rgba(0,0,0,.4)';

      var metaWrap = document.createElement('div');
      metaWrap.id = 'diag-meta';
      metaWrap.style.fontFamily = 'ui-sans-serif,system-ui';
      metaWrap.style.fontSize = '13px';
      metaWrap.style.lineHeight = '1.4';
      panel.appendChild(metaWrap);

      var hr = document.createElement('hr');
      hr.className = 'diag-separator';
      hr.style.borderColor = '#25305a';
      panel.appendChild(hr);

      var logsHeader = document.createElement('div');
      logsHeader.id = 'diag-logs-header';
      logsHeader.style.display = 'flex';
      logsHeader.style.alignItems = 'center';
      logsHeader.style.justifyContent = 'space-between';
      logsHeader.style.gap = '10px';
      logsHeader.style.marginBottom = '6px';

      var logsLabel = document.createElement('div');
      logsLabel.textContent = 'Logs';
      logsLabel.style.fontWeight = '600';
      logsHeader.appendChild(logsLabel);

      var copyBtn = document.createElement('button');
      copyBtn.id = 'diag-copy-btn';
      copyBtn.textContent = 'Copy logs';
      copyBtn.className = 'btn';
      copyBtn.style.padding = '4px 8px';
      copyBtn.style.fontSize = '12px';
      copyBtn.style.flexShrink = '0';
      logsHeader.appendChild(copyBtn);

      panel.appendChild(logsHeader);

      var sink = document.createElement('div');
      sink.id = 'diag-logs';
      sink.style.fontFamily = 'ui-monospace,monospace';
      sink.style.fontSize = '12px';
      sink.style.whiteSpace = 'pre-wrap';
      sink.style.border = '1px solid #25305a';
      sink.style.borderRadius = '8px';
      sink.style.padding = '8px';
      sink.style.background = '#070b20';
      panel.appendChild(sink);

      document.body.appendChild(panel);

      btn.onclick = function(){ panel.style.display = (panel.style.display==='none'?'block':'none'); };
    }

    var meta = panel.querySelector('#diag-meta');
    if (!meta) {
      meta = document.createElement('div');
      meta.id = 'diag-meta';
      panel.insertBefore(meta, panel.firstChild);
    }

    var logsHeaderEl = panel.querySelector('#diag-logs-header');
    if (!logsHeaderEl) {
      logsHeaderEl = document.createElement('div');
      logsHeaderEl.id = 'diag-logs-header';
      logsHeaderEl.style.display = 'flex';
      logsHeaderEl.style.alignItems = 'center';
      logsHeaderEl.style.justifyContent = 'space-between';
      logsHeaderEl.style.gap = '10px';
      logsHeaderEl.style.marginBottom = '6px';

      var logsLabelEl = document.createElement('div');
      logsLabelEl.textContent = 'Logs';
      logsLabelEl.style.fontWeight = '600';
      logsHeaderEl.appendChild(logsLabelEl);

      var copyBtnEl = document.createElement('button');
      copyBtnEl.id = 'diag-copy-btn';
      copyBtnEl.textContent = 'Copy logs';
      copyBtnEl.className = 'btn';
      copyBtnEl.style.padding = '4px 8px';
      copyBtnEl.style.fontSize = '12px';
      copyBtnEl.style.flexShrink = '0';
      logsHeaderEl.appendChild(copyBtnEl);

      panel.appendChild(logsHeaderEl);
    }

    var sinkEl = panel.querySelector('#diag-logs');
    if (!sinkEl) {
      sinkEl = document.createElement('div');
      sinkEl.id = 'diag-logs';
      sinkEl.style.fontFamily = 'ui-monospace,monospace';
      sinkEl.style.fontSize = '12px';
      sinkEl.style.whiteSpace = 'pre-wrap';
      sinkEl.style.border = '1px solid #25305a';
      sinkEl.style.borderRadius = '8px';
      sinkEl.style.padding = '8px';
      sinkEl.style.background = '#070b20';
      panel.appendChild(sinkEl);
    }

    var copyBtnFinal = panel.querySelector('#diag-copy-btn');
    if (copyBtnFinal && !copyBtnFinal._copyBound) {
      copyBtnFinal._copyBound = true;
      copyBtnFinal.dataset.label = copyBtnFinal.textContent;
      copyBtnFinal.addEventListener('click', function(){
        handleDiagCopy(copyBtnFinal, sinkEl);
      });
    }

    var forced = FORCE ? ' (forced)' : '';
    var resolved = resolvedEntry || 'n/a';
    var loaded = loadedEntry || resolvedEntry || 'n/a';
    meta.innerHTML = ''+
      '<div style="font-weight:700;margin-bottom:6px">Game Diagnostics</div>'+
      '<div><b>Slug</b>: ' + (info.slug || 'n/a') + '</div>'+
      '<div><b>Title</b>: ' + (info.title || 'n/a') + '</div>'+
      '<div><b>Resolved Entry</b>: ' + resolved + '</div>'+
      '<div><b>Loaded URL</b>: ' + loaded + '</div>'+
      '<div><b>Type</b>: ' + type + forced + '</div>'+
      '<div><b>Module</b>: ' + String((info.launch && info.launch.module) || info.module || false) + '</div>';

    sinkEl.textContent = '';
    diagState.sink = sinkEl;

    ensureDiagListeners();
    appendDiag('[shell] resolved entry: ' + resolved + '\n');
    appendDiag('[shell] diagnostics ready\n');
  }
}

function handleDiagCopy(button, sink) {
  if (!button || !sink) return;
  var text = sink.textContent || '';
  var original = button.dataset.label || button.textContent;
  var resetTimer = button._resetTimer;
  if (resetTimer) clearTimeout(resetTimer);

  function setFeedback(message, success) {
    button.textContent = message;
    button.style.background = success ? '#1f7a4d' : '#7a1f1f';
    button.style.borderColor = success ? '#2aa568' : '#b33d3d';
    button._resetTimer = setTimeout(function(){
      button.textContent = original;
      button.style.background = '';
      button.style.borderColor = '';
    }, 1600);
  }

  if (!text) {
    setFeedback('Nothing to copy', false);
    return;
  }

  var copyPromise;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    copyPromise = navigator.clipboard.writeText(text);
  } else {
    copyPromise = new Promise(function(resolve, reject){
      try {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        var successful = document.execCommand && document.execCommand('copy');
        document.body.removeChild(textarea);
        if (successful) { resolve(); } else { reject(new Error('copy command failed')); }
      } catch (err) {
        reject(err);
      }
    });
  }

copyPromise.then(function(){
    setFeedback('Copied!', true);
  }).catch(function(){
    setFeedback('Copy failed', false);
  });
}

if (DIAG_V2) {
  setupDiagnosticsV2();
}

boot();
