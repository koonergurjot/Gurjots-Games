import { injectBackButton, recordLastPlayed } from '../../shared/ui.js';
import { emitEvent } from '../../shared/achievements.js';

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
const W = cvs.width, H = cvs.height;

const scoreEl = document.getElementById('score');
const bestEl  = document.getElementById('best');

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
    this.vy = -500;
    this.r = 4;
  }
  update(dt){
    this.y += this.vy * dt;
  }
  draw(ctx){
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
  }
  update(dt, player){
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const d = Math.hypot(dx,dy) || 1;
    this.x += this.speed * dt * dx / d;
    this.y += this.speed * dt * dy / d;
  }
  draw(ctx){
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.fill();
  }
}

const player = new Player();
let bullets = [];
let enemies = [];
let spawnTimer = 0;

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
}

function restart(){
  state.running = true;
  document.getElementById('overlay').classList.remove('show');
  state.score = 0; scoreEl.textContent = '0';
  state.lives = 3;
  bestEl.textContent = state.hiscore;
  player.x = W/2; player.y = H/2;
  bullets = []; enemies = []; spawnTimer = 0;
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

  spawnTimer -= dt;
  if(spawnTimer <= 0){
    spawnTimer = 1 + Math.random()*1.5;
    enemies.push(new Enemy());
  }
  enemies.forEach(e => e.update(dt, player));

  // bullet vs enemy collisions
  for(let i=bullets.length-1; i>=0; i--){
    const b = bullets[i];
    for(let j=enemies.length-1; j>=0; j--){
      const e = enemies[j];
      const dx = b.x - e.x, dy = b.y - e.y;
      if(dx*dx + dy*dy < (b.r + e.r)*(b.r + e.r)){
        bullets.splice(i,1); enemies.splice(j,1);
        state.score++; scoreEl.textContent = state.score;
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
  emitEvent({ type: 'game_over', slug: 'shooter', value: state.score });
}

function draw(){
  ctx.fillStyle = '#0a0d13';
  ctx.fillRect(0,0,W,H);

  player.draw(ctx);
  bullets.forEach(b => b.draw(ctx));
  enemies.forEach(e => e.draw(ctx));
}
