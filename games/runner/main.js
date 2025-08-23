import { injectBackButton } from '../../shared/ui.js';

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');

injectBackButton();

const W = cvs.width, H = cvs.height;
const GROUND_Y = H - 64;

const state = {
  running: true,
  time: 0,
  score: 0,
  highScore: Number(localStorage.getItem('highScore:runner') || 0),
  speed: 300, // px/s, increases over time
};

const player = { x: 100, y: GROUND_Y - 40, w: 34, h: 40, vy: 0, onGround: true };
const gravity = 1800;
const jumpV = -750;

let obstacles = [];
let spawnTimer = 0;

const keys = new Map();
addEventListener('keydown', e => {
  keys.set(e.code, true);
  if (e.code === 'Space') jump();
  if (e.code === 'KeyP') state.running = !state.running;
  if (e.code === 'KeyR') restart();
});
addEventListener('keyup', e => keys.set(e.code, false));

// mobile/touch support
addEventListener('pointerdown', () => { if (state.running) jump(); else restart(); });
document.getElementById('restartBtn').addEventListener('click', () => restart());

function jump(){
  if (player.onGround){
    player.vy = jumpV;
    player.onGround = false;
  }
}

function restart(){
  state.running = true;
  document.getElementById('overlay').classList.remove('show');
  state.time = 0; state.score = 0; state.speed = 300;
  player.x = 100; player.y = GROUND_Y - player.h; player.vy = 0; player.onGround = true;
  obstacles = []; spawnTimer = 0;
}

let last = 0;
requestAnimationFrame(loop);
function loop(ts){
  const dt = Math.min((ts - last)/1000, 0.05);
  last = ts;
  if (state.running) update(dt);
  draw();
  requestAnimationFrame(loop);
}

function update(dt){
  state.time += dt;
  state.score = Math.floor(state.time * 10);
  state.speed = 300 + state.time * 25; // ramp up

  // spawn obstacles
  spawnTimer -= dt;
  if (spawnTimer <= 0){
    spawnTimer = 0.9 + Math.random() * 0.8; // every 0.9–1.7s
    const h = 24 + Math.floor(Math.random()*30);
    const w = 20 + Math.floor(Math.random()*28);
    obstacles.push({ x: W + 20, y: GROUND_Y - h, w, h });
  }

  // physics
  player.vy += gravity * dt;
  player.y  += player.vy * dt;
  if (player.y >= GROUND_Y - player.h){
    player.y = GROUND_Y - player.h;
    player.vy = 0;
    player.onGround = true;
  }

  // move obstacles & cull
  obstacles.forEach(o => o.x -= state.speed * dt);
  obstacles = obstacles.filter(o => o.x + o.w > -30);

  // collisions
  for (const o of obstacles){
    if (!(player.x + player.w < o.x || player.x > o.x + o.w || player.y + player.h < o.y || player.y > o.y + o.h)){
      return gameOver();
    }
  }
}

function gameOver(){
  state.running = false;
  state.highScore = Math.max(state.highScore, state.score);
  localStorage.setItem('highScore:runner', String(state.highScore));
  const over = document.getElementById('overlay');
  over.querySelector('#over-title').textContent = 'Game Over';
  over.querySelector('#over-info').textContent  = `Score: ${state.score} • Best: ${state.highScore}`;
  over.classList.add('show');
}

function draw(){
  // clear + sky
  ctx.clearRect(0,0,W,H);
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#0f1422'); g.addColorStop(1,'#0a0d13');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  // parallax hills
  drawHills('#12192a', 0.2, 120);
  drawHills('#0f1728', 0.35, 180);

  // ground
  ctx.fillStyle = '#101520'; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.strokeStyle = '#1e2433'; ctx.lineWidth = 2; ctx.beginPath();
  for(let x=0; x<W; x+=18){ ctx.moveTo(x, GROUND_Y + 0.5); ctx.lineTo(x+8, GROUND_Y + 0.5); }
  ctx.stroke();

  // player
  ctx.fillStyle = '#e6eef9';
  ctx.fillRect(player.x, Math.round(player.y), player.w, player.h);
  ctx.fillStyle = '#0a0d13'; // tiny eye
  ctx.fillRect(player.x + player.w - 10, Math.round(player.y + 10), 4, 4);

  // obstacles
  ctx.fillStyle = '#8cc8ff';
  for (const o of obstacles) ctx.fillRect(Math.round(o.x), o.y, o.w, o.h);

  // HUD
  ctx.font = 'bold 20px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  ctx.fillStyle = '#cfe6ff'; ctx.textAlign = 'left';
  ctx.fillText('Score: ' + state.score, 16, 32);
  ctx.fillText('Best: ' + state.highScore, 16, 58);
}

function drawHills(color, factor, height){
  ctx.fillStyle = color;
  const t = (state.time * state.speed * factor) % (W*2);
  ctx.beginPath(); ctx.moveTo(-t, GROUND_Y);
  for(let x=-t; x<=W*2; x+=80){
    const y = GROUND_Y - height + Math.sin((x + t) * 0.01) * 10;
    ctx.quadraticCurveTo(x + 40, y - 30, x + 80, y);
  }
  ctx.lineTo(W, GROUND_Y); ctx.lineTo(0, GROUND_Y); ctx.closePath(); ctx.fill();
}
