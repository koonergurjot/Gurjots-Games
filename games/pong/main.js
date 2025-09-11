import { Controls, createGamepad } from '../../src/runtime/controls.ts';
import { attachPauseOverlay, injectHelpButton, saveBestScore, shareScore } from '../../shared/ui.js';
import games from '../../games.json' assert { type: 'json' };
import { startSessionTimer, endSessionTimer } from '../../shared/metrics.js';
import { emitEvent } from '../../shared/achievements.js';
import { GameEngine } from '../../shared/gameEngine.js';
import '../../shared/fx/canvasFx.js';
import '../../shared/skins/index.js';
import * as ErrorReporter from '../../shared/debug/error-reporter.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Build HUD UI
const hudRoot = document.createElement('div');
hudRoot.className = 'hud';
document.body.appendChild(hudRoot);

const hudStyle = document.createElement('style');
hudStyle.textContent = `
  .hud-ui{position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;gap:12px;padding:6px 12px;background:rgba(0,0,0,0.35);border-radius:12px;align-items:center;pointer-events:auto;}
  .hud-ui select,.hud-ui button{background:rgba(255,255,255,0.08);color:var(--fg);border:1px solid rgba(255,255,255,0.2);border-radius:8px;padding:4px 8px;}
  .hud-ui span{font-weight:700;}
`;
document.head.appendChild(hudStyle);

hudRoot.innerHTML = `
  <div class="hud-ui">
    <span id="status"></span>
    <span><span id="lScore">0</span> - <span id="rScore">0</span></span>
    <span>Series <span id="lWins">0</span>-<span id="rWins">0</span></span>
    <button id="pauseBtn">⏸️</button>
    <button id="restartBtn">⟲</button>
    <button id="shareBtn" hidden>🔗</button>
    <label>Mode:
      <select id="modeSel"><option value="ai" selected>AI</option><option value="p2">2P</option></select>
    </label>
    <label>Difficulty:
      <select id="diffSel">
        <option value="easy">Easy</option>
        <option value="med" selected>Medium</option>
        <option value="hard">Hard</option>
        <option value="insane">Insane</option>
      </select>
    </label>
    <label>Sound:
      <select id="sndSel"><option value="on" selected>On</option><option value="off">Off</option></select>
    </label>
    <label>Series:
      <select id="seriesSel">
        <option value="1">1</option>
        <option value="3">3</option>
        <option value="5">5</option>
      </select>
    </label>
  </div>
`;
const DPR = Math.min(2, window.devicePixelRatio || 1);
function resize() {
  const { clientWidth:w, clientHeight:h } = canvas;
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0); // draw in CSS pixels
}
new ResizeObserver(resize).observe(canvas); resize();

// Game constants
const FIELD = { w: 800, h: 450 };
const PADDLE = { w: 10, h: 80, speed: 6 };
const BALL = { r: 7, speed: 6, max: 13 };
const WIN_SCORE = 11;

// State
let left = { y: (FIELD.h-PADDLE.h)/2, score:0, vy:0 };
let right = { y: (FIELD.h-PADDLE.h)/2, score:0, vy:0 };
let ball = resetBall(1);
let running = true;
let mode = 'ai';   // 'ai' | 'p2'
let diff = 'med';  // easy | med | hard | insane
let sounds = 'on';
let serveLock = true; // require key to serve
// Elo-like rating
const ELO_KEY = 'pong:elo';
let playerElo = parseInt(localStorage.getItem(ELO_KEY) || '1200', 10);
let aiElo = 1200;

// Best-of series scoreboard
const SERIES_KEY = 'pong:series';
let series = { left:0, right:0, bestOf:1 };
try { Object.assign(series, JSON.parse(localStorage.getItem(SERIES_KEY)) || {}); } catch {}
let seriesTarget = Math.ceil(series.bestOf/2);
let statusEl = document.getElementById('status');
let lScoreEl = document.getElementById('lScore');
let rScoreEl = document.getElementById('rScore');
let lWinsEl = document.getElementById('lWins');
let rWinsEl = document.getElementById('rWins');
const shareBtn = document.getElementById('shareBtn');

function updateWins(){
  lWinsEl.textContent = series.left;
  rWinsEl.textContent = series.right;
}
function saveSeries(){
  localStorage.setItem(SERIES_KEY, JSON.stringify(series));
}
updateWins();

// Inputs
const controls = new Controls({
  map: {
    up: 'KeyW',
    down: 'KeyS',
    p2_up: 'ArrowUp',
    p2_down: 'ArrowDown',
    a: ['Space', 'Enter'],
    pause: 'KeyP',
    restart: 'KeyR'
  }
});
controls.on('pause', () => pause());
controls.on('restart', () => restart());
controls.on('a', () => { serveLock = false; status(''); });

const pad = createGamepad((gp)=> {
  // Right paddle uses primary gamepad left stick Y
  const y = gp.axes?.[1] ?? 0;
  if (Math.abs(y) > 0.2) right.y += y * PADDLE.speed * 1.2;
});


// UI controls
document.getElementById('pauseBtn').onclick = ()=> pause();
document.getElementById('restartBtn').onclick = ()=> restart();
const modeSel = document.getElementById('modeSel');
const diffSel = document.getElementById('diffSel');
const sndSel = document.getElementById('sndSel');
const seriesSel = document.getElementById('seriesSel');
modeSel.onchange = ()=> { mode = modeSel.value; restart(); };
diffSel.onchange = ()=> { diff = diffSel.value; };
sndSel.onchange = ()=> { sounds = sndSel.value; };
seriesSel.value = String(series.bestOf);
seriesSel.onchange = ()=> {
  series.bestOf = Number(seriesSel.value);
  series.left = 0; series.right = 0; seriesTarget = Math.ceil(series.bestOf/2);
  saveSeries(); updateWins(); restart();
};

// Pause overlay
const overlay = attachPauseOverlay({ onResume: ()=> running=true, onRestart: ()=> restart() });

const help = games.find(g => g.id === 'pong')?.help || {};
injectHelpButton({ gameId: 'pong', ...help });

// Audio (synthesized with WebAudio)
const AC = window.AudioContext ? new AudioContext() : null;
function beep(freq=440, dur=0.05, vol=0.05){
  if (!AC || sounds==='off') return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.frequency.value = freq; o.type = 'square';
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(AC.destination);
  o.start(t); o.stop(t + dur);
}

// Helpers
function status(msg){ statusEl.textContent = msg; }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function resetBall(dir = Math.random() < 0.5 ? 1 : -1){
  return {
    x: FIELD.w/2, y: FIELD.h/2,
    vx: dir * BALL.speed, vy: (Math.random()*2-1)*BALL.speed*0.5,
    spin: 0
  };
}
function pause(){ running=false; overlay.show(); }
function restart(){
  left.score = right.score = 0;
  left.y = right.y = (FIELD.h-PADDLE.h)/2;
  ball = resetBall(1);
  lScoreEl.textContent = left.score;
  rScoreEl.textContent = right.score;
  serveLock = true; running = true; status('Press Space/Enter to serve');
  emitEvent({ type: 'play', slug: 'pong' });
  shareBtn.hidden = true;
}

function expected(a, b){ return 1 / (1 + 10 ** ((b - a) / 400)); }
function updateRating(playerWon){
  const k = 32;
  const res = playerWon ? 1 : 0;
  const exp = expected(playerElo, aiElo);
  playerElo = Math.round(playerElo + k * (res - exp));
  aiElo = Math.round(aiElo + k * (exp - res));
  localStorage.setItem(ELO_KEY, playerElo);
}

// AI behavior
function aiSpeed(){
  const base = diff==='easy'? 4 : diff==='med'? 6 : diff==='hard'? 7.5 : 9.5;
  const ratingDiff = playerElo - aiElo;
  const adjust = clamp(ratingDiff / 100, -3, 3);
  return base + adjust;
}
function updateAI(){
  // error band increases with ball distance; narrows when ball is close
  const dist = Math.abs(ball.x - FIELD.w*0.7);
  const err = clamp(dist/200, 0.5, 6.0) * (diff==='easy'?1.6:diff==='med'?1.0:diff==='hard'?0.7:0.5);
  const target = ball.y - PADDLE.h/2 + (Math.random()*err - err/2);
  const delta = target - right.y;
  const speed = aiSpeed();
  right.y += clamp(delta, -speed, speed);
}


// Tick/update
function tick(dt){
  if (!running) return;
  const prevLeftY = left.y;
  const prevRightY = right.y;
  // Move paddles
  if (mode==='p2'){
    if (controls.isDown('up')) left.y -= PADDLE.speed;
    if (controls.isDown('down')) left.y += PADDLE.speed;
  } else {
    updateAI();
  }
  if (controls.isDown('p2_up')) right.y -= PADDLE.speed;
  if (controls.isDown('p2_down')) right.y += PADDLE.speed;

  left.y = clamp(left.y, 0, FIELD.h - PADDLE.h);
  right.y = clamp(right.y, 0, FIELD.h - PADDLE.h);
  left.vy = left.y - prevLeftY;
  right.vy = right.y - prevRightY;

  // Serve lock
  if (serveLock) return;

  // Move ball
  ball.x += ball.vx; ball.y += ball.vy + ball.spin*0.1;
  ball.vx = clamp(ball.vx, -BALL.max, BALL.max);
  ball.vy = clamp(ball.vy, -BALL.max, BALL.max);
  ball.spin *= Math.exp(-1.2 * dt);

  // Wall collisions
  if (ball.y < BALL.r){ ball.y = BALL.r; ball.vy *= -1; beep(660,0.03); }
  if (ball.y > FIELD.h - BALL.r){ ball.y = FIELD.h - BALL.r; ball.vy *= -1; beep(660,0.03); }

  // Paddle collisions (with angle & spin)
  // Left
  if (ball.x - BALL.r < 20 && ball.y > left.y && ball.y < left.y + PADDLE.h){
    ball.x = 20 + BALL.r;
    const rel = (ball.y - (left.y + PADDLE.h/2)) / (PADDLE.h/2);
    ball.vx = Math.abs(ball.vx) + 0.5;
    ball.vx *= 1.03; // speed up
    ball.vx = Math.min(ball.vx, BALL.max);
    ball.vx = Math.abs(ball.vx); // to the right
    ball.vy += rel * 3.2;
    ball.spin += left.vy * 0.3;
    beep(520,0.03);
  }

  // Right
  if (ball.x + BALL.r > FIELD.w - 20 && ball.y > right.y && ball.y < right.y + PADDLE.h){
    ball.x = FIELD.w - 20 - BALL.r;
    const rel = (ball.y - (right.y + PADDLE.h/2)) / (PADDLE.h/2);
    ball.vx = -Math.abs(ball.vx) - 0.5;
    ball.vx *= 1.03;
    ball.vx = Math.max(ball.vx, -BALL.max);
    ball.vy += rel * 3.2;
    ball.spin += right.vy * 0.3;
    beep(520,0.03);
  }

  // Goals
  if (ball.x < -10){
    score('R');
  } else if (ball.x > FIELD.w + 10){
    score('L');
  }
}

function score(side){
  if (side==='L') left.score++; else right.score++;
  lScoreEl.textContent = left.score;
  rScoreEl.textContent = right.score;
  beep(240,0.08,0.08);
  serveLock = true;
  ball = resetBall(side==='L' ? 1 : -1);
  status('Press Space/Enter to serve');
  emitEvent({ type: 'score', slug: 'pong', value: right.score });

  // End/win
  if (left.score >= WIN_SCORE || right.score >= WIN_SCORE){
    running = false;
    const playerWon = right.score > left.score;
    const winner = left.score > right.score ? 'Left' : 'Right';
    updateRating(playerWon);
    if (playerWon) series.right++; else series.left++;
    saveSeries(); updateWins();
    let seriesMsg = '';
    if (series.right >= seriesTarget || series.left >= seriesTarget){
      const seriesWinner = series.right > series.left ? 'Right' : 'Left';
      seriesMsg = ` Series to ${series.bestOf} won by ${seriesWinner}!`;
      series.left = 0; series.right = 0; saveSeries(); updateWins();
    }
    status(`${winner} wins!${seriesMsg} Press Restart.`);
    // Persist best score (use Right player points as "your" score in single mode)
    saveBestScore('pong', right.score);
    endSessionTimer('pong');
    emitEvent({ type: 'game_over', slug: 'pong', value: { left: left.score, right: right.score } });
    shareBtn.hidden = false;
    shareBtn.onclick = () => shareScore('pong', right.score);
  }
}

// Render
function render(){
  // Clear
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // Center dotted line
  ctx.globalAlpha = 0.25;
  for (let y=10; y<FIELD.h; y+=18){
    ctx.fillStyle = '#eaeaf2';
    ctx.fillRect(FIELD.w/2 - 2, y, 4, 10);
  }
  ctx.globalAlpha = 1;

  // Paddles
  ctx.fillStyle = '#eaeaf2';
  ctx.fillRect(10, left.y, PADDLE.w, PADDLE.h);
  ctx.fillRect(FIELD.w - 20, right.y, PADDLE.w, PADDLE.h);

  // Ball
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL.r, 0, Math.PI*2);
  ctx.fill();

  // Glow when fast
  if (Math.abs(ball.vx) > BALL.speed+2){
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.arc(ball.x - ball.vx*0.6, ball.y - ball.vy*0.6, BALL.r*2.2, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

const engine = new GameEngine();
engine.update = tick;
engine.render = render;
engine.start();

// Session timing
startSessionTimer('pong');
emitEvent({ type: 'play', slug: 'pong' });
 ErrorReporter.reportReady?.('pong');
window.addEventListener('beforeunload', ()=> endSessionTimer('pong'));
