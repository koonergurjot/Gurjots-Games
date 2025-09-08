import { keyState } from '../../shared/controls.js';
import { attachPauseOverlay, saveBestScore, shareScore } from '../../shared/ui.js';
import { startSessionTimer, endSessionTimer } from '../../shared/metrics.js';
import { emitEvent } from '../../shared/achievements.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio||1);
function resize(){
  canvas.width = innerWidth * DPR;
  canvas.height = innerHeight * DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
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
const keys = keyState();
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
const particles = [];
const saucers = [];

let fireMode = 'single'; // 'single' | 'burst' | 'rapid'
const HUD = {
  score: document.getElementById('score'),
  lives: document.getElementById('lives'),
  wave: document.getElementById('wave'),
  fireSel: document.getElementById('fireSel')
};
const shareBtn = document.getElementById('shareBtn');

document.getElementById('pauseBtn').onclick = ()=> pause();
document.getElementById('restartBtn').onclick = ()=> restart();
HUD.fireSel.onchange = ()=> fireMode = HUD.fireSel.value;

const overlay = attachPauseOverlay({ onResume: ()=> running = true, onRestart: ()=> restart() });

// Saucer enemy spawn timer
let saucerTimer = 8;
function spawnSaucer(){
  const y = 60 + Math.random()*(innerHeight-120);
  const dir = Math.random()<0.5? 1 : -1;
  saucers.push({ x: dir<0? innerWidth+40 : -40, y, vx: dir*2.2, vy: 0, r: 12, fire: 0, hp: 2 });
}

function spawnWave(n){
  for (let i=0;i<n;i++){
    let x = Math.random()*innerWidth, y = Math.random()*innerHeight;
    // avoid spawning too close to ship
    if (Math.hypot(x-ship.x, y-ship.y) < 120) { i--; continue; }
    rocks.push(makeRock(x,y, 3)); // size 3 = big
  }
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
  bullets.push({ x: ship.x + Math.cos(angle)*ship.radius, y: ship.y + Math.sin(angle)*ship.radius, vx, vy, life: 60, enemy:false });
  beep(660,0.03);
}

function explode(x,y, n=20, col='#e11d48'){
  for (let i=0;i<n;i++){
    const a = Math.random()*Math.PI*2;
    const s = Math.random()*4+1;
    particles.push({ x,y, vx:Math.cos(a)*s, vy:Math.sin(a)*s, life: 30+Math.random()*20, col });
  }
  beep(220,0.09, 0.08);
}

function pause(){ running=false; overlay.show(); }
function restart(){
  running=true; score=0; lives=3; wave=1;
  ship.x=innerWidth/2; ship.y=innerHeight/2; ship.vx=ship.vy=0; ship.angle=-Math.PI/2; ship.inv=60;
  bullets.length=0; rocks.length=0; particles.length=0; saucers.length=0; saucerTimer=6;
  spawnWave(4);
  updateHUD();
  emitEvent({ type: 'play', slug: 'asteroids' });
  shareBtn.hidden = true;
}

function updateHUD(){
  HUD.score.textContent = score;
  HUD.lives.textContent = lives;
  HUD.wave.textContent = wave;
  emitEvent({ type: 'score', slug: 'asteroids', value: score });
}

addEventListener('keydown', (e)=>{
  if (e.key === ' ') fire();
  if (e.key.toLowerCase() === 'p') pause();
});

// Init
restart();

// Loop
let last=performance.now();
function loop(t){
  requestAnimationFrame(loop);
  const dt = (t-last)/16; last=t;
  if (running) {
    update(dt);
    render();
  }
}
requestAnimationFrame(loop);

function update(dt){
  // Ship movement
  if (keys.has('arrowleft')) ship.angle -= 0.065;
  if (keys.has('arrowright')) ship.angle += 0.065;
  if (keys.has('arrowup')) {
    ship.vx += Math.cos(ship.angle) * (ship.thrust*1.05);
    ship.vy += Math.sin(ship.angle) * (ship.thrust*1.05);
    particles.push({ x: ship.x - Math.cos(ship.angle)*12, y: ship.y - Math.sin(ship.angle)*12, vx: (Math.random()-0.5)*1.5, vy: (Math.random()-0.5)*1.5, life: 18, col: '#6ee7b7' });
  }
  ship.x += ship.vx; ship.y += ship.vy;
  ship.vx *= ship.drag; ship.vy *= ship.drag;
  wrap(ship);
  if (ship.inv>0) ship.inv--;

  // Bullets
  for (const b of bullets){ b.x+=b.vx; b.y+=b.vy; b.life--; wrap(b); }
  for (let i=bullets.length-1;i>=0;i--) if (bullets[i].life<=0) bullets.splice(i,1);

  // Rocks
  for (const r of rocks){ r.x+=r.vx; r.y+=r.vy; r.angle+=r.rot; wrap(r); }

  // Saucer spawn + behavior
  saucerTimer -= dt*0.016;
  if (saucers.length===0 && saucerTimer<=0){ spawnSaucer(); saucerTimer = 10 + Math.random()*8; }
  for (const s of saucers){
    s.x += s.vx; s.y += s.vy; wrap(s);
    s.fire -= dt*0.016;
    if (s.fire<=0){
      s.fire = 1.2 + Math.random()*0.8;
      const dx = ship.x - s.x, dy = ship.y - s.y; const a = Math.atan2(dy,dx);
      const noise = (Math.random()-0.5) * (Math.hypot(dx,dy)/innerWidth) * 0.6;
      const ang = a + noise; const sp = 4.5;
      bullets.push({ x:s.x, y:s.y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp, life: 180, enemy:true });
    }
  }

  // Collisions: bullets vs rocks
  for (let i=rocks.length-1;i>=0;i--){
    const r = rocks[i];
    for (let j=bullets.length-1;j>=0;j--){
      const b = bullets[j];
      if (b.enemy) continue;
      if (Math.hypot(b.x-r.x, b.y-r.y) < r.radius){
        bullets.splice(j,1);
        rocks.splice(i,1);
        explode(r.x, r.y, 22, '#eab308');
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
        updateHUD();
        break;
      }
    }
  }

  // Collisions: bullets vs saucers
  for (let i=saucers.length-1;i>=0;i--){
    const s = saucers[i];
    for (let j=bullets.length-1;j>=0;j--){
      const b = bullets[j]; if (b.enemy) continue;
      if (Math.hypot(b.x-s.x, b.y-s.y) < s.r){ bullets.splice(j,1); s.hp--; if (s.hp<=0){ saucers.splice(i,1); explode(s.x,s.y,28,'#f59e0b'); score += 150; updateHUD(); } break; }
    }
  }

  // Collisions: ship vs rocks
  for (let i=rocks.length-1;i>=0;i--){
    const r=rocks[i];
    if (ship.inv<=0 && Math.hypot(ship.x-r.x, ship.y-r.y) < r.radius+ship.radius*0.7){
      rocks.splice(i,1);
      explode(ship.x, ship.y, 36, '#e11d48');
      lives--; ship.inv=90; ship.vx=ship.vy=0; // respawn invincibility
      updateHUD();
      if (lives<=0){
        running=false;
        saveBestScore('asteroids', score);
        endSessionTimer('asteroids');
        emitEvent({ type: 'game_over', slug: 'asteroids', value: score });
        shareBtn.hidden = false;
        shareBtn.onclick = () => shareScore('asteroids', score);
      }
    }
  }

  // Ship hit by enemy bullets
  for (let j=bullets.length-1;j>=0;j--){
    const b=bullets[j]; if(!b.enemy) continue; if (ship.inv>0) continue;
    if (Math.hypot(ship.x-b.x, ship.y-b.y) < ship.radius){
      bullets.splice(j,1);
      explode(ship.x, ship.y, 24, '#e11d48');
      lives--; ship.inv=90; ship.vx=ship.vy=0; updateHUD();
      if (lives<=0){ running=false; saveBestScore('asteroids', score); endSessionTimer('asteroids'); emitEvent({ type: 'game_over', slug: 'asteroids', value: score }); shareBtn.hidden=false; shareBtn.onclick=()=>shareScore('asteroids', score); }
    }
  }

  // Particles
  for (const p of particles){ p.x+=p.vx; p.y+=p.vy; p.life--; }
  for (let i=particles.length-1;i>=0;i--) if (particles[i].life<=0) particles.splice(i,1);

  // Wave clear
  if (rocks.length===0){
    wave++; updateHUD();
    spawnWave(3 + wave); // increasing difficulty
  }
}

function drawShip(x,y,a,inv=false){
  ctx.save();
  ctx.translate(x,y); ctx.rotate(a);
  ctx.strokeStyle = inv && (Math.floor(performance.now()/120)%2===0) ? '#6ee7b7' : '#eaeaf2';
  ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(16,0); ctx.lineTo(-12,-10); ctx.lineTo(-6,0); ctx.lineTo(-12,10); ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawRock(r){
  ctx.save();
  ctx.translate(r.x,r.y); ctx.rotate(r.angle);
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth=2;
  ctx.beginPath();
  for (let i=0;i<r.verts;i++){
    const ang = (i/r.verts)*Math.PI*2;
    const rad = r.radius * r.offset[i] * r.jag;
    const px = Math.cos(ang)*rad, py = Math.sin(ang)*rad;
    if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath(); ctx.stroke();
  ctx.restore();
}

function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // background stars (cheap)
  ctx.globalAlpha = 0.2;
  for (let i=0;i<30;i++){
    ctx.fillStyle = '#ffffff';
    ctx.fillRect((i*97 + performance.now()*0.02)%innerWidth, (i*53)%innerHeight, 2, 2);
  }
  ctx.globalAlpha = 1;

  // ship
  drawShip(ship.x, ship.y, ship.angle, ship.inv>0);

  // thrust glow
  if (keys.has('arrowup')){
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.arc(ship.x - Math.cos(ship.angle)*16, ship.y - Math.sin(ship.angle)*16, 10, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // bullets
  ctx.fillStyle = '#eaeaf2';
  for (const b of bullets){ ctx.fillRect(b.x-2,b.y-2,4,4); }

  // saucers
  ctx.fillStyle = '#f59e0b'; for (const s of saucers){ ctx.fillRect(s.x-12, s.y-6, 24, 12); }

  // rocks
  for (const r of rocks){ drawRock(r); }

  // particles
  for (const p of particles){ ctx.globalAlpha = Math.max(p.life/50,0); ctx.fillStyle = p.col; ctx.fillRect(p.x,p.y,2,2); }
  ctx.globalAlpha = 1;
}

// Session timing
startSessionTimer('asteroids');
window.addEventListener('beforeunload', ()=> endSessionTimer('asteroids'));
