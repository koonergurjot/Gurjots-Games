import { injectHelpButton, recordLastPlayed, shareScore } from '../../shared/ui.js';
import { emitEvent } from '../../shared/achievements.js';
import * as net from './net.js';
const games = await fetch(new URL('../../games.json', import.meta.url)).then(r => r.json());
import { TILE, levels, isSolid, isSlope, maskFor } from './tiles.js';

const help = games.find(g => g.id === 'platformer')?.help || {};
injectHelpButton({ gameId: 'platformer', ...help });
recordLastPlayed('platformer');
emitEvent({ type: 'play', slug: 'platformer' });

const cvs = document.getElementById('game');
if (!(cvs instanceof HTMLCanvasElement)) {
  throw new Error('Canvas element #game not found');
}
const ctx = cvs.getContext('2d');
if (!ctx) {
  throw new Error('2D rendering context not available');
}
const W = cvs.width, H = cvs.height;

let map = [];
let currentLevel = 0;

const state = {
  running: true,
  score: 0,
  hiscore: Number(localStorage.getItem('highscore:platformer') || 0),
};

const player = { x: 100, y: 0, w: 40, h: 48, vx: 0, vy: 0, onGround: false, dir: 1 };
const buddy = { x: 100, y: 0, w: 40, h: 48, dir: 1 };
// Jump feel helpers
let jumpBuffer = 0;        // seconds remaining to accept a buffered jump
let coyoteTime = 0;        // seconds remaining to allow late jump after leaving ground
const JUMP_BUFFER_MAX = 0.12;
const COYOTE_MAX = 0.12;
let jumpHeld = false;      // for variable jump height
const moveSpeed = 300;
const gravity = 2000;
const jumpV = -900;
let camX = 0;
const enemies = [];
let enemyTimer = 3;

// Particle system
const particles = [];
const particlePool = [];
const MAX_PARTICLES = 100;

const keys = new Map();
addEventListener('keydown', e => {
  keys.set(e.code, true);
  if (e.code === 'ArrowUp' || e.code === 'Space') {
    jumpHeld = true;
    // buffer the jump even if not currently on ground
    jumpBuffer = JUMP_BUFFER_MAX;
  }
  if (e.code === 'KeyP') state.running = !state.running;
  if (e.code === 'KeyR') restart();
  if (e.code === 'KeyF') net.sendAssist();
});
addEventListener('keyup', e => {
  keys.set(e.code, false);
  if (e.code === 'ArrowUp' || e.code === 'Space') {
    jumpHeld = false;
    // variable jump height: cut upward velocity on early release
    if (player.vy < 0) player.vy *= 0.55;
  }
});
addEventListener('pointerdown', () => { if (state.running) jump(); else restart(); });
document.getElementById('restartBtn').addEventListener('click', () => restart());
const shareBtn = document.getElementById('shareBtn');
const connStatus = document.getElementById('connStatus');
document.getElementById('startCoop').addEventListener('click', () => net.connect());
net.on('connect', () => { connStatus.textContent = 'Connected'; });
net.on('state', data => { Object.assign(buddy, data); });
net.on('collect', d => {
  setTile(d.x, d.y, '0');
  state.score = d.score;
  spawnParticles(d.x * TILE + TILE/2, d.y * TILE + TILE/2, 8);
});
net.on('enemy', e => { enemies.push(e); });
net.on('assist', () => { jump(); });

async function loadLevel(idx){
  const res = await fetch(new URL(levels[idx], import.meta.url));
  const data = await res.json();
  map = data.tiles.map(r => r.split(''));
}

function jump(){
  player.vy = jumpV;
  player.onGround = false;
}

async function restart(){
  state.running = false;
  document.getElementById('overlay').classList.remove('show');
  state.score = 0;
  await loadLevel(currentLevel);
  player.x = 100; player.y = 0; player.vx = 0; player.vy = 0; player.onGround = false; player.dir = 1;
  camX = 0;
  enemyTimer = 3;
  state.running = true;
  emitEvent({ type: 'play', slug: 'platformer' });
}

async function nextLevel(){
  currentLevel++;
  if (currentLevel >= levels.length){
    gameOver(true);
    return;
  }
  state.running = false;
  await loadLevel(currentLevel);
  player.x = 100; player.y = 0; player.vx = 0; player.vy = 0; player.onGround = false; player.dir = 1;
  camX = 0;
  enemyTimer = 3;
  state.running = true;
}

let last = 0;
start();
async function start(){
  await restart();
  requestAnimationFrame(loop);
}
function loop(ts){
  const dt = Math.min((ts - last)/1000, 0.05);
  last = ts;
  if (state.running) update(dt);
  draw();
  requestAnimationFrame(loop);
}

function update(dt){
  // decrement timers
  if (jumpBuffer > 0) jumpBuffer = Math.max(0, jumpBuffer - dt);
  if (coyoteTime > 0) coyoteTime = Math.max(0, coyoteTime - dt);

  player.vx = 0;
  if (keys.get('ArrowLeft'))  player.vx = -moveSpeed;
  if (keys.get('ArrowRight')) player.vx =  moveSpeed;
  if (player.vx !== 0) player.dir = player.vx > 0 ? 1 : -1;

  // horizontal movement
  player.x += player.vx * dt;
  resolveCollisions(player, 'x');

  // vertical movement
  const wasOnGround = player.onGround;
  player.vy += gravity * dt;
  player.y += player.vy * dt;
  resolveCollisions(player, 'y');

  // if we just left ground, start coyote time window
  if (wasOnGround && !player.onGround) {
    coyoteTime = COYOTE_MAX;
  }

  // consume buffered jump if conditions met
  if (jumpBuffer > 0 && (player.onGround || coyoteTime > 0)){
    jump();
    jumpBuffer = 0;
    coyoteTime = 0;
  }

  checkCollectibles();
  updateParticles(dt);
  updateEnemies(dt);

  if (net.isConnected()) {
    net.sendState({ x: player.x, y: player.y, dir: player.dir });
  }

  if (net.amHost()) {
    enemyTimer -= dt;
    if (enemyTimer <= 0) {
      const e = spawnEnemy();
      net.sendEnemy(e);
      enemyTimer = 5;
    }
  }

  if (player.y > H + 100) gameOver(false); // fell

  // camera follows players
  const centerX = net.isConnected() ? (player.x + buddy.x) / 2 : player.x;
  camX = centerX + player.w/2 - W/2;
  const worldW = map[0].length * TILE;
  camX = Math.max(0, Math.min(camX, worldW - W));
}

function resolveCollisions(ent, axis){
  const left = Math.floor(ent.x / TILE);
  const right = Math.floor((ent.x + ent.w - 1) / TILE);
  const top = Math.floor(ent.y / TILE);
  const bottom = Math.floor((ent.y + ent.h - 1) / TILE);

  if (axis === 'x'){
    if (ent.vx > 0){
      for (let y = top; y <= bottom; y++){
        const t = getTile(right, y);
        if (isSolid(t)){
          ent.x = right * TILE - ent.w;
          ent.vx = 0;
          break;
        }
      }
    } else if (ent.vx < 0){
      for (let y = top; y <= bottom; y++){
        const t = getTile(left, y);
        if (isSolid(t)){
          ent.x = (left + 1) * TILE;
          ent.vx = 0;
          break;
        }
      }
    }
  } else {
    if (ent.vy > 0){
      let landed = false;
      for (let x = left; x <= right; x++){
        const t = getTile(x, bottom);
        if (!isSolid(t)) continue;
        if (isSlope(t)){
          const mask = maskFor(t);
          const localX = Math.floor((ent.x + ent.w/2) - x * TILE);
          const h = mask[Math.max(0, Math.min(TILE-1, localX))];
          const ground = bottom * TILE + h;
          if (ent.y + ent.h > ground){
            ent.y = ground - ent.h;
            ent.vy = 0;
            if ('onGround' in ent) ent.onGround = true;
            landed = true;
          }
        } else {
          if (ent.y + ent.h > bottom * TILE){
            ent.y = bottom * TILE - ent.h;
            ent.vy = 0;
            if ('onGround' in ent) ent.onGround = true;
            landed = true;
          }
        }
      }
      if (!landed && 'onGround' in ent) ent.onGround = false;
    } else if (ent.vy < 0){
      for (let x = left; x <= right; x++){
        const t = getTile(x, top);
        if (isSolid(t) && !isSlope(t)){
          if (ent.y < (top + 1) * TILE){
            ent.y = (top + 1) * TILE;
            ent.vy = 0;
            break;
          }
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
        emitEvent({ type: 'score', slug: 'platformer', value: state.score });
        spawnParticles(x * TILE + TILE/2, y * TILE + TILE/2, 8);
        net.sendCollect({ x, y, score: state.score });
      } else if (t === '3'){
        setTile(x, y, '0');
        nextLevel();
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
  shareBtn.onclick = () => shareScore('platformer', state.score);
  emitEvent({ type: 'game_over', slug: 'platformer', value: state.score });
}

function getTile(x, y){
  if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) return '0';
  return map[y][x];
}
function setTile(x, y, v){
  if (y < 0 || y >= map.length || x < 0 || x >= map[0].length) return;
  map[y][x] = v;
}

function spawnParticles(x, y, count){
  for (let i = 0; i < count; i++){
    if (particles.length >= MAX_PARTICLES) break;
    const p = particlePool.pop() || {};
    p.x = x;
    p.y = y;
    p.vx = (Math.random() - 0.5) * 200;
    p.vy = (Math.random() - 0.5) * 200;
    p.life = 0.5 + Math.random() * 0.5;
    particles.push(p);
  }
}

function spawnEnemy(){
  const e = { x: camX + W + 50, y: 350, w: 40, h: 40, vx: -80, vy: 0, onGround: false };
  enemies.push(e);
  return e;
}

function updateEnemies(dt){
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.vy += gravity * dt;
    e.x += e.vx * dt;
    resolveCollisions(e, 'x');
    e.y += e.vy * dt;
    resolveCollisions(e, 'y');
    if (e.x < -50) { enemies.splice(i,1); continue; }
    if (collides(player, e) || (net.isConnected() && collides(buddy, e))) {
      gameOver(false);
    }
  }
}

function drawEnemies(){
  ctx.fillStyle = '#ff5555';
  for (const e of enemies){
    ctx.fillRect(e.x - camX, e.y, e.w, e.h);
  }
}

function collides(a, b){
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function updateParticles(dt){
  for (let i = particles.length - 1; i >= 0; i--){
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0){
      particles.splice(i, 1);
      particlePool.push(p);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 500 * dt;
  }
}

function drawParticles(){
  ctx.save();
  ctx.fillStyle = '#ffd600';
  for (const p of particles){
    ctx.globalAlpha = p.life;
    ctx.fillRect(p.x - camX, p.y, 4, 4);
  }
  ctx.restore();
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
      } else if (t === '4'){
        ctx.fillStyle = '#8cc8ff';
        ctx.beginPath();
        ctx.moveTo(x * TILE - camX, (y + 1) * TILE);
        ctx.lineTo((x + 1) * TILE - camX, y * TILE);
        ctx.lineTo((x + 1) * TILE - camX, (y + 1) * TILE);
        ctx.fill();
      } else if (t === '5'){
        ctx.fillStyle = '#8cc8ff';
        ctx.beginPath();
        ctx.moveTo(x * TILE - camX, y * TILE);
        ctx.lineTo(x * TILE - camX, (y + 1) * TILE);
        ctx.lineTo((x + 1) * TILE - camX, (y + 1) * TILE);
        ctx.fill();
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

  drawParticles();
  drawEnemies();

  // buddy
  if (net.isConnected()) {
    const bx = buddy.x - camX;
    const by = Math.round(buddy.y);
    ctx.save();
    if (buddy.dir === -1) {
      ctx.scale(-1,1);
      ctx.fillStyle = '#ffb3ba';
      ctx.fillRect(-bx - buddy.w, by, buddy.w, buddy.h);
    } else {
      ctx.fillStyle = '#ffb3ba';
      ctx.fillRect(bx, by, buddy.w, buddy.h);
    }
    ctx.restore();
  }

  // player
  const px = player.x - camX;
  const py = Math.round(player.y);
  ctx.save();
  if (player.dir === -1) {
    ctx.scale(-1, 1);
    ctx.fillStyle = '#e6eef9';
    ctx.fillRect(-px - player.w, py, player.w, player.h);
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(-(px + 10), py + 10, 4, 4);
  } else {
    ctx.fillStyle = '#e6eef9';
    ctx.fillRect(px, py, player.w, player.h);
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(px + player.w - 10, py + 10, 4, 4);
  }
  ctx.restore();

  // HUD
  ctx.font = 'bold 20px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  ctx.fillStyle = '#cfe6ff'; ctx.textAlign = 'left';
  ctx.fillText('Score: ' + state.score, 16, 32);
  ctx.fillText('Best: ' + state.hiscore, 16, 58);
}
