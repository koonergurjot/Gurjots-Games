import { Controls } from '../../src/runtime/controls.ts';
import { attachPauseOverlay, saveBestScore } from '../../shared/ui.js';
import { startSessionTimer, endSessionTimer } from '../../shared/metrics.js';
import { emitEvent } from '../../shared/achievements.js';
import * as net from './net.js';
import GameEngine from '../../shared/gameEngine.js';
import { Saucer, Boss } from './enemies.js';
import { renderFallbackPanel } from '../../shared/fallback.js';
import { createParticleSystem, drawGlow } from '../../shared/fx/canvasFx.js';
import { createFpsMonitor } from '../../shared/util/fps.js';
import { installErrorReporter } from '../../shared/debug/error-reporter.js';
import { postReady } from '../../shared/debug/post-ready.js';
import signature from 'console-signature';
const games = await fetch(new URL('../../games.json', import.meta.url)).then(r => r.json());

const help = games.find(g => g.id === 'asteroids')?.help || {};
window.helpData = help;

installErrorReporter();
const fpsMon = createFpsMonitor();
let currentFps = 0;
function reportReady(slug){ postReady({ slug }); }
async function init(){
const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas element #game not found');
}
const ctx = canvas.getContext('2d');
if (!ctx) {
  throw new Error('2D rendering context not available');
}
const DPR = Math.min(2, window.devicePixelRatio||1);
particles = createParticleSystem(ctx);

// Parallax starfield layers
const starLayers = [
  { speed: 0.2, size: 1, count: 60, stars: [] },
  { speed: 0.5, size: 2, count: 40, stars: [] },
  { speed: 1, size: 3, count: 20, stars: [] },
];
function initStars(){
  for (const layer of starLayers){
    layer.stars = Array.from({length: layer.count}, ()=> ({
      x: Math.random()*innerWidth,
      y: Math.random()*innerHeight,
    }));
  }
}
let shake = 0;
function resize(){
  canvas.width = innerWidth * DPR;
  canvas.height = innerHeight * DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  initStars();
}
addEventListener('resize', resize); resize();

// Audio (optional simple beeps)
const AC = window.AudioContext ? new AudioContext() : null;
function beep(freq=440, dur=0.05, vol=0.04){
  if (!AC) return;
  const t=AC.currentTime, o=AC.createOscillator(), g=AC.createGain();
  o.frequency.value=freq; o.type='square';
  g.gain.setValueAtTime(vol,t);
  g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t+dur);
}

// Game state
const controls = new Controls({
  map: {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    up: 'ArrowUp',
    a: 'Space',
    pause: 'KeyP',
    fireMode: 'KeyF'
  }
});
controls.on('a', () => fire());
controls.on('pause', () => {
  if (running) { pause(); hud.setPaused(true); }
  else { running = true; overlay.hide(); hud.setPaused(false); }
});
controls.on('fireMode', () => cycleFireMode());
let running = true;
let score = 0;
let lives = 3;
let wave = 1;

const ship = {
  x: innerWidth/2, y: innerHeight/2,
  vx: 0, vy: 0,
  angle: -Math.PI/2,
  thrust: 0.12,
  drag: 0.995,
  radius: 14,
  inv: 0, // invulnerability frames
};

const bullets = [];
const rocks = [];
let particles;
const enemies = [];
let saucerSpawned = false;
let bossSpawned = false;
const others = {}; // remote players

net.onShip((id, shipData)=>{
  if(!others[id]) others[id] = { ship:{}, bullets:[] };
  Object.assign(others[id].ship, shipData);
});
net.onShot((id, b)=>{ bullets.push({ ...b, remote:true }); });
net.onRocks(arr=>{ rocks.length=0; for(const r of arr) rocks.push(r); });
net.onPlayers(()=> updateStats());
net.onEnemy(e=>{
  if (e.type === 'saucer') enemies.push(new Saucer(e.x, e.y, e.dir));
  else if (e.type === 'boss') enemies.push(new Boss(e.x, e.y, e.dir));
});

const fireModes = ['single','burst','rapid'];
let fireModeIndex = 0;
let fireMode = fireModes[fireModeIndex];
function cycleFireMode(){
  fireModeIndex = (fireModeIndex + 1) % fireModes.length;
  fireMode = fireModes[fireModeIndex];
}
let coopActive = false;

let hud;
const overlay = attachPauseOverlay({
  onResume: ()=> { running = true; hud?.setPaused(false); },
  onRestart: ()=> { restart(); hud?.setPaused(false); }
});
hud = HUD.create({
  title: 'Asteroids Pro',
  onPauseToggle: () => {
    if (running) { pause(); hud.setPaused(true); }
    else { running = true; overlay.hide(); hud.setPaused(false); }
  },
  onRestart: () => restart()
});

function spawnSaucer(boss=false){
  const y = 60 + Math.random()*(innerHeight-120);
  const dir = Math.random()<0.5? 1 : -1;
  const x = dir<0? innerWidth+40 : -40;
  const enemy = boss ? new Boss(x, y, dir) : new Saucer(x, y, dir);
  enemies.push(enemy);
  net.sendEnemy({ type: boss ? 'boss' : 'saucer', x, y, dir });
}

function spawnWave(n){
  saucerSpawned = false; bossSpawned = false;
  for (let i=0;i<n;i++){
    let x = Math.random()*innerWidth, y = Math.random()*innerHeight;
    // avoid spawning too close to ship
    if (Math.hypot(x-ship.x, y-ship.y) < 120) { i--; continue; }
    rocks.push(makeRock(x,y, 3)); // size 3 = big
  }
  net.sendRocks(rocks);
}

function makeRock(x, y, size=3){
  const speed = 1.2 + Math.random()*1.3 + (wave*0.15);
  const angle = Math.random()*Math.PI*2;
  const vx = Math.cos(angle)*speed, vy=Math.sin(angle)*speed;
  const radius = size===3? 40 : size===2? 24 : 14;
  const jag = 0.6 + Math.random()*0.3;
  const verts = 10 + Math.floor(Math.random()*6);
  const offset = Array.from({length:verts}, ()=> (0.6 + Math.random()*0.5));
  return { x,y,vx,vy,rot:(Math.random()*0.02-0.01), angle:0, size, radius, jag, verts, offset };
}

function wrap(o){
  if (o.x < -50) o.x += innerWidth+100;
  if (o.x > innerWidth+50) o.x -= innerWidth+100;
  if (o.y < -50) o.y += innerHeight+100;
  if (o.y > innerHeight+50) o.y -= innerHeight+100;
}

function fire(){
  if (fireMode === 'single'){
    shoot();
  } else if (fireMode === 'burst'){
    for (let i=0;i<3;i++) setTimeout(()=> shoot( i*0.05 ), i*50);
  } else if (fireMode === 'rapid'){
    shoot(); shoot(undefined, 0.85); // two quick weaker shots
  }
}

let canShoot = true;
function shoot(spread=0, speedMul=1){
  if (!canShoot) return;
  canShoot = false;
  setTimeout(()=>canShoot=true, fireMode==='rapid'? 120 : 180);

  const speed = 7*speedMul;
  const angle = ship.angle + (spread||0);
  const vx = Math.cos(angle)*speed + ship.vx*0.2;
  const vy = Math.sin(angle)*speed + ship.vy*0.2;
  const bullet = { x: ship.x + Math.cos(angle)*ship.radius, y: ship.y + Math.sin(angle)*ship.radius, vx, vy, life: 60, enemy:false };
  bullets.push(bullet);
  beep(660,0.03);
  net.sendShot(bullet);
}

function explode(x,y, n=20, colors=['#e11d48'], shakeAmt=0){
  colors = Array.isArray(colors) ? colors : [colors];
  for (let i=0;i<n;i++){
    const color = colors[Math.floor(Math.random()*colors.length)];
    particles.add(x, y, {
      direction: Math.random()*Math.PI*2,
      speed: Math.random()*4+1,
      life: 40+Math.random()*20,
      size: 2,
      color
    });
  }
  if (shakeAmt>0) shake = Math.max(shake, shakeAmt);
  beep(220,0.09, 0.08);
}

function pause(){ running=false; overlay.show(); }
function restart(){
  running=true; score=0; lives=3; wave=1;
  ship.x=innerWidth/2; ship.y=innerHeight/2; ship.vx=ship.vy=0; ship.angle=-Math.PI/2; ship.inv=60;
  bullets.length=0; rocks.length=0; particles.particles.length=0; enemies.length=0;
  saucerSpawned = false; bossSpawned = false;
  spawnWave(4);
  updateStats();
  emitEvent({ type: 'play', slug: 'asteroids' });
}

function updateStats(){
  const teamScore = score + Object.values(net.players).reduce((a,p)=>a+(p.score||0),0);
  emitEvent({ type: 'score', slug: 'asteroids', value: teamScore });
  net.sendStats(score, lives);
}

// Init
restart();

// Game loop via shared engine
const engine = new GameEngine();
engine.update = (dt) => { if (running) update(dt); };
engine.render = () => render();
engine.start();
reportReady('asteroids');

function update(dt){
  const mul = dt * 60;
  // Parallax starfield
  for (const layer of starLayers){
    for (const s of layer.stars){
      s.x -= layer.speed * mul;
      if (s.x < 0){ s.x += innerWidth; s.y = Math.random()*innerHeight; }
    }
  }
  if (shake>0) shake *= 0.92 ** mul;

  // Ship movement
  if (controls.isDown('left')) ship.angle -= 0.065 * mul;
  if (controls.isDown('right')) ship.angle += 0.065 * mul;
  if (controls.isDown('up')) {
    ship.vx += Math.cos(ship.angle) * (ship.thrust*1.05*mul);
    ship.vy += Math.sin(ship.angle) * (ship.thrust*1.05*mul);
    particles.add(
      ship.x - Math.cos(ship.angle)*12,
      ship.y - Math.sin(ship.angle)*12,
      { vx:(Math.random()-0.5)*1.5, vy:(Math.random()-0.5)*1.5, life:18, size:2, color:'#6ee7b7' }
    );
  }
  ship.x += ship.vx * mul; ship.y += ship.vy * mul;
  ship.vx *= ship.drag ** mul; ship.vy *= ship.drag ** mul;
  wrap(ship);
  if (ship.inv>0){ ship.inv -= mul; if (ship.inv<0) ship.inv=0; }
  net.sendShip({ x: ship.x, y: ship.y, angle: ship.angle, inv: ship.inv });

  // Bullets
  for (const b of bullets){ b.x+=b.vx*mul; b.y+=b.vy*mul; b.life-=mul; wrap(b); }
  for (let i=bullets.length-1;i>=0;i--) if (bullets[i].life<=0) bullets.splice(i,1);

  // Rocks
  for (const r of rocks){ r.x+=r.vx*mul; r.y+=r.vy*mul; r.angle+=r.rot*mul; wrap(r); }

  // Enemy spawn (once per wave)
  const isHost = !coopActive || Object.keys(net.players).length === 0;
  if (!saucerSpawned && isHost){ spawnSaucer(); saucerSpawned = true; }
  if (!bossSpawned && wave % 5 === 0 && isHost){ spawnSaucer(true); bossSpawned = true; }
  for (const e of enemies){
    e.update(dt, ship, bullets);
    wrap(e);
  }

  // Collisions: bullets vs rocks
  for (let i=rocks.length-1;i>=0;i--){
    const r = rocks[i];
    for (let j=bullets.length-1;j>=0;j--){
      const b = bullets[j];
      if (b.enemy || b.remote) continue;
      if (Math.hypot(b.x-r.x, b.y-r.y) < r.radius){
        bullets.splice(j,1);
        rocks.splice(i,1);
        explode(r.x, r.y, 22, ['#eab308','#fef08a'], r.size*2);
        score += (r.size===3? 20 : r.size===2? 50 : 100);
        // split
        if (r.size>1){
          for (let s=0;s<2;s++){
            const ang = Math.random()*Math.PI*2;
            const child = makeRock(r.x, r.y, r.size-1);
            child.vx = Math.cos(ang)*(1.5+Math.random()); child.vy = Math.sin(ang)*(1.5+Math.random());
            rocks.push(child);
          }
        }
        updateStats();
        net.sendRocks(rocks);
        break;
      }
    }
  }

  // Collisions: bullets vs enemies
  for (let i=enemies.length-1;i>=0;i--){
    const e = enemies[i];
    for (let j=bullets.length-1;j>=0;j--){
      const b = bullets[j]; if (b.enemy || b.remote) continue;
      if (Math.hypot(b.x-e.x, b.y-e.y) < e.r){
        bullets.splice(j,1);
        e.hp--;
        if (e.hp<=0){
          enemies.splice(i,1);
          explode(e.x,e.y, e.type==='boss'?48:28, ['#f59e0b','#fde68a'], e.type==='boss'?8:5);
          score += e.type==='boss'?300:150;
          updateStats();
        }
        break;
      }
    }
  }

  // Collisions: ship vs rocks
  for (let i=rocks.length-1;i>=0;i--){
    const r=rocks[i];
    if (ship.inv<=0 && Math.hypot(ship.x-r.x, ship.y-r.y) < r.radius+ship.radius*0.7){
      rocks.splice(i,1);
      explode(ship.x, ship.y, 36, ['#e11d48','#f43f5e','#be123c'],8);
      lives--; ship.inv=90; ship.vx=ship.vy=0; // respawn invincibility
      updateStats();
      net.sendRocks(rocks);
      if (lives<=0){
        running=false;
        saveBestScore('asteroids', score);
        endSessionTimer('asteroids');
        emitEvent({ type: 'game_over', slug: 'asteroids', value: score });
      }
    }
  }

  // Ship hit by enemy bullets
  for (let j=bullets.length-1;j>=0;j--){
    const b=bullets[j]; if(!b.enemy) continue; if (ship.inv>0) continue;
    if (Math.hypot(ship.x-b.x, ship.y-b.y) < ship.radius){
      bullets.splice(j,1);
      explode(ship.x, ship.y, 24, ['#e11d48','#f43f5e'],6);
      lives--; ship.inv=90; ship.vx=ship.vy=0; updateStats();
      if (lives<=0){ running=false; saveBestScore('asteroids', score); endSessionTimer('asteroids'); emitEvent({ type: 'game_over', slug: 'asteroids', value: score }); }
    }
  }

  // Particles
  particles.update();

  // Wave clear
  if (rocks.length===0){
    if (!coopActive || Object.keys(net.players).length===0){
      wave++; updateStats();
      spawnWave(3 + wave); // increasing difficulty
    }
  }
}

function drawShip(x,y,a,inv=false){
  ctx.save();
  ctx.translate(x,y); ctx.rotate(a);
  const col = inv && (Math.floor(performance.now()/120)%2===0) ? '#6ee7b7' : '#94a3b8';
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(16,0); ctx.lineTo(-12,-10); ctx.lineTo(-6,0); ctx.lineTo(-12,10); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}

function drawRock(r){
  ctx.save();
  ctx.translate(r.x,r.y); ctx.rotate(r.angle);
  ctx.fillStyle = '#475569';
  ctx.beginPath();
  for (let i=0;i<r.verts;i++){
    const ang = (i/r.verts)*Math.PI*2;
    const rad = r.radius * r.offset[i] * r.jag;
    const px = Math.cos(ang)*rad, py = Math.sin(ang)*rad;
    if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth=2; ctx.stroke();
  ctx.restore();
}

function render(){
  currentFps = fpsMon.frame();
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // starfield layers
  ctx.fillStyle = '#ffffff';
  for (const layer of starLayers){
    ctx.globalAlpha = 0.2 + layer.speed*0.1;
    for (const s of layer.stars){ ctx.fillRect(s.x,s.y,layer.size,layer.size); }
  }
  ctx.globalAlpha = 1;

  ctx.save();
  if (shake>0) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);

  // ship
  drawShip(ship.x, ship.y, ship.angle, ship.inv>0);
  for (const id in others){
    const os = others[id].ship;
    if (os) drawShip(os.x, os.y, os.angle||0, os.inv>0);
  }

  // thrust glow
  if (controls.isDown('up')){
    drawGlow(ctx, ship.x - Math.cos(ship.angle)*16, ship.y - Math.sin(ship.angle)*16, 10, 'rgba(110,231,183,0.3)');
  }

  // bullets
  ctx.fillStyle = '#eaeaf2';
  for (const b of bullets){ ctx.fillRect(b.x-2,b.y-2,4,4); }

  // enemies
  for (const e of enemies){
    if (e.type === 'boss'){
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(e.x-20, e.y-10, 40, 20);
    } else {
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(e.x-12, e.y-6, 24, 12);
    }
  }

  // rocks
  for (const r of rocks){ drawRock(r); }

  // particles
  particles.draw();

  ctx.restore();

  // HUD text
  ctx.fillStyle = '#eaeaf2';
  ctx.font = '16px Inter,system-ui';
  const teamScore = score + Object.values(net.players).reduce((a,p)=>a+(p.score||0),0);
  const teamLives = lives + Object.values(net.players).reduce((a,p)=>a+(p.lives||0),0);
  ctx.fillText(`Score: ${teamScore}`, 20, 30);
  ctx.fillText(`Lives: ${teamLives}`, 20, 50);
  ctx.fillText(`Wave: ${wave}`, 20, 70);
  ctx.fillText(`FPS: ${currentFps.toFixed(0)}`, 20, 90);
  ctx.fillText(`Fire: ${fireMode}`, 20, 110);
}

// Session timing
startSessionTimer('asteroids');
window.addEventListener('beforeunload', ()=> endSessionTimer('asteroids'));
}

init().catch(e => {
  signature(e);
  renderFallbackPanel(e, 'asteroids');
});
