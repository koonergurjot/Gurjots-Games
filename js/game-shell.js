
// js/game-shell.js — universal shell that loads a game by slug using games.json
const qs = new URLSearchParams(location.search);
const DEBUG = qs.get('debug') === '1' || qs.get('debug') === 'true';
const FORCE = qs.get('force'); // 'iframe' | 'script'
const FORCE_MODULE = qs.has('module') ? (qs.get('module') === '1' || qs.get('module') === 'true') : null;

const slug = qs.get('slug') || qs.get('id') || qs.get('game');
const $ = s => document.querySelector(s);

function el(tag, cls){ const e = document.createElement(tag); if(cls) e.className = cls; return e; }

const state = {
  timer: null,
  muted: true,
  gameInfo: null,
  iframe: null,
};

async function boot(){
  if(!slug){
    render404("Missing ?slug= parameter");
    return;
  }
  let catalog;
  try{
    const res = await fetch('/games.json', {cache:'no-cache'});
    catalog = await res.json();
  }catch(e){
    renderError("Could not load games.json", e);
    return;
  }
  const info = (Array.isArray(catalog) ? catalog : catalog.games || []).find(g => (g.slug||g.id) === slug);
  if(!info){
    render404(`Unknown game: ${slug}`);
    return;
  }
  state.gameInfo = info;
  renderShell(info);
  loadGame(info);
}

function render404(msg){
  const root = $('#app');
  root.innerHTML = `
    <div class="container">
      <div class="card">
        <h2>Game not found</h2>
        <p>${msg}</p>
        <p><a class="btn" href="./">← Back to Home</a></p>
      </div>
    </div>`;
}

function renderShell(info){
  $('#title').textContent = info.title || info.name || slug;
  const tags = info.tags || info.genres || [];
  const t = $('.tags');
  t.innerHTML = '';
  tags.slice(0,6).forEach(tag=>{
    const chip = el('span','tag'); chip.textContent = tag; t.appendChild(chip);
  });

  // About panel
  $('#about-text').textContent = info.description || info.short || 'Ready to play?';
  $('#open-new').href = location.href;

  // Keyboard help (best-effort defaults)
  $('#controls-list').innerHTML = `
    <li><kbd>← →</kbd> Move</li>
    <li><kbd>Space</kbd> Action / Jump</li>
    <li><kbd>P</kbd> Pause</li>
    <li><kbd>F</kbd> Fullscreen</li>`;

  // Wire controls
  $('#btn-restart').onclick = ()=> reloadGame();
  $('#btn-fullscreen').onclick = ()=> {
    const stage = $('#stage');
    (stage.requestFullscreen||stage.webkitRequestFullscreen||stage.msRequestFullscreen||(()=>Promise.reject()))().catch(()=>{});
  };
  $('#btn-mute').onclick = ()=> toggleMute();
  $('#btn-how').onclick = ()=> document.getElementById('about').scrollIntoView({behavior:'smooth'});

  // pause overlay by page visibility
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden){
      window.postMessage({type:'GAME_PAUSE'}, '*');
    } else {
      // no auto-resume to avoid surprises
    }
  });
}

function loadGame(info){
  const stage = $('#stage');
  const loader = $('#loader');
  const err = $('#error');
  err.classList.remove('show');
  loader.style.display = 'flex';

  const aspect = $('#frame-holder');
  // Provide legacy anchors some games may expect
  ensureLegacyElements();

  // decide embedding strategy
  const entry = info.launch?.path || info.entry || info.url;
  const isModule = info.launch?.module || info.module || false;
  let type = info.launch?.type || (entry && entry.endsWith('.html') ? 'iframe' : 'script');
  if (FORCE === 'iframe') type = 'iframe'; else if (FORCE === 'script') type = 'script';

  if(type === 'iframe'){
    const debugEntry = DEBUG ? (entry + (entry.includes('?')?'&':'?') + 'debug=1') : entry;
    const iframe = document.createElement('iframe');
    iframe.id = 'frame';
    iframe.allow = 'autoplay; fullscreen';
    iframe.src = debugEntry;
    iframe.onload = ()=>{/* waiting for GAME_READY handshake */};
    stage.innerHTML = '';
    stage.appendChild(iframe);
    state.iframe = iframe;
    createDiagUI(info, type, debugEntry);
  } else {
    // script boot
    stage.innerHTML = '<div id="game-root"></div><canvas id="gameCanvas" width="800" height="600" aria-label="Game canvas"></canvas>';
    // load diagnostics first (optional)
    if (DEBUG) {
      const d = document.createElement('script');
      d.src = '/js/runtime-diagnostics.js';
      document.body.appendChild(d);
    }
    const s = document.createElement('script');
    const useModule = (FORCE_MODULE !== null) ? FORCE_MODULE : isModule;
    if(useModule){ s.type='module'; }
    s.src = entry;
    s.onerror = (e)=>renderError('Failed to load game script', e);
    document.body.appendChild(s);
    createDiagUI(info, type, entry);
  }

  // Handshake timer
  if(state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(()=>{
    loader.style.display = 'none';
    showSoftLoading();
  }, 6000);
}

function reloadGame(){
  if(state.iframe){
    const src = state.iframe.src;
    state.iframe.src = src;
  } else {
    location.reload();
  }
}

function toggleMute(){
  state.muted = !state.muted;
  $('#btn-mute').innerText = state.muted ? 'Unmute' : 'Mute';
  try{
    if(state.iframe && state.iframe.contentWindow){
      state.iframe.contentWindow.postMessage({type:'GAME_MUTE', muted: state.muted}, '*');
    }
  }catch(e){}
}

function showSoftLoading(){
  const err = $('#error');
  err.classList.add('show');
  err.querySelector('.message').textContent = 'Still loading… This game may take longer on first load.';
  err.querySelector('.details').style.display = 'none';
  err.querySelector('.toggle').style.display = 'none';
}

function renderError(msg, e){
  const loader = $('#loader'); loader.style.display='none';
  const err = $('#error'); err.classList.add('show');
  err.querySelector('.message').textContent = msg;
  const details = err.querySelector('.details');
  details.textContent = (e && (e.message || e.toString())) || '';
  details.style.display = 'none';
  err.querySelector('.toggle').onclick = ()=> {
    details.style.display = (details.style.display==='none' ? 'block' : 'none');
  };
}

function ensureLegacyElements(){
  // Some games expect these IDs to exist
  if(!document.getElementById('game')) {
    const d = document.createElement('div'); d.id = 'game'; d.style.position='relative'; document.body.appendChild(d);
  }
  if(!document.getElementById('game-root')){
    const d = document.createElement('div'); d.id = 'game-root'; document.body.appendChild(d);
  }
  if(!document.getElementById('gameCanvas')){
    const c = document.createElement('canvas'); c.id='gameCanvas'; c.width=800; c.height=600; c.setAttribute('aria-label','Game canvas'); document.body.appendChild(c);
  }
}

// Listen for handshake from games
window.addEventListener('message', (ev)=>{
  const data = ev.data || {};
  if(data.type === 'GAME_READY'){
    const loader = $('#loader'); loader.style.display='none';
    const err = $('#error'); err.classList.remove('show');
  } else if(data.type === 'GAME_ERROR'){
    renderError('Game error', {message: data.message || 'Unknown error'});
  }
});

boot();


// --- Diagnostics UI (only when debug) ---
function createDiagUI(info, type, entry) {
  if (!DEBUG) return;
  const btn = document.createElement('button');
  btn.textContent = '🧪 Diagnostics';
  btn.style.position='fixed'; btn.style.right='12px'; btn.style.bottom='12px';
  btn.style.zIndex='1000'; btn.className='btn';
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.style.position='fixed'; panel.style.right='12px'; panel.style.bottom='56px';
  panel.style.background='#0b0f2a'; panel.style.color='#e8eefc';
  panel.style.border='1px solid #25305a'; panel.style.borderRadius='10px';
  panel.style.padding='10px'; panel.style.width='360px'; panel.style.maxHeight='60vh'; panel.style.overflow='auto';
  panel.style.display='none'; panel.style.boxShadow='0 10px 30px rgba(0,0,0,.4)';
  const meta = `
    <div style="font-weight:700;margin-bottom:6px">Game Diagnostics</div>
    <div><b>Slug</b>: ${info.slug || 'n/a'}</div>
    <div><b>Title</b>: ${info.title || 'n/a'}</div>
    <div><b>Entry</b>: ${entry}</div>
    <div><b>Type</b>: ${type}${FORCE?` (forced)`:''}</div>
    <div><b>Module</b>: ${String(info.launch?.module || info.module || false)}</div>
    <hr style="border-color:#25305a">
    <div id="diag-logs" style="font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap"></div>
  `;
  panel.innerHTML = meta;
  document.body.appendChild(panel);

  btn.onclick = ()=> panel.style.display = (panel.style.display==='none'?'block':'none');

  // log sink
  const sink = panel.querySelector('#diag-logs');
  const add = (e)=> {
    try{
      const d = e.data;
      if(d?.type==='DIAG_LOG'){
        const ent = d.entry;
        sink.textContent += `[+${ent.t}ms] ${ent.level.toUpperCase()}: ${ent.msg}\n`;
      } else if (d?.type==='GAME_READY') {
        sink.textContent += '[event] GAME_READY\n';
      } else if (d?.type==='GAME_ERROR') {
        sink.textContent += '[event] GAME_ERROR: '+ (d.message||'') + '\n';
      }
    }catch(_){}
  };
  window.addEventListener('message', add);

  // capture own errors too
  window.addEventListener('error', (e)=>{
    sink.textContent += '[shell] window.error: '+e.message+'\n';
  });
  window.addEventListener('unhandledrejection', (e)=>{
    sink.textContent += '[shell] unhandledrejection: '+(e.reason && (e.reason.message || e.reason.toString()))+'\n';
  });
}
