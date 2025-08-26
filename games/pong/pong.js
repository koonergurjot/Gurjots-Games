const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const W = canvas.width, H = canvas.height;
const mid = { x: W/2, y: H/2 };

const PADDLE_H = 110, PADDLE_W = 12;
const BALL_R = 8;

let left = { x: 30, y: mid.y - PADDLE_H/2, vy: 0, score: 0 };
let right = { x: W - 30 - PADDLE_W, y: mid.y - PADDLE_H/2, vy: 0, score: 0 };

let ball = resetBall(1);

function resetBall(dir = Math.random()<0.5? -1 : 1) {
  return {
    x: mid.x, y: mid.y,
    vx: 5 * dir, vy: (Math.random()*2-1)*3,
    speed: 5
  };
}

let keys = {};
document.addEventListener('keydown', e=>keys[e.key.toLowerCase()] = true);
document.addEventListener('keyup', e=>keys[e.key.toLowerCase()] = false);

function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

function step() {
  // Player control (Left: W/S)
  left.vy = (keys['w']? -7:0) + (keys['s']? 7:0);
  left.y = clamp(left.y + left.vy, 0, H - PADDLE_H);

  // Simple AI for right paddle OR arrows to control
  const ai = 0.13;
  const target = ball.y - (PADDLE_H/2 - BALL_R);
  right.vy = (keys['arrowup']? -7:0) + (keys['arrowdown']? 7:0);
  if (!keys['arrowup'] && !keys['arrowdown']) {
    right.y += (target - right.y) * ai;
  } else {
    right.y = clamp(right.y + right.vy, 0, H - PADDLE_H);
  }

  // Ball physics
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Wall bounce
  if (ball.y < BALL_R || ball.y > H - BALL_R) {
    ball.vy *= -1;
  }

  // Paddle collisions
  // Left
  if (ball.x - BALL_R < left.x + PADDLE_W &&
      ball.y > left.y && ball.y < left.y + PADDLE_H &&
      ball.vx < 0) {
    ball.vx *= -1.05;
    const rel = (ball.y - (left.y + PADDLE_H/2)) / (PADDLE_H/2);
    ball.vy = rel * 6;
  }
  // Right
  if (ball.x + BALL_R > right.x &&
      ball.y > right.y && ball.y < right.y + PADDLE_H &&
      ball.vx > 0) {
    ball.vx *= -1.05;
    const rel = (ball.y - (right.y + PADDLE_H/2)) / (PADDLE_H/2);
    ball.vy = rel * 6;
  }

  // Scoring
  if (ball.x < -20) { right.score++; ball = resetBall(1); }
  if (ball.x > W+20) { left.score++; ball = resetBall(-1); }
}

function draw() {
  ctx.clearRect(0,0,W,H);
  // Court
  ctx.fillStyle = '#11162a';
  ctx.fillRect(0,0,W,H);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.setLineDash([12, 18]);
  ctx.beginPath(); ctx.moveTo(mid.x, 0); ctx.lineTo(mid.x, H); ctx.stroke();
  ctx.setLineDash([]);
  // Paddles
  ctx.fillStyle = '#e6e7ea';
  ctx.fillRect(left.x, left.y, PADDLE_W, PADDLE_H);
  ctx.fillRect(right.x, right.y, PADDLE_W, PADDLE_H);
  // Ball
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI*2);
  ctx.fill();
  // Score
  ctx.font = 'bold 42px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${left.score}`, W/2 - 80, 60);
  ctx.fillText(`${right.score}`, W/2 + 80, 60);
  // Win
  if (left.score >= 7 || right.score >= 7) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#e6e7ea';
    ctx.font = 'bold 48px Inter, system-ui, sans-serif';
    ctx.fillText(`${left.score>=7? 'Left':'Right'} wins!`, W/2, H/2);
    ctx.font = '24px Inter, system-ui, sans-serif';
    ctx.fillText(`Press R to restart`, W/2, H/2+40);
  }
}

document.addEventListener('keydown',(e)=>{
  if (e.key.toLowerCase() === 'r') {
    left.score = 0; right.score = 0; ball = resetBall();
  }
});

function loop() {
  step();
  draw();
  requestAnimationFrame(loop);
}
loop();
