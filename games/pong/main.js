import { createGamepad, keyState } from '../../shared/controls.js';
import { attachPauseOverlay, saveBestScore, shareScore } from '../../shared/ui.js';
import { startSessionTimer, endSessionTimer } from '../../shared/metrics.js';
import { emitEvent } from '../../shared/achievements.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
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
let left = { y: (FIELD.h-PADDLE.h)/2, score:0 };
let right = { y: (FIELD.h-PADDLE.h)/2, score:0 };
let ball = resetBall(1);
let running = true;
let mode = 'ai';   // 'ai' | 'p2'
let diff = 'med';  // easy | med | hard | insane
let sounds = 'on';
let serveLock = true; // require key to serve
let statusEl = document.getElementById('status');
let lScoreEl = document.getElementById('lScore');
let rScoreEl = document.getElementById('rScore');
const shareBtn = document.getElementById('shareBtn');

// Inputs
const keys = keyState();
const pad = createGamepad((gp)=> {
  // Right paddle uses primary gamepad left stick Y
  const y = gp.axes?.[1] ?? 0;
  if (Math.abs(y) > 0.2) right.y += y * PADDLE.speed * 1.2;
});
// Touch zones
const lZone = document.getElementById('leftZone');
const rZone = document.getElementById('rightZone');
function bindTouch(zone, side) {
  let active = false, lastY = 0;
  const onDown = (e)=>{ active = true; lastY = (e.touches?e.touches[0].clientY:e.clientY); };
  const onMove = (e)=>{
    if (!active) return;
    const y = (e.touches?e.touches[0].clientY:e.clientY);
    const dy = y - lastY; lastY = y;
    if (side==='L') left.y += dy*0.25; else right.y += dy*0.25;
  };
  const onUp = ()=> active = false;
  zone.addEventListener('touchstart', onDown); zone.addEventListener('touchmove', onMove); zone.addEventListener('touchend', onUp);
  zone.addEventListener('mousedown', onDown); zone.addEventListener('mousemove', onMove); zone.addEventListener('mouseup', onUp);
}
bindTouch(lZone, 'L'); bindTouch(rZone, 'R');

// UI controls
document.getElementById('pauseBtn').onclick = ()=> pause();
document.getElementById('restartBtn').onclick = ()=> restart();
const modeSel = document.getElementById('modeSel');
const diffSel = document.getElementById('diffSel');
const sndSel = document.getElementById('sndSel');
modeSel.onchange = ()=> { mode = modeSel.value; restart(); };
diffSel.onchange = ()=> { diff = diffSel.value; };
sndSel.onchange = ()=> { sounds = sndSel.value; };

// Pause overlay
const overlay = attachPauseOverlay({ onResume: ()=> running=true, onRestart: ()=> restart() });

// Keyboard binds
window.addEventListener('keydown', (e)=>{
  const k = e.key.toLowerCase();
  if (k === 'p') { pause(); }
  if (k === ' ' || k === 'enter') { serveLock = false; status(''); }
});

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
  serveLock = true; running = true; status('Press Space/Enter to serve');
  emitEvent({ type: 'play', slug: 'pong' });
  shareBtn.hidden = true;
}

// AI behavior
function aiSpeed(){
  return diff==='easy'? 4 : diff==='med'? 6 : diff==='hard'? 7.5 : 9.5;
}
function updateAI(){
  // error band increases with ball distance; narrows when ball is close
  const dist = Math.abs(ball.x - FIELD.w*0.7);
  const err = clamp(dist/200, 0.5, 6.0) * (diff==='easy'?1.6:diff==='med'?1.0:diff==='hard'?0.7:0.5);
  const target = ball.y - PADDLE.h/2 + (Math.random()*err - err/2);
  const delta = target - right.y;
  right.y += clamp(delta, -aiSpeed(), aiSpeed());
}

// Game loop with fixed timestep
let last = performance.now(), acc = 0, dt = 1000/60;
function loop(t){
  requestAnimationFrame(loop);
  acc += t-last; last = t;
  while (acc >= dt){
    tick(dt/1000);
    acc -= dt;
  }
  render();
}
requestAnimationFrame(loop);

// Tick/update
function tick(dt){
  if (!running) return;
  // Move paddles
  if (mode==='p2'){
    if (keys.has('w')) left.y -= PADDLE.speed;
    if (keys.has('s')) left.y += PADDLE.speed;
  } else {
    updateAI();
  }
  if (keys.has('arrowup')) right.y -= PADDLE.speed;
  if (keys.has('arrowdown')) right.y += PADDLE.speed;

  left.y = clamp(left.y, 0, FIELD.h - PADDLE.h);
  right.y = clamp(right.y, 0, FIELD.h - PADDLE.h);

  // Serve lock
  if (serveLock) return;

  // Move ball
  ball.x += ball.vx; ball.y += ball.vy + ball.spin*0.1;
  ball.vx = clamp(ball.vx, -BALL.max, BALL.max);
  ball.vy = clamp(ball.vy, -BALL.max, BALL.max);
  ball.spin *= 0.98;

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
    ball.spin = rel * 2.0;
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
    ball.spin = rel * -2.0;
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
    const winner = left.score > right.score ? 'Left' : 'Right';
    status(`${winner} wins! Press Restart.`);
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

// Session timing
startSessionTimer('pong');
emitEvent({ type: 'play', slug: 'pong' });
window.addEventListener('beforeunload', ()=> endSessionTimer('pong'));
