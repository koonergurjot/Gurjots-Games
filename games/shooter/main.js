import { injectBackButton, injectHelpButton, recordLastPlayed, shareScore } from '../../shared/ui.js';
import games from '../../games.json' assert { type: 'json' };
import { emitEvent } from '../../shared/achievements.js';
import Net from './net.js';

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
const W = cvs.width, H = cvs.height;

const scoreEl = document.getElementById('score');
const bestEl  = document.getElementById('best');
const shareBtn = document.getElementById('shareBtn');
const powerEl = document.getElementById('power');
const shieldEl = document.getElementById('shield');

injectBackButton();
const help = games.find(g => g.id === 'shooter')?.help || {};
injectHelpButton({ gameId: 'shooter', ...help });
recordLastPlayed('shooter');
emitEvent({ type: 'play', slug: 'shooter' });

const state = {
  running: true,
  score: 0,
  hiscore: Number(localStorage.getItem('highscore:shooter') || 0),
  lives: 3,
  power: null,
  powerTimer: 0,
  shield: 0
};
bestEl.textContent = state.hiscore;
powerEl.textContent = 'None';
shieldEl.textContent = '0';

class Player {
  constructor(){
    this.x = W/2;
    this.y = H/2;
    this.r = 16;
    this.speed = 300;
  }
  update(dt, keys){
    const dirX = (keys.get('KeyD')?1:0) - (keys.get('KeyA')?1:0);
    const dirY = (keys.get('KeyS')?1:0) - (keys.get('KeyW')?1:0);
    this.x += dirX * this.speed * dt;
    this.y += dirY * this.speed * dt;
    this.x = Math.max(this.r, Math.min(W - this.r, this.x));
    this.y = Math.max(this.r, Math.min(H - this.r, this.y));
  }
  draw(ctx){
    ctx.fillStyle = '#e6eef9';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.fill();
    if(state.shield > 0){
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 4, 0, Math.PI*2);
      ctx.stroke();
    }
  }
}

class Bullet {
  constructor(){
    this.r = 4;
    this.reset(0,0,0,-500);
  }
  reset(x, y, vx = 0, vy = -500){
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.vx = vx;
    this.vy = vy;
  }
  update(dt){
    this.prevX = this.x;
    this.prevY = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
  draw(ctx){
    // trail
    ctx.strokeStyle = 'rgba(255,236,153,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.prevX, this.prevY);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();

    ctx.fillStyle = '#ffec99';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.fill();
  }
}

class Enemy {
  constructor(level = 1){
    this.r = 16;
    const edge = Math.floor(Math.random()*4);
    if(edge===0){ this.x = Math.random()*W; this.y = -this.r; }
    else if(edge===1){ this.x = W + this.r; this.y = Math.random()*H; }
    else if(edge===2){ this.x = Math.random()*W; this.y = H + this.r; }
    else { this.x = -this.r; this.y = Math.random()*H; }
    this.speed = (80 + Math.random()*70) * (1 + level*0.1);
    this.elite = Math.random() < 0.1 + level*0.02;
    if (this.elite){ this.speed *= 1.6; this.r = 18; }
    this.hitFlash = 0;
  }
  update(dt, player){
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d = Math.hypot(dx,dy) || 1;
    this.x += this.speed * dt * dx / d;
    this.y += this.speed * dt * dy / d;
  }
  draw(ctx){
    ctx.fillStyle = this.elite ? '#f59e0b' : '#ff6b6b';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.fill();
    if (this.hitFlash>0){
      ctx.globalAlpha = Math.min(this.hitFlash, 1);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r*0.7, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1; this.hitFlash -= 0.1;
    }
  }
}

class MuzzleFlash {
  constructor(x, y){
    this.x = x;
    this.y = y;
    this.life = 0.1;
  }
  update(dt){
    this.life -= dt;
  }
  draw(ctx){
    if (this.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.life / 0.1;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - 5, this.y - 20);
    ctx.lineTo(this.x + 5, this.y - 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

class Explosion {
  constructor(){
    this.particles = [];
    this.debris = [];
    this.x = 0;
    this.y = 0;
    this.light = 0;
  }
  reset(x, y){
    this.x = x;
    this.y = y;
    this.particles.length = 0;
    for(let i=0;i<20;i++){
      const ang = Math.random()*Math.PI*2;
      const spd = 80 + Math.random()*120;
      this.particles.push({
        x, y,
        vx: Math.cos(ang)*spd,
        vy: Math.sin(ang)*spd,
        life: 0.6,
        r: 2 + Math.random()*2
      });
    }
    this.debris.length = 0;
    for(let i=0;i<6;i++){
      const ang = Math.random()*Math.PI*2;
      const spd = 40 + Math.random()*60;
      this.debris.push({
        x, y,
        vx: Math.cos(ang)*spd,
        vy: Math.sin(ang)*spd,
        life: 0.8,
        size: 3 + Math.random()*3,
        rot: Math.random()*Math.PI*2,
        vr: (Math.random()-0.5)*6
      });
    }
    this.light = 0.4;
  }
  update(dt){
    this.particles.forEach(p => {
      p.x += p.vx*dt;
      p.y += p.vy*dt;
      p.life -= dt;
    });
    this.particles = this.particles.filter(p => p.life > 0);

    this.debris.forEach(d => {
      d.x += d.vx*dt;
      d.y += d.vy*dt;
      d.rot += d.vr*dt;
      d.life -= dt;
    });
    this.debris = this.debris.filter(d => d.life > 0);

    this.light -= dt;
  }
  draw(ctx){
    ctx.save();
    this.particles.forEach(p => {
      ctx.globalAlpha = p.life/0.6;
      ctx.fillStyle = '#ffa94d';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
    });
    this.debris.forEach(d => {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.globalAlpha = d.life/0.8;
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(-d.size/2, -d.size/2, d.size, d.size);
      ctx.restore();
    });
    if (this.light > 0){
      ctx.globalAlpha = this.light;
      const grd = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, 40);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 40, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }
  isDone(){
    return this.particles.length===0 && this.debris.length===0 && this.light<=0;
  }
}

class Turret {
  constructor(x, y){
    this.x = x;
    this.y = y;
    this.r = 12;
    this.cool = 0;
  }
  update(dt){
    this.cool -= dt;
    if(this.cool <= 0 && enemies.length){
      const target = enemies[0];
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const spd = 400;
      spawnBullet(this.x, this.y, dx/d*spd, dy/d*spd);
      flashes.push(new MuzzleFlash(this.x, this.y));
      this.cool = 0.8;
    }
  }
  draw(ctx){
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.fill();
  }
}

class Wall {
  constructor(x, y){
    this.x = x;
    this.y = y;
    this.w = 40;
    this.h = 10;
  }
  draw(ctx){
    ctx.fillStyle = '#64748b';
    ctx.fillRect(this.x - this.w/2, this.y - this.h/2, this.w, this.h);
  }
}

class Loot {
  constructor(x, y){
    this.x = x;
    this.y = y;
    this.vx = (Math.random()-0.5)*60;
    this.vy = (Math.random()-0.5)*60;
    this.r = 3;
    this.life = 6;
  }
  update(dt){
    this.x += this.vx*dt;
    this.y += this.vy*dt;
    this.life -= dt;
  }
  draw(ctx){
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.fill();
  }
}

class PowerUp {
  constructor(x, y, type){
    this.reset(x, y, type);
  }
  reset(x, y, type){
    this.x = x;
    this.y = y;
    this.type = type;
    this.vx = (Math.random()-0.5)*60;
    this.vy = (Math.random()-0.5)*60;
    this.r = 6;
    this.life = 10;
  }
  update(dt){
    this.x += this.vx*dt;
    this.y += this.vy*dt;
    this.life -= dt;
  }
  draw(ctx){
    ctx.fillStyle = this.type === 'shield' ? '#22c55e' : '#60a5fa';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.fill();
  }
}

class WaveManager {
  constructor(){
    this.wave = 1;
    this.timer = 2;
  }
  update(dt){
    this.timer -= dt;
    if(this.timer <= 0){
      this.spawnWave();
      this.wave++;
      this.timer = Math.max(0.5, 2 - this.wave*0.1);
    }
  }
  spawnWave(){
    const count = Math.min(2 + this.wave, 8);
    for(let i=0;i<count;i++) enemies.push(new Enemy(this.wave));
  }
}

const player = new Player();
const bulletPool = [];
const explosionPool = [];
let bullets = [];
let enemies = [];
let powerups = [];
let flashes = [];
let explosions = [];
let turrets = [];
let walls = [];
let loot = [];
let shakeTime = 0;
const waveManager = new WaveManager();

const keys = new Map();
addEventListener('keydown', e => {
  keys.set(e.code, true);
  if(e.code === 'Space') fire();
  if(e.code === 'KeyP') state.running = !state.running;
  if(e.code === 'KeyR') restart();
  if(e.code === 'KeyT') buildTurret();
  if(e.code === 'KeyF') buildWall();
});
addEventListener('keyup', e => keys.set(e.code, false));

document.getElementById('restartBtn').addEventListener('click', () => restart());

function spawnBullet(x, y, vx, vy){
  const b = bulletPool.pop() || new Bullet();
  b.reset(x, y, vx, vy);
  bullets.push(b);
}

function spawnExplosion(x, y){
  const ex = explosionPool.pop() || new Explosion();
  ex.reset(x, y);
  explosions.push(ex);
}

function fire(){
  const speed = 500;
  if(state.power === 'spread'){
    [-0.2, 0, 0.2].forEach(a => {
      const vx = Math.sin(a)*speed;
      const vy = -Math.cos(a)*speed;
      spawnBullet(player.x, player.y - player.r, vx, vy);
    });
  }else{
    spawnBullet(player.x, player.y - player.r, 0, -speed);
  }
  flashes.push(new MuzzleFlash(player.x, player.y - player.r));
  shakeTime = 0.1;
}

function buildTurret(){
  turrets.push(new Turret(player.x, player.y));
}

function buildWall(){
  walls.push(new Wall(player.x, player.y));
}

function restart(){
  state.running = true;
  document.getElementById('overlay').classList.remove('show');
  state.score = 0; scoreEl.textContent = '0';
  state.lives = 3;
  bestEl.textContent = state.hiscore;
  player.x = W/2; player.y = H/2;
  bullets = []; enemies = []; powerups = []; flashes = []; explosions = []; shakeTime = 0;
  waveManager.wave = 1; waveManager.timer = 2;
  state.power = null; state.powerTimer = 0; state.shield = 0;
  powerEl.textContent = 'None'; shieldEl.textContent = '0';
  emitEvent({ type: 'play', slug: 'shooter' });
}

let last = 0;
requestAnimationFrame(loop);
function loop(ts){
  const dt = Math.min((ts - last)/1000, 0.05);
  last = ts;
  if(state.running) update(dt);
  draw();
  requestAnimationFrame(loop);
}

function update(dt){
  player.update(dt, keys);
  for(let i=bullets.length-1; i>=0; i--){
    const b = bullets[i];
    b.update(dt);
    if(b.y + b.r <= 0 || b.y - b.r >= H || b.x + b.r <= 0 || b.x - b.r >= W){
      bullets.splice(i,1);
      bulletPool.push(b);
    }
  }

  flashes.forEach(f => f.update(dt));
  flashes = flashes.filter(f => f.life > 0);

  for(let i=explosions.length-1; i>=0; i--){
    const ex = explosions[i];
    ex.update(dt);
    if(ex.isDone()){
      explosions.splice(i,1);
      explosionPool.push(ex);
    }
  }

  turrets.forEach(t => t.update(dt));

  loot.forEach(l => l.update(dt));
  loot = loot.filter(l => l.life > 0);

  powerups.forEach(p => p.update(dt));
  powerups = powerups.filter(p => p.life > 0);

  waveManager.update(dt);
  enemies.forEach(e => e.update(dt, player));

  if(shakeTime > 0) shakeTime -= dt;

  // bullet vs enemy collisions
  for(let i=bullets.length-1; i>=0; i--){
    const b = bullets[i];
    for(let j=enemies.length-1; j>=0; j--){
      const e = enemies[j];
      const dx = b.x - e.x, dy = b.y - e.y;
      if(dx*dx + dy*dy < (b.r + e.r)*(b.r + e.r)){
        bullets.splice(i,1); bulletPool.push(b);
        e.hitFlash = 1;
        enemies.splice(j,1);
        spawnExplosion(e.x, e.y);
        if(Math.random() < 0.1){
          powerups.push(new PowerUp(e.x, e.y, Math.random() < 0.5 ? 'spread' : 'shield'));
        }else{
          for(let k=0;k<3;k++) loot.push(new Loot(e.x, e.y));
        }
        break;
      }
    }
  }

  for(let i=loot.length-1; i>=0; i--){
    const l = loot[i];
    const dx = player.x - l.x, dy = player.y - l.y;
    if(dx*dx + dy*dy < (player.r + l.r)*(player.r + l.r)){
      loot.splice(i,1);
      state.score += 1; scoreEl.textContent = state.score;
      emitEvent({ type: 'score', slug: 'shooter', value: state.score });
    }
  }

  for(let i=powerups.length-1; i>=0; i--){
    const p = powerups[i];
    const dx = player.x - p.x, dy = player.y - p.y;
    if(dx*dx + dy*dy < (player.r + p.r)*(player.r + p.r)){
      powerups.splice(i,1);
      if(p.type === 'spread'){
        state.power = 'spread';
        state.powerTimer = 8;
        powerEl.textContent = 'Spread';
      }else{
        state.shield = 5;
        shieldEl.textContent = Math.ceil(state.shield);
      }
    }
  }

  if(state.powerTimer > 0){
    state.powerTimer -= dt;
    if(state.powerTimer <= 0){
      state.power = null;
      powerEl.textContent = 'None';
    }
  }
  if(state.shield > 0){
    state.shield -= dt;
    if(state.shield <= 0){
      state.shield = 0;
      shieldEl.textContent = '0';
    }else{
      shieldEl.textContent = Math.ceil(state.shield);
    }
  }

  // enemy vs player
  for(let i=enemies.length-1; i>=0; i--){
    const e = enemies[i];
    const dx = player.x - e.x, dy = player.y - e.y;
    if(dx*dx + dy*dy < (player.r + e.r)*(player.r + e.r)){
      enemies.splice(i,1);
      spawnExplosion(e.x, e.y);
      if(state.shield <= 0){
        state.lives--;
        if(state.lives <= 0){
          return gameOver();
        }
      }
    }
  }

  Net.syncPlayer({ x: player.x, y: player.y });
  Net.syncEnemies(enemies.map(e => ({ x: e.x, y: e.y, r: e.r, elite: e.elite })));
  Net.syncDefenses({
    turrets: turrets.map(t => ({ x: t.x, y: t.y })),
    walls: walls.map(w => ({ x: w.x, y: w.y, w: w.w, h: w.h }))
  });
}

function gameOver(){
  state.running = false;
  state.hiscore = Math.max(state.hiscore, state.score);
  bestEl.textContent = state.hiscore;
  localStorage.setItem('highscore:shooter', String(state.hiscore));
  const over = document.getElementById('overlay');
  over.querySelector('#over-info').textContent = `Score: ${state.score} • Best: ${state.hiscore}`;
  over.classList.add('show');
  shareBtn.onclick = () => shareScore('shooter', state.score);
  emitEvent({ type: 'game_over', slug: 'shooter', value: state.score });
}

function draw(){
  ctx.save();
  if(shakeTime > 0){
    const m = 5;
    ctx.translate((Math.random()-0.5)*m, (Math.random()-0.5)*m);
  }

  ctx.fillStyle = '#0a0d13';
  ctx.fillRect(0,0,W,H);

  player.draw(ctx);
  bullets.forEach(b => b.draw(ctx));
  enemies.forEach(e => e.draw(ctx));
  walls.forEach(w => w.draw(ctx));
  turrets.forEach(t => t.draw(ctx));
  powerups.forEach(p => p.draw(ctx));
  loot.forEach(l => l.draw(ctx));
  flashes.forEach(f => f.draw(ctx));
  explosions.forEach(ex => ex.draw(ctx));

  ctx.restore();
}
