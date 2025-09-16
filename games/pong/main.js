// Minimal playable Pong (canvas id='game')
export function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) return console.error('[pong] missing #game canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.width || 960;
  canvas.height = canvas.height || 540;
  const W = canvas.width, H = canvas.height;

  const paddleW = 14, paddleH = Math.floor(H * 0.2);
  const ballR = 8;
  const speed = Math.max(4, Math.floor(W / 240));

  const left = { x: 24, y: (H - paddleH) / 2, vy: 0, score: 0 };
  const right = { x: W - 24 - paddleW, y: (H - paddleH) / 2, vy: 0, score: 0 };
  const ball = { x: W / 2, y: H / 2, vx: speed, vy: speed * 0.6 };

  const keys = new Set();
  addEventListener('keydown', e => keys.add(e.key));
  addEventListener('keyup', e => keys.delete(e.key));

  function resetBall(direction = 1) {
    ball.x = W/2; ball.y = H/2;
    ball.vx = direction * speed;
    ball.vy = (Math.random() * 2 - 1) * speed;
  }

  function update() {
    left.vy = (keys.has('w')||keys.has('W') ? -speed*1.1 : 0) + (keys.has('s')||keys.has('S') ? speed*1.1 : 0);
    right.vy = (keys.has('ArrowUp')?-speed*1.1:0) + (keys.has('ArrowDown')?speed*1.1:0);

    left.y = Math.max(0, Math.min(H - paddleH, left.y + left.vy));
    right.y = Math.max(0, Math.min(H - paddleH, right.y + right.vy));

    ball.x += ball.vx; ball.y += ball.vy;
    if (ball.y - ballR < 0 && ball.vy < 0) { ball.y = ballR; ball.vy *= -1; }
    if (ball.y + ballR > H && ball.vy > 0) { ball.y = H - ballR; ball.vy *= -1; }

    const hitLeft = (ball.x - ballR <= left.x + paddleW) && (ball.y >= left.y && ball.y <= left.y + paddleH) && (ball.vx < 0);
    const hitRight = (ball.x + ballR >= right.x) && (ball.y >= right.y && ball.y <= right.y + paddleH) && (ball.vx > 0);

    if (hitLeft || hitRight) {
      ball.vx *= -1.05;
      const p = hitLeft ? left : right;
      const rel = ((ball.y - (p.y + paddleH / 2)) / (paddleH / 2));
      ball.vy = Math.max(-speed * 1.5, Math.min(speed * 1.5, ball.vy + rel * speed));
      if (hitLeft)  ball.x = left.x + paddleW + ballR + 1;
      if (hitRight) ball.x = right.x - ballR - 1;
    }

    if (ball.x < -ballR) { right.score++; resetBall(-1); }
    if (ball.x > W + ballR) { left.score++; resetBall(1); }
  }

  function draw() {
    ctx.clearRect(0,0,W,H);
    ctx.globalAlpha = 0.15; ctx.fillStyle = '#000';
    for (let y=0;y<H;y+=24) ctx.fillRect(W/2-2,y,4,12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#222';
    ctx.fillRect(left.x,left.y,paddleW,paddleH);
    ctx.fillRect(right.x,right.y,paddleW,paddleH);
    ctx.beginPath(); ctx.arc(ball.x,ball.y,ballR,0,Math.PI*2); ctx.fill();
    ctx.font = 'bold 36px system-ui, sans-serif'; ctx.textAlign='center';
    ctx.fillText(String(left.score), W*0.25, 48);
    ctx.fillText(String(right.score), W*0.75, 48);
  }

  let raf;
  function loop(){ update(); draw(); raf = requestAnimationFrame(loop); }
  loop();
  addEventListener('beforeunload', ()=>cancelAnimationFrame(raf));
}
