import { recordLastPlayed } from '../../shared/ui.js';

recordLastPlayed('platformer');

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
const W = cvs.width, H = cvs.height;
const TILE = 50;

// level definition: 40x9 tiles
const levelData = [
  "0000000000000000000000000000000000000000",
  "0000000000000000000000000000000000000000",
  "0000000000000000000000000000000000000000",
  "0000000000000000011100000000000000000000",
  "0000000000200000000000000000000020000000",
  "0011111000000000111110000000001111100000",
  "0000000000000000000000000000000000000000",
  "0000000000000000000000000000000000030000",
  "1111111111111111111111111111111111111111",
];

let map = levelData.map(r => r.split(''));

const state = {
  running: true,
  score: 0,
  hiscore: Number(localStorage.getItem('highscore:platformer') || 0),
};

const player = { x: 100, y: 0, w: 40, h: 48, vx: 0, vy: 0, onGround: false };
const moveSpeed = 300;
const gravity = 2000;
const jumpV = -900;
let camX = 0;

const keys = new Map();
addEventListener('keydown', e => {
  keys.set(e.code, true);
  if (e.code === 'ArrowUp' || e.code === 'Space') jump();
  if (e.code === 'KeyP') state.running = !state.running;
  if (e.code === 'KeyR') restart();
});
addEventListener('keyup', e => keys.set(e.code, false));
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
  state.score = 0;
  map = levelData.map(r => r.split(''));
  player.x = 100; player.y = 0; player.vx = 0; player.vy = 0; player.onGround = false;
  camX = 0;
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
  player.vx = 0;
  if (keys.get('ArrowLeft'))  player.vx = -moveSpeed;
  if (keys.get('ArrowRight')) player.vx =  moveSpeed;

  // horizontal movement
  player.x += player.vx * dt;
  resolveCollisions('x');

  // vertical movement
  player.vy += gravity * dt;
  player.y += player.vy * dt;
  resolveCollisions('y');

  checkCollectibles();

  if (player.y > H + 100) gameOver(false); // fell

  // camera follows player
  camX = player.x + player.w/2 - W/2;
  const worldW = levelData[0].length * TILE;
  camX = Math.max(0, Math.min(camX, worldW - W));
}

function resolveCollisions(axis){
  const left = Math.floor(player.x / TILE);
  const right = Math.floor((player.x + player.w - 1) / TILE);
  const top = Math.floor(player.y / TILE);
  const bottom = Math.floor((player.y + player.h - 1) / TILE);

  if (axis === 'x'){
    if (player.vx > 0){
      for (let y = top; y <= bottom; y++){
        if (getTile(right, y) === '1'){
          player.x = right * TILE - player.w;
          player.vx = 0; break;
        }
      }
    } else if (player.vx < 0){
      for (let y = top; y <= bottom; y++){
        if (getTile(left, y) === '1'){
          player.x = (left + 1) * TILE;
          player.vx = 0; break;
        }
      }
    }
  } else { // y axis
    if (player.vy > 0){
      for (let x = left; x <= right; x++){
        if (getTile(x, bottom) === '1'){
          player.y = bottom * TILE - player.h;
          player.vy = 0; player.onGround = true; return;
        }
      }
      player.onGround = false;
    } else if (player.vy < 0){
      for (let x = left; x <= right; x++){
        if (getTile(x, top) === '1'){
          player.y = (top + 1) * TILE;
          player.vy = 0; break;
        }
      }
    }
  }
}

function checkCollectibles(){
  const left = Math.floor(player.x / TILE);
  const right = Math.floor((player.x + player.w - 1) / TILE);
  const top = Math.floor(player.y / TILE);
  const bottom = Math.floor((player.y + player.h - 1) / TILE);
  for (let y = top; y <= bottom; y++){
    for (let x = left; x <= right; x++){
      const t = getTile(x, y);
      if (t === '2'){
        setTile(x, y, '0');
        state.score += 1;
      } else if (t === '3'){
        gameOver(true);
      }
    }
  }
}

function gameOver(win){
  state.running = false;
  state.hiscore = Math.max(state.hiscore, state.score);
  localStorage.setItem('highscore:platformer', String(state.hiscore));
  const over = document.getElementById('overlay');
  over.querySelector('#over-title').textContent = win ? 'You Win!' : 'Game Over';
  over.querySelector('#over-info').textContent = `Score: ${state.score} • Best: ${state.hiscore}`;
  over.classList.add('show');
}

function getTile(x, y){
  if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) return '0';
  return map[y][x];
}
function setTile(x, y, v){
  if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) return;
  map[y][x] = v;
}

function draw(){
  ctx.clearRect(0,0,W,H);
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#0f1422'); g.addColorStop(1,'#0a0d13');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

  const startCol = Math.floor(camX / TILE);
  const endCol = startCol + Math.ceil(W / TILE) + 1;
  for (let y = 0; y < map.length; y++){
    for (let x = startCol; x < endCol; x++){
      const t = getTile(x, y);
      if (t === '1'){
        ctx.fillStyle = '#8cc8ff';
        ctx.fillRect(x * TILE - camX, y * TILE, TILE, TILE);
      } else if (t === '2'){
        const cx = x * TILE + TILE/2 - camX;
        const cy = y * TILE + TILE/2;
        ctx.fillStyle = '#ffd600';
        ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI*2); ctx.fill();
      } else if (t === '3'){
        ctx.fillStyle = '#57ff57';
        ctx.fillRect(x * TILE - camX + TILE*0.25, y * TILE, TILE*0.5, TILE);
      }
    }
  }

  // player
  ctx.fillStyle = '#e6eef9';
  ctx.fillRect(player.x - camX, Math.round(player.y), player.w, player.h);
  ctx.fillStyle = '#0a0d13';
  ctx.fillRect(player.x - camX + player.w - 10, Math.round(player.y + 10), 4, 4);

  // HUD
  ctx.font = 'bold 20px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  ctx.fillStyle = '#cfe6ff'; ctx.textAlign = 'left';
  ctx.fillText('Score: ' + state.score, 16, 32);
  ctx.fillText('Best: ' + state.hiscore, 16, 58);
}
