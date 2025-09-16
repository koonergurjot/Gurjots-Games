import { Controls } from '../../src/runtime/controls.js';
import { createState, stepState } from './logic.js';

const ACTION_MAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  a: ['Space', 'KeyJ', 'KeyZ'],
  b: ['KeyX'],
  pause: ['KeyP', 'Escape'],
  restart: ['KeyR', 'Enter']
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createStars(width, height, rng = Math.random) {
  const area = width * height;
  const count = Math.max(60, Math.floor(area / 18000));
  return Array.from({ length: count }, () => ({
    x: rng() * width,
    y: rng() * height,
    radius: rng() * 1.5 + 0.4,
    twinkle: rng() * Math.PI * 2
  }));
}

export function boot() {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) {
    console.error('[asteroids] missing #game canvas');
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('[asteroids] unable to acquire 2d context');
    return;
  }

  let viewWidth = canvas.clientWidth || canvas.width || 960;
  let viewHeight = canvas.clientHeight || canvas.height || 600;
  let stars = createStars(viewWidth, viewHeight);
  let state = createState({ width: viewWidth, height: viewHeight });
  let bestScore = state.best;

  const controls = Controls.init({ map: ACTION_MAP });
  const hud = window.HUD?.create?.({
    title: 'Asteroids',
    onPauseToggle: () => togglePause(),
    onRestart: () => restartGame()
  });

  const input = { rotate: 0, thrust: false, fire: false };
  let lastTime = performance.now();
  let raf = 0;
  let paused = false;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    viewWidth = Math.max(640, Math.round(rect.width || viewWidth || 960));
    viewHeight = Math.max(400, Math.round(rect.height || viewHeight || 600));
    canvas.width = Math.round(viewWidth * ratio);
    canvas.height = Math.round(viewHeight * ratio);
    canvas.style.width = `${viewWidth}px`;
    canvas.style.height = `${viewHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    state.width = viewWidth;
    state.height = viewHeight;
    stars = createStars(viewWidth, viewHeight);
  }

  function updateInput() {
    let rotate = 0;
    if (controls.isDown('left')) rotate -= 1;
    if (controls.isDown('right')) rotate += 1;
    input.rotate = clamp(rotate, -1, 1);
    input.thrust = controls.isDown('up');
    input.fire = controls.isDown('a') || controls.isDown('b');
  }

  function drawBackground(now) {
    ctx.fillStyle = '#050912';
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.fillStyle = '#cbd5f5';
    const time = now / 750;
    for (const star of stars) {
      const alpha = 0.35 + Math.abs(Math.sin(time + star.twinkle)) * 0.55;
      ctx.globalAlpha = clamp(alpha, 0.2, 1);
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawShip() {
    const ship = state.ship;
    if (!ship) return;
    if (ship.invincible > 0 && !state.gameOver) {
      const blink = Math.floor(ship.invincible * 6) % 2 === 0;
      if (blink) return;
    }
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle + Math.PI / 2);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -ship.radius);
    ctx.lineTo(ship.radius * 0.7, ship.radius);
    ctx.lineTo(-ship.radius * 0.7, ship.radius);
    ctx.closePath();
    ctx.stroke();

    if (ship.thrusting && !state.gameOver) {
      ctx.beginPath();
      const flame = ship.radius * (1.4 + ship.flame * 0.8);
      ctx.moveTo(0, ship.radius * 0.9);
      ctx.lineTo(ship.radius * 0.35, flame);
      ctx.lineTo(-ship.radius * 0.35, flame);
      ctx.closePath();
      ctx.strokeStyle = '#fb923c';
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAsteroids() {
    ctx.strokeStyle = '#9ca3af';
    for (const rock of state.asteroids) {
      ctx.save();
      ctx.translate(rock.x, rock.y);
      ctx.rotate(rock.angle);
      ctx.beginPath();
      const points = rock.points ?? [];
      const count = points.length || 1;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        const radius = rock.radius * (points[i] ?? 1);
        const px = Math.cos(theta) * radius;
        const py = Math.sin(theta) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.lineWidth = clamp(rock.size * 1.1, 1.5, 3.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBullets() {
    ctx.fillStyle = '#f8fafc';
    for (const bullet of state.bullets) {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawUI() {
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 18px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Score ${state.score}`, 20, 28);
    ctx.fillText(`Level ${state.level}`, 20, 52);
    ctx.fillText(`Lives ${state.lives}`, 20, 76);

    ctx.textAlign = 'right';
    ctx.fillText(`Best ${bestScore}`, viewWidth - 20, 28);

    if (state.message && state.messageTimer > 0) {
      const alpha = clamp(state.messageTimer / 1.2, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 42px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.message, viewWidth / 2, viewHeight * 0.35);
      ctx.restore();
    }

    if (paused && !state.gameOver) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 48px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Paused', viewWidth / 2, viewHeight / 2);
      ctx.restore();
    }

    if (state.gameOver) {
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = '#fecaca';
      ctx.font = '800 54px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Game Over', viewWidth / 2, viewHeight / 2 - 20);
      ctx.font = '600 24px "Inter", system-ui, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('Press R to restart', viewWidth / 2, viewHeight / 2 + 24);
      ctx.restore();
    }
  }

  function render(now) {
    drawBackground(now);
    drawAsteroids();
    drawBullets();
    drawShip();
    drawUI();
  }

  function togglePause(force) {
    const next = typeof force === 'boolean' ? force : !paused;
    if (state.gameOver && !next) return;
    if (next === paused) return;
    paused = next;
    hud?.setPaused?.(paused);
  }

  function restartGame() {
    bestScore = Math.max(bestScore, state.score, state.best);
    state = createState({ width: viewWidth, height: viewHeight, best: bestScore });
    paused = false;
    hud?.setPaused?.(false);
    lastTime = performance.now();
  }

  function step(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.12);
    lastTime = now;
    updateInput();
    if (!paused) {
      stepState(state, input, dt);
      bestScore = Math.max(bestScore, state.best, state.score);
      state.best = bestScore;
      if (state.gameOver) {
        paused = true;
        hud?.setPaused?.(true);
      }
    }
    render(now);
    raf = requestAnimationFrame(step);
  }

  function onBlur() {
    togglePause(true);
  }

  function onVisibility() {
    if (document.hidden) togglePause(true);
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    controls?.dispose?.();
    window.removeEventListener('resize', resize);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('beforeunload', cleanup, { once: true });
  window.addEventListener('keydown', event => {
    if (event.code === 'Space') event.preventDefault();
  });

  controls.on('pause', () => togglePause());
  controls.on('restart', () => restartGame());

  resize();
  lastTime = performance.now();
  raf = requestAnimationFrame(step);
}

boot();
