const c = document.getElementById('c'); fitCanvasToParent(c, 900, 900, 24); window.addEventListener('resize', ()=>fitCanvasToParent(c, 900, 900, 24));
const ctx = c.getContext('2d');
const N = 32;            // grid size
const CELL = c.width / N;
let dir = {x:1, y:0};
let lastDir = {x:1, y:0};
let snake = [{x:5,y:16},{x:4,y:16},{x:3,y:16}];
let food = spawnFood();
let speedMs = 120;
let score = 0;
let dead = false;
let paused = false;

function spawnFood() {
  while (true) {
    const f = { x: Math.floor(Math.random()*N), y: Math.floor(Math.random()*N) };
    if (!snake.some(s=>s.x===f.x && s.y===f.y)) return f;
  }
}

function tick() {
  if (dead) return;
  if (paused) { setTimeout(tick, speedMs); return; }
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  lastDir = {...dir};

  // Wrap around (or change to wall death by toggling below)
  if (head.x < 0) head.x = N-1;
  if (head.x >= N) head.x = 0;
  if (head.y < 0) head.y = N-1;
  if (head.y >= N) head.y = 0;

  // Self-collision
  if (snake.some((s,i)=>i>0 && s.x===head.x && s.y===head.y)) {
    dead = true;
  }

  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    score++;
    if (speedMs > 60) speedMs -= 3;
    food = spawnFood();
  } else {
    snake.pop();
  }
  draw();
  setTimeout(tick, speedMs);
}

function draw() {
  ctx.fillStyle = '#0f1320';
  ctx.fillRect(0,0,c.width,c.height);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  for (let i=0;i<=N;i++) {
    ctx.beginPath(); ctx.moveTo(i*CELL,0); ctx.lineTo(i*CELL,c.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,i*CELL); ctx.lineTo(c.width,i*CELL); ctx.stroke();
  }

  // Food
  ctx.fillStyle = '#22d3ee';
  ctx.fillRect(food.x*CELL, food.y*CELL, CELL, CELL);

  // Snake
  snake.forEach((s, idx)=>{
    const t = idx / snake.length;
    ctx.fillStyle = idx===0? '#8b5cf6' : `rgba(139,92,246,${0.8 - t*0.5})`;
    ctx.fillRect(s.x*CELL, s.y*CELL, CELL, CELL);
  });

  // HUD
  ctx.fillStyle = '#e6e7ea';
  ctx.font = 'bold 20px Inter, system-ui, sans-serif';
  ctx.fillText(`Score: ${score}`, 16, 28);

  if (paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle = '#e6e7ea';
    ctx.font = 'bold 42px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Paused', c.width/2, c.height/2);
    ctx.textAlign = 'left';
  } else if (dead) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle = '#e6e7ea';
    ctx.font = 'bold 42px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('You crashed! Press R', c.width/2, c.height/2);
    ctx.textAlign = 'left';
  }
}

document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'r' && dead) {
    // reset
    dir = {x:1,y:0}; lastDir = {x:1,y:0};
    snake = [{x:5,y:16},{x:4,y:16},{x:3,y:16}];
    food = spawnFood(); speedMs = 120; score = 0; dead = false;
    draw(); setTimeout(tick, speedMs); return;
  }
  if (k === 'p') {
    paused = !paused;
    draw();
    return;
  }
  const map = { 'arrowup':{x:0,y:-1}, 'w':{x:0,y:-1},
                'arrowdown':{x:0,y:1}, 's':{x:0,y:1},
                'arrowleft':{x:-1,y:0}, 'a':{x:-1,y:0},
                'arrowright':{x:1,y:0}, 'd':{x:1,y:0} };
  if (map[k]) {
    const nd = map[k];
    // prevent 180 turns in one tick
    if (nd.x !== -lastDir.x || nd.y !== -lastDir.y) {
      dir = nd;
    }
  }
});

draw();
setTimeout(tick, speedMs);
