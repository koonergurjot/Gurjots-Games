
import { resolveGamePaths } from './game-paths.js';
import { resolveAssetPath, resolveRoutePath } from './base-path.js';

/**
 * Shared Game UI shell for Gurjot's Games
 * - Adds consistent header/footer
 * - Wraps iframe canvas area
 * - Handles pause/resume, restart, back, volume, high score, loading/error overlays
 * - Listens for postMessage {type:'GAME_READY'|'GAME_ERROR'|'GAME_SCORE', score?:number}
 */
(async function () {
  const qs = (s, r=document)=>r.querySelector(s);
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug') || params.get('game') || (location.pathname.split('/').pop().replace(/\.html$/,'')) || 'unknown';
  document.documentElement.classList.add('gg');
  document.body.classList.add('gg-game-page');

  // If an iframe is not present, create one targeting conventional path:
  let frame = qs('#game-frame');
  const candidates = [
    resolveAssetPath(`games/${slug}/index.html`),
    resolveAssetPath(`games/${slug}.html`),
    resolveAssetPath(`games/${slug}/game.html`)
  ];

  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'game-frame';
    frame.title = slug + ' game';
    frame.setAttribute('aria-label', slug + ' game');
  }

  let resolvedSrc = candidates[0];
  try {
    const { playPath } = await resolveGamePaths(slug);
    if (playPath) {
      resolvedSrc = playPath;
    }
  } catch (err) {
    console.warn('[GG] unable to resolve game iframe path', err);
  }
  frame.src = resolvedSrc;

  // Build UI
  const root = document.createElement('div');
  root.className = 'gg-container';
  root.innerHTML = `
    <header class="gg-header" role="banner">
      <div class="gg-title" aria-live="polite">
        <span class="gg-dot" aria-hidden="true"></span>
        <span id="gg-game-title">${slug.replace(/[-_]/g,' ')}</span>
      </div>
      <nav class="gg-actions" aria-label="Game actions">
        <button class="gg-btn" id="gg-back" aria-label="Back to home" accesskey="h">Home</button>
        <button class="gg-btn" id="gg-restart" aria-label="Restart game" accesskey="r">Restart</button>
        <button class="gg-btn" id="gg-pause" aria-pressed="false" aria-label="Pause/Resume game" accesskey="p">Pause</button>
        <button class="gg-btn" id="gg-mute" aria-pressed="false" aria-label="Mute/Unmute audio" accesskey="m">Mute</button>
      </nav>
    </header>
    <main class="gg-stage" role="main">
      <div class="gg-hud" aria-live="polite">
        <div class="gg-chip">High Score: <span id="gg-hiscore">0</span></div>
        <div class="gg-chip">Score: <span id="gg-score">0</span></div>
      </div>
      <div class="gg-loading" id="gg-loading" aria-live="polite">
        <div class="gg-spinner" role="status" aria-label="Loading"></div>
      </div>
      <div class="gg-error" id="gg-error" hidden>
        <div class="gg-error-card" role="alert">
          <h3 style="margin:0 0 8px 0">Oops, this game didn't load.</h3>
          <p style="margin:0 0 12px 0">Try again, or report the issue in the console logs.</p>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="gg-btn" id="gg-retry">Retry</button>
            <a class="gg-btn" href="${resolveRoutePath('/') || '/'}" id="gg-go-home">Home</a>
          </div>
        </div>
      </div>
      <div class="gg-paused" id="gg-paused" hidden>
        <div class="gg-error-card" aria-live="polite">
          <strong>Paused</strong>
          <p>Press <kbd>P</kbd> or click Resume to continue.</p>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="gg-btn" id="gg-resume">Resume</button>
          </div>
        </div>
      </div>
    </main>
    <section class="gg-panel">
      <details>
        <summary aria-label="Show controls and instructions">Controls & Instructions</summary>
        <div style="display:grid;gap:6px;margin-top:8px">
          <div>⬅️➡️ or A/D — Move</div>
          <div>⬆️⬇️ or W/S — Up/Down</div>
          <div>Space — Action / Jump / Fire</div>
          <div>P — Pause/Resume</div>
          <div>R — Restart</div>
        </div>
      </details>
    </section>
    <footer class="gg-footer" role="contentinfo">© ${new Date().getFullYear()} Gurjot’s Games • Press <kbd>?</kbd> for help</footer>
  `;

  // Insert UI and iframe
  const container = document.createElement('div');
  container.className = 'gg-frame-wrap';
  frame.classList.add('gg-frame');
  container.appendChild(frame);
  root.querySelector('.gg-stage').appendChild(container);
  document.body.prepend(root);

  const $pauseButton = root.querySelector('#gg-pause');
  const $loading = root.querySelector('#gg-loading');
  const $error = root.querySelector('#gg-error');
  const $paused = root.querySelector('#gg-paused');
  const $score = root.querySelector('#gg-score');
  const $hiscore = root.querySelector('#gg-hiscore');

  function clearAnyPause(){
    try {
      if (!document.getElementById('gg-pause-kill-style')){
        const style = document.createElement('style');
        style.id = 'gg-pause-kill-style';
        style.textContent = `
          .pause-overlay,
          #gg-pause-overlay,
          .gg-overlay.gg-pause,
          .modal-paused,
          #hud .paused,
          .hud-paused {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
          }
        `;
        document.head.appendChild(style);
      }
      document.querySelectorAll('.pause-overlay, #gg-pause-overlay, .gg-overlay.gg-pause, .modal-paused, #hud .paused, .hud-paused').forEach(el=>{
        el.style.display = 'none';
        el.classList.add('hidden');
        el.setAttribute('aria-hidden','true');
      });
      if ($paused){
        $paused.setAttribute('hidden','');
        $paused.setAttribute('aria-hidden','true');
        $paused.style.display = 'none';
      }
      if ($pauseButton && $pauseButton.getAttribute('aria-pressed') !== 'false'){
        $pauseButton.setAttribute('aria-pressed','false');
      }
      if (window.GG_HUD && typeof window.GG_HUD.hidePause==='function') window.GG_HUD.hidePause();
    } catch (err) {}
  }

  function sendGamePause(){
    frame?.contentWindow?.postMessage({type:'GAME_PAUSE'}, '*');
  }

  function sendGameResume(){
    clearAnyPause(); // Ensures shell overlay is cleared when resuming (including watchdog)
    frame?.contentWindow?.postMessage({type:'GAME_RESUME'}, '*');
  }

  sendGameResume();

  // Keyboard shortcuts
  document.addEventListener('keydown', (e)=>{
    if (e.key.toLowerCase()==='p'){e.preventDefault();togglePause();}
    if (e.key.toLowerCase()==='r'){e.preventDefault();restart();}
    if (e.key==='?' || (e.shiftKey && e.key.toLowerCase()==='/')){
      const det = root.querySelector('details'); det.open = !det.open;
    }
  });

  // Buttons
  root.querySelector('#gg-back').onclick = ()=>location.href = resolveRoutePath('/') || '/';
  root.querySelector('#gg-restart').onclick = ()=>restart();
  if ($pauseButton){ $pauseButton.onclick = ()=>togglePause(); }
  root.querySelector('#gg-mute').onclick = (ev)=>{
    const pressed = ev.currentTarget.getAttribute('aria-pressed')==='true';
    ev.currentTarget.setAttribute('aria-pressed', String(!pressed));
    frame.contentWindow?.postMessage({type:'GG_SET_MUTE', value: !pressed}, '*');
  };
  root.querySelector('#gg-resume').onclick = ()=>togglePause();
  root.querySelector('#gg-retry').onclick = ()=>{ location.reload(); };

  // Loading & error handling via postMessage
  const hiscoreKey = `gg:hiscore:${slug}`;
  try { $hiscore.textContent = String(parseInt(localStorage.getItem(hiscoreKey)||'0',10)); } catch {}

  function setReady(){ $loading?.setAttribute('hidden',''); }
  function setError(msg){
    console.error('[GG][ERROR]', msg);
    $loading?.setAttribute('hidden','');
    $error?.removeAttribute('hidden');
  }
  function setScore(v){
    const n = Math.max(0, Number(v)||0);
    $score.textContent = String(n);
    const best = Math.max(n, parseInt($hiscore.textContent||'0',10));
    $hiscore.textContent = String(best);
    try { localStorage.setItem(hiscoreKey, String(best)); } catch {}
  }
  function togglePause(){
    const isPausedVisible = !$paused.hasAttribute('hidden');
    if (isPausedVisible){
      // currently visible -> resume
      $paused.setAttribute('hidden','');
      $paused.setAttribute('aria-hidden','true');
      $paused.style.display = 'none';
      if ($pauseButton){ $pauseButton.setAttribute('aria-pressed','false'); }
      sendGameResume();
    } else {
      $paused.removeAttribute('hidden');
      $paused.removeAttribute('aria-hidden');
      $paused.style.display = '';
      if ($pauseButton){ $pauseButton.setAttribute('aria-pressed','true'); }
      sendGamePause();
    }
  }
  function restart(){
    try {
      // Prefer in-game restart
      frame.contentWindow?.postMessage({type:'GG_RESTART'}, '*');
      // Fallback: hard reload iframe
      const src = frame.src; frame.src = src;
    } catch(e){
      const src = frame.src; frame.src = src;
    }
  }

  // Listen for game events (from inside iframe)
  window.addEventListener('message', (ev)=>{
    const d = ev.data || {};
    if (d.type==='GAME_READY'){
      setReady();
      sendGameResume();
    }
    if (d.type==='GAME_ERROR'){ setError(d.message||'Unknown error'); }
    if (d.type==='GAME_SCORE'){ setScore(d.score); }
  });

  // Safety timeout: show error if no ready/error after 8s
  setTimeout(()=>{
    if (!$loading.hasAttribute('hidden')){
      console.warn('[GG][WARN] No GAME_READY/ERROR signal received within 8s; attempting graceful resume.');
      setReady();
      try {
        sendGameResume();
      } catch (err) {
        console.warn('[GG][WARN] Failed to send GAME_RESUME after timeout', err);
      }
    }
  }, 8000);
})();
