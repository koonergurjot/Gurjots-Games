const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');

const W = cvs.width, H = cvs.height;

const state = {
  running: true,
  score: 0,
  hiscore: Number(localStorage.getItem('highscore:asteroids') || 0),
  lives: 3,
};

const ship = { x: W/2, y: H/2, r: 18, angle: 0, vx: 0, vy: 0 };
let asteroids = [];
let bullets = [];

const keys = new Map();
addEventListener('keydown', e => {
  keys.set(e.code, true);
  if (e.code === 'Space') fire();
  if (e.code === 'KeyP') state.running = !state.running;
  if (e.code === 'KeyR') restart();
});
addEventListener('keyup', e => keys.set(e.code, false));

document.getElementById('restartBtn').addEventListener('click', () => restart());

function fire(){
  const speed = 400;
  bullets.push({
    x: ship.x + Math.cos(ship.angle) * ship.r,
    y: ship.y + Math.sin(ship.angle) * ship.r,
    vx: Math.cos(ship.angle) * speed,
    vy: Math.sin(ship.angle) * speed,
    life: 1,
  });
}

function spawnAsteroid(){
  const r = 24 + Math.random()*26; // 24-50
  let x, y;
  do {
    x = Math.random()*W;
    y = Math.random()*H;
  } while (Math.hypot(x - ship.x, y - ship.y) < 80);
  const angle = Math.random()*Math.PI*2;
  const speed = 20 + Math.random()*40;
  asteroids.push({ x, y, r, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed });
}

function restart(){
  state.running = true;
  document.getElementById('overlay').classList.remove('show');
  state.score = 0; state.lives = 3;
  ship.x = W/2; ship.y = H/2; ship.vx = ship.vy = 0; ship.angle = 0;
  asteroids = []; bullets = [];
  for (let i=0;i<5;i++) spawnAsteroid();
}

function hitShip(){
  state.lives--;
  ship.x = W/2; ship.y = H/2; ship.vx = ship.vy = 0; ship.angle = 0;
  if (state.lives <= 0) gameOver();
}

function gameOver(){
  state.running = false;
  state.hiscore = Math.max(state.hiscore, state.score);
  localStorage.setItem('highscore:asteroids', String(state.hiscore));
  const over = document.getElementById('overlay');
  over.querySelector('#over-info').textContent = `Score: ${state.score} • Best: ${state.hiscore}`;
  over.classList.add('show');
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
  // ship controls
  if (keys.get('ArrowLeft')) ship.angle -= 3*dt;
  if (keys.get('ArrowRight')) ship.angle += 3*dt;
  if (keys.get('ArrowUp')) {
    const thrust = 200;
    ship.vx += Math.cos(ship.angle) * thrust * dt;
    ship.vy += Math.sin(ship.angle) * thrust * dt;
  }
  ship.x += ship.vx * dt; ship.y += ship.vy * dt;
  ship.vx *= 0.99; ship.vy *= 0.99;
  wrap(ship);

  // asteroids
  for (const a of asteroids){
    a.x += a.vx * dt; a.y += a.vy * dt; wrap(a);
  }

  // bullets
  for (const b of bullets){
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; wrap(b);
  }
  bullets = bullets.filter(b => b.life > 0);

  // collisions
  for (let i = asteroids.length - 1; i >= 0; i--){
    const a = asteroids[i];
    // bullet collisions
    for (let j = bullets.length - 1; j >= 0; j--){
      const b = bullets[j];
      if (Math.hypot(b.x - a.x, b.y - a.y) < a.r){
        bullets.splice(j,1); asteroids.splice(i,1); state.score += 100; spawnAsteroid();
        break;
      }
    }
    // ship collision
    if (Math.hypot(ship.x - a.x, ship.y - a.y) < ship.r + a.r){
      hitShip();
    }
  }
}

function wrap(o){
  if (o.x < 0) o.x += W;
  if (o.x > W) o.x -= W;
  if (o.y < 0) o.y += H;
  if (o.y > H) o.y -= H;
}

function draw(){
  ctx.clearRect(0,0,W,H);

  // ship
  ctx.save();
  ctx.translate(ship.x, ship.y); ctx.rotate(ship.angle);
  ctx.strokeStyle = '#cfe6ff'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ship.r,0);
  ctx.lineTo(-ship.r*0.6, ship.r*0.8);
  ctx.lineTo(-ship.r*0.6, -ship.r*0.8);
  ctx.closePath(); ctx.stroke();
  ctx.restore();

  // asteroids
  ctx.strokeStyle = '#8cc8ff'; ctx.lineWidth = 2;
  for (const a of asteroids){
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI*2); ctx.stroke();
  }

  // bullets
  ctx.fillStyle = '#e6e6e6';
  for (const b of bullets){
    ctx.beginPath(); ctx.arc(b.x, b.y, 2, 0, Math.PI*2); ctx.fill();
  }

  // HUD
  ctx.font = 'bold 20px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  ctx.fillStyle = '#cfe6ff'; ctx.textAlign = 'left';
  ctx.fillText('Score: ' + state.score, 16, 32);
  ctx.fillText('Lives: ' + state.lives, 16, 58);
  ctx.fillText('Best: ' + state.hiscore, 16, 84);
}

restart();
