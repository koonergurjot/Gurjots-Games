const canvas = document.getElementById('game');
fitCanvasToParent(canvas, 1100, 800, 24);
addEventListener('resize', () => fitCanvasToParent(canvas, 1100, 800, 24));
const ctx = canvas.getContext('2d');
function ctxSave() { if (ctx.save) ctx.save(); }
function ctxRestore() { if (ctx.restore) ctx.restore(); }

let W = canvas.width, H = canvas.height;
const PADDLE_W = 12, PADDLE_H = 110, BALL_R = 8;
const PADDLE_COLOR = '#00f6ff', BALL_COLOR = '#ff00e6';

let left = { x: 30, y: H / 2 - PADDLE_H / 2, vy: 0, score: 0 };
let right = { x: W - 30 - PADDLE_W, y: H / 2 - PADDLE_H / 2, vy: 0, score: 0 };

function resetBall(dir = Math.random() < 0.5 ? -1 : 1) {
  return { x: W / 2, y: H / 2, vx: 5 * dir, vy: (Math.random() * 2 - 1) * 3 };
}
let ball = resetBall(1);

// Keyboard state
let keys = {};
document.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
document.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

const GAME_ID = 'pong';
GG.incPlays();
let twoP = false;

class AIPlayer {
  constructor(paddle) { this.paddle = paddle; this.speed = 0.13; }
  setDifficulty(level) { this.speed = level === 'easy' ? 0.08 : level === 'hard' ? 0.2 : 0.13; }
  update() {
    const target = ball.y - (paddleHeight(this.paddle) / 2 - BALL_R);
    this.paddle.y = clamp(
      this.paddle.y + (target - this.paddle.y) * this.speed,
      0,
      H - paddleHeight(this.paddle)
    );
  }
}
const ai = new AIPlayer(right);

function setMetaWins() {
  const w = parseInt(localStorage.getItem('gg:pong:wins') || '0');
  const l = parseInt(localStorage.getItem('gg:pong:loss') || '0');
  GG.setMeta(GAME_ID, `Wins: ${w} • Losses: ${l}`);
}
function toggle2P() { twoP = !twoP; }
function setDifficulty(level) { ai.setDifficulty(level); }

setMetaWins();

// Best score handling
const BEST_KEY = 'bestScore:pong';
function updateBestDisplay() {
  const b = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
  const el = document.getElementById('bestScore');
  if (el) el.textContent = b;
}
function saveBestScore(score) {
  try {
    const prev = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
    if (score > prev) localStorage.setItem(BEST_KEY, score);
  } catch {}
  updateBestDisplay();
}
updateBestDisplay();

// v5: pause, power-up, touch
let paused = false, lastHit = 'left', power = null;
function togglePause() { paused = !paused; }
document.addEventListener('keydown', e => {
  if (e.key.toLowerCase() === 'p') togglePause();
  if (e.key === '2') toggle2P();
  if (e.key === '1') setDifficulty('easy');
  if (e.key === '3') setDifficulty('hard');
  if (e.key === '2' && e.shiftKey) setDifficulty('medium');
  if (e.key.toLowerCase() === 'r') { left.score = 0; right.score = 0; ball = resetBall(); }
});

function maybeSpawnPower() {
  if (power || Math.random() > 0.006) return;
  power = { x: W / 2, y: 40 + Math.random() * (H - 80), ttl: 10000 };
}
function applyPower() {
  if (!power) return;
  if (Math.abs(ball.x - power.x) < 12 && Math.abs(ball.y - power.y) < 20) {
    if (lastHit === 'left') { left._boost = Date.now() + 6000; } else { right._boost = Date.now() + 6000; }
    SFX.seq([[880, 0.06, 0.25], [1320, 0.08, 0.25]]);
    power = null;
  }
  if (power) {
    power.ttl -= 16;
    if (power.ttl < 0) power = null;
  }
}
function paddleHeight(p) { return (p._boost || 0) > Date.now() ? PADDLE_H * 1.35 : PADDLE_H; }

// Touch to move left paddle
(function () {
  let dragging = false;
  canvas.addEventListener('touchstart', () => dragging = true);
  canvas.addEventListener('touchend', () => dragging = false);
  canvas.addEventListener('touchmove', e => {
    if (!dragging) return;
    const t = e.touches[0];
    const r = canvas.getBoundingClientRect();
    const y = (t.clientY - r.top) * (canvas.height / r.height);
    left.y = clamp(y - paddleHeight(left) / 2, 0, H - paddleHeight(left));
    e.preventDefault();
  }, { passive: false });
})();

function step() {
  if (paused) return;
  maybeSpawnPower();
  applyPower();

  left.vy = (keys['w'] ? -7 : 0) + (keys['s'] ? 7 : 0);
  left.y = clamp(left.y + left.vy, 0, H - paddleHeight(left));

  right.vy = (keys['arrowup'] ? -7 : 0) + (keys['arrowdown'] ? 7 : 0);
  if (!twoP && !keys['arrowup'] && !keys['arrowdown']) {
    ai.update();
  } else {
    right.y = clamp(right.y + right.vy, 0, H - paddleHeight(right));
  }

  ball.x += ball.vx; ball.y += ball.vy;
  if (ball.y < BALL_R || ball.y > H - BALL_R) { ball.vy *= -1; SFX.beep({ freq: 220 }); }

  // angle clamp helper to avoid flat trajectories
  function clampBounce(vx, vy) {
    const sp = Math.hypot(vx, vy) || 1; let ang = Math.atan2(vy, vx);
    const min = 0.25, max = Math.PI - 0.25;
    if (ang < min && ang > -min) ang = Math.sign(ang || 1) * min;
    if (ang > max || ang < -max) ang = Math.sign(ang) * (Math.PI - 0.25);
    return { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp };
  }

  if (ball.x - BALL_R < left.x + PADDLE_W && ball.y > left.y && ball.y < left.y + paddleHeight(left) && ball.vx < 0) {
    const rel = (ball.y - (left.y + paddleHeight(left) / 2)) / (paddleHeight(left) / 2);
    ball.vx = Math.abs(ball.vx) * 1.05;
    ball.vy = rel * 6;
    const n = clampBounce(ball.vx, ball.vy); ball.vx = n.vx; ball.vy = n.vy;
    lastHit = 'left'; SFX.beep({ freq: 440 });
  }

  if (ball.x + BALL_R > right.x && ball.y > right.y && ball.y < right.y + paddleHeight(right) && ball.vx > 0) {
    const rel = (ball.y - (right.y + paddleHeight(right) / 2)) / (paddleHeight(right) / 2);
    ball.vx = -Math.abs(ball.vx) * 1.05;
    ball.vy = rel * 6;
    const n = clampBounce(ball.vx, ball.vy); ball.vx = n.vx; ball.vy = n.vy;
    lastHit = 'right'; SFX.beep({ freq: 520 });
  }

  if (ball.x < -20) { right.score++; GG.addXP(2); SFX.seq([[260], [200]]); ball = resetBall(1); }
  if (ball.x > W + 20) { left.score++; GG.addXP(2); SFX.seq([[260], [200]]); ball = resetBall(-1); }
}

const trail = [];
let gridOffset = 0;
function draw() {
  trail.push({ x: ball.x, y: ball.y });
  if (trail.length > 12) trail.shift();
  ctx.clearRect(0, 0, canvas.width, canvas.height); W = canvas.width; H = canvas.height;

  ctx.fillStyle = '#11162a';
  ctx.fillRect(0, 0, W, H);

  gridOffset = (gridOffset + 0.5) % 40;
  ctxSave();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = -gridOffset; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = -gridOffset; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctxRestore();

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.setLineDash([12, 18]);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.setLineDash([]);

  ctxSave();
  trail.forEach((p, i) => {
    const a = (i + 1) / trail.length;
    ctx.fillStyle = `rgba(255,0,230,${a * 0.3})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
  });
  ctxRestore();

  ctxSave();
  ctx.fillStyle = PADDLE_COLOR; ctx.shadowColor = PADDLE_COLOR; ctx.shadowBlur = 10;
  ctx.fillRect(left.x, left.y, PADDLE_W, paddleHeight(left));
  ctx.fillRect(right.x, right.y, PADDLE_W, paddleHeight(right));
  ctxRestore();

  ctxSave();
  ctx.fillStyle = BALL_COLOR; ctx.shadowColor = BALL_COLOR; ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctxRestore();
  if (power) { ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(power.x, power.y, 10, 0, Math.PI * 2); ctx.fill(); }
  ctx.textAlign = 'center'; ctx.fillStyle = '#e6e7ea'; ctx.font = 'bold 42px Inter, system-ui, sans-serif'; ctx.fillText(`${left.score}`, W / 2 - 80, 60); ctx.fillText(`${right.score}`, W / 2 + 80, 60);
  if (paused) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#e6e7ea'; ctx.font = 'bold 34px Inter'; ctx.fillText('Paused — P to resume', W / 2, H / 2); }
  if (left.score >= 7 || right.score >= 7) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e6e7ea'; ctx.font = 'bold 48px Inter, system-ui, sans-serif';
    ctx.fillText(`${left.score >= 7 ? 'Left' : 'Right'} wins!`, W / 2, H / 2);
    ctx.font = '24px Inter, system-ui, sans-serif'; ctx.fillText(`Press R to restart`, W / 2, H / 2 + 40);
    if (left.score >= 7) {
      const w = parseInt(localStorage.getItem('gg:pong:wins') || '0') + 1;
      localStorage.setItem('gg:pong:wins', w);
      GG.addXP(10); GG.addAch(GAME_ID, 'Pong Win');
    } else {
      const l = parseInt(localStorage.getItem('gg:pong:loss') || '0') + 1;
      localStorage.setItem('gg:pong:loss', l);
    }
    if (!twoP) saveBestScore(left.score);
    setMetaWins();
  }
}

(function loop() { step(); draw(); requestAnimationFrame(loop); })();

// Difficulty selector hookup
const diffSel = document.getElementById('difficulty');
if (diffSel) {
  diffSel.addEventListener('change', e => setDifficulty(e.target.value));
  setDifficulty(diffSel.value);
}

