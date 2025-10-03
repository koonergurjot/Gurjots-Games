// shared/fx/canvasFx.js
// Small canvas helpers for particles, trails and glow effects.

const TAU = Math.PI * 2;

export function createParticleSystem(ctx) {
  const particles = [];
  function add(x, y, opts = {}) {
    const speed = opts.speed ?? 1;
    const dir = opts.direction ?? Math.random() * TAU;
    particles.push({
      x,
      y,
      vx: opts.vx ?? Math.cos(dir) * speed,
      vy: opts.vy ?? Math.sin(dir) * speed,
      life: opts.life ?? 60,
      size: opts.size ?? 2,
      color: opts.color ?? 'white',
      decay: opts.decay ?? 0.95,
    });
  }
  function update() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= p.decay;
      p.vy *= p.decay;
      p.life--;
      if (p.life <= 0) {
        const lastIndex = particles.length - 1;
        if (i !== lastIndex) particles[i] = particles[lastIndex];
        particles.pop();
      }
    }
  }
  function draw() {
    particles.forEach(p => {
      const alpha = Math.max(p.life / 60, 0);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }
  return { add, update, draw, particles };
}

export function createTrail(max = 20) {
  const points = [];
  function add(x, y) {
    points.push({ x, y });
    if (points.length > max) points.shift();
  }
  function draw(ctx, opts = {}) {
    if (points.length < 2) return;
    ctx.strokeStyle = opts.color || 'white';
    ctx.lineWidth = opts.width || 2;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
  return { add, draw, points };
}

export function drawGlow(ctx, x, y, radius, color = 'rgba(255,255,255,0.5)') {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}
