import { injectBackButton, recordLastPlayed, shareScore } from '../../shared/ui.js';
import { emitEvent } from '../../shared/achievements.js';

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
const W = cvs.width, H = cvs.height;

const scoreEl = document.getElementById('score');
const bestEl  = document.getElementById('best');
const shareBtn = document.getElementById('shareBtn');

injectBackButton();
recordLastPlayed('shooter');
emitEvent({ type: 'play', slug: 'shooter' });

const state = {
  running: true,
  score: 0,
  hiscore: Number(localStorage.getItem('highscore:shooter') || 0),
  lives: 3
};
bestEl.textContent = state.hiscore;

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
  }
}

class Bullet {
  constructor(x,y){
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.vy = -500;
    this.r = 4;
  }
  update(dt){
    this.prevX = this.x;
    this.prevY = this.y;
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
  constructor(){
    this.r = 16;
    const edge = Math.floor(Math.random()*4);
    if(edge===0){ this.x = Math.random()*W; this.y = -this.r; }
    else if(edge===1){ this.x = W + this.r; this.y = Math.random()*H; }
    else if(edge===2){ this.x = Math.random()*W; this.y = H + this.r; }
    else { this.x = -this.r; this.y = Math.random()*H; }
    this.speed = 80 + Math.random()*70;
    this.elite = Math.random() < 0.15; // 15% elites
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
  constructor(x, y){
    this.x = x;
    this.y = y;
    this.particles = [];
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
    this.debris = [];
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

const player = new Player();
let bullets = [];
let enemies = [];
let flashes = [];
let explosions = [];
let spawnTimer = 0;
let shakeTime = 0;

const keys = new Map();
addEventListener('keydown', e => {
  keys.set(e.code, true);
  if(e.code === 'Space') fire();
  if(e.code === 'KeyP') state.running = !state.running;
  if(e.code === 'KeyR') restart();
});
addEventListener('keyup', e => keys.set(e.code, false));

document.getElementById('restartBtn').addEventListener('click', () => restart());

function fire(){
  bullets.push(new Bullet(player.x, player.y - player.r));
  flashes.push(new MuzzleFlash(player.x, player.y - player.r));
  shakeTime = 0.1;
}

function restart(){
  state.running = true;
  document.getElementById('overlay').classList.remove('show');
  state.score = 0; scoreEl.textContent = '0';
  state.lives = 3;
  bestEl.textContent = state.hiscore;
  player.x = W/2; player.y = H/2;
  bullets = []; enemies = []; flashes = []; explosions = []; spawnTimer = 0; shakeTime = 0;
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

  bullets.forEach(b => b.update(dt));
  bullets = bullets.filter(b => b.y + b.r > 0);

  flashes.forEach(f => f.update(dt));
  flashes = flashes.filter(f => f.life > 0);

  explosions.forEach(ex => ex.update(dt));
  explosions = explosions.filter(ex => !ex.isDone());

  spawnTimer -= dt;
  if(spawnTimer <= 0){
    spawnTimer = 1 + Math.random()*1.5;
    enemies.push(new Enemy());
  }
  enemies.forEach(e => e.update(dt, player));

  if(shakeTime > 0) shakeTime -= dt;

  // bullet vs enemy collisions
  for(let i=bullets.length-1; i>=0; i--){
    const b = bullets[i];
    for(let j=enemies.length-1; j>=0; j--){
      const e = enemies[j];
      const dx = b.x - e.x, dy = b.y - e.y;
      if(dx*dx + dy*dy < (b.r + e.r)*(b.r + e.r)){
        bullets.splice(i,1);
        e.hitFlash = 1;
        enemies.splice(j,1);
        explosions.push(new Explosion(e.x, e.y));
        state.score += e.elite ? 3 : 1; scoreEl.textContent = state.score;
        emitEvent({ type: 'score', slug: 'shooter', value: state.score });
        break;
      }
    }
  }

  // enemy vs player
  for(let i=enemies.length-1; i>=0; i--){
    const e = enemies[i];
    const dx = player.x - e.x, dy = player.y - e.y;
    if(dx*dx + dy*dy < (player.r + e.r)*(player.r + e.r)){
      enemies.splice(i,1);
      state.lives--;
      if(state.lives <= 0){
        return gameOver();
      }
    }
  }
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
  flashes.forEach(f => f.draw(ctx));
  explosions.forEach(ex => ex.draw(ctx));

  ctx.restore();
}
