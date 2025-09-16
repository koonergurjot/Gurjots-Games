import { Controls } from '../../src/runtime/controls.js';
import { createState, stepState } from './logic.js';

const BEST_KEY = 'asteroids:best';

function readBestScore() {
  try {
    const value = localStorage.getItem(BEST_KEY);
    return value ? Number(value) || 0 : 0;
  } catch {
    return 0;
  }
}

function storeBestScore(score) {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {}
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function createOverlay() {
  const existing = document.querySelector('.astro-overlay');
  if (existing) existing.remove();
  const box = document.createElement('div');
  box.className = 'astro-overlay';
  Object.assign(box.style, {
    position: 'fixed',
    left: '18px',
    top: '18px',
    padding: '14px 18px',
    background: 'rgba(17, 24, 39, 0.65)',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    borderRadius: '14px',
    color: '#e2e8f0',
    font: '600 14px/1.45 Inter, system-ui, sans-serif',
    pointerEvents: 'none',
    zIndex: '25',
    maxWidth: '280px'
  });
  box.innerHTML = `
    <div style="font-size:15px; letter-spacing:0.02em;">Asteroids</div>
    <div class="astro-stats" style="margin-top:6px;font-weight:500;font-size:13px;"></div>
    <div class="astro-hint" style="opacity:0.75;margin-top:8px;font-weight:400;">
      ⬅️➡️ rotate • ⬆️ thrust • Space fire • P pause • R restart
    </div>`;
  document.body.appendChild(box);
  return {
    root: box,
    stats: box.querySelector('.astro-stats'),
    hint: box.querySelector('.astro-hint')
  };
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

  const overlay = createOverlay();
  const hud = window.HUD?.create?.({
    title: 'Asteroids',
    onPauseToggle: () => togglePause(),
    onRestart: () => restartGame()
  });

  const controls = Controls.init({
    map: {
      left: ['ArrowLeft', 'KeyA'],
      right: ['ArrowRight', 'KeyD'],
      up: ['ArrowUp', 'KeyW'],
      a: ['Space', 'KeyZ', 'KeyX'],
      b: ['ShiftLeft', 'KeyJ'],
      pause: ['KeyP', 'Escape'],
      restart: ['KeyR', 'Enter']
    }
  });

  const DEFAULT_WIDTH = 960;
  const DEFAULT_HEIGHT = 600;
  let viewWidth = DEFAULT_WIDTH;
  let viewHeight = DEFAULT_HEIGHT;
  let dpr = window.devicePixelRatio || 1;
  let bestScore = readBestScore();
  let state = createState({ width: viewWidth, height: viewHeight, best: bestScore });
  let stars = [];

  const input = { rotate: 0, thrust: false, fire: false };
  let paused = false;
  let raf = null;
  let lastTime = performance.now();

  function rebuildStars() {
    const count = Math.max(60, Math.floor((viewWidth * viewHeight) / 16000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * viewWidth,
      y: Math.random() * viewHeight,
      radius: Math.random() * 1.4 + 0.4,
      phase: Math.random() * Math.PI * 2
    }));
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    viewWidth = Math.max(640, Math.round(rect.width || window.innerWidth || DEFAULT_WIDTH));
    viewHeight = Math.max(420, Math.round(rect.height || window.innerHeight || DEFAULT_HEIGHT));
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewWidth * dpr);
    canvas.height = Math.round(viewHeight * dpr);
    canvas.style.width = `${viewWidth}px`;
    canvas.style.height = `${viewHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.width = viewWidth;
    state.height = viewHeight;
    rebuildStars();
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
    ctx.fillStyle = '#04070f';
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.fillStyle = '#9ca3af';
    ctx.globalAlpha = 0.85;
    for (const star of stars) {
      const pulse = 0.55 + Math.sin(now / 600 + star.phase) * 0.45;
      ctx.globalAlpha = clamp(pulse, 0.15, 1);
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
      if (!blink) return;
    }
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle + Math.PI / 2);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -ship.radius);
    ctx.lineTo(ship.radius * 0.75, ship.radius);
    ctx.lineTo(-ship.radius * 0.75, ship.radius);
    ctx.closePath();
    ctx.stroke();
    if (ship.thrusting) {
      ctx.beginPath();
      const flame = ship.radius * (1 + ship.flame * 0.8);
      ctx.moveTo(0, ship.radius * 0.9);
      ctx.lineTo(ship.radius * 0.35, flame);
      ctx.lineTo(-ship.radius * 0.35, flame);
      ctx.closePath();
      ctx.strokeStyle = '#f97316';
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAsteroids() {
    ctx.strokeStyle = '#94a3b8';
    for (const rock of state.asteroids) {
      ctx.save();
      ctx.translate(rock.x, rock.y);
      ctx.rotate(rock.angle);
      const points = rock.shape || [];
      ctx.beginPath();
      points.forEach((scale, idx) => {
        const theta = (idx / points.length) * Math.PI * 2;
        const radius = rock.radius * scale;
        const px = Math.cos(theta) * radius;
        const py = Math.sin(theta) * radius;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.lineWidth = Math.max(1.5, rock.size);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBullets() {
    ctx.fillStyle = '#f8fafc';
    for (const bullet of state.bullets) {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawUI(now) {
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 18px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Score ${state.score}`, 20, 32);
    ctx.fillText(`Best ${bestScore}`, 20, 56);
    ctx.fillText(`Level ${state.level}`, 20, 80);
    ctx.textAlign = 'right';
    ctx.fillText(`Lives ${state.lives}`, viewWidth - 20, 32);

    if (state.messageTimer > 0 && state.message) {
      const alpha = clamp(state.messageTimer / 1.2, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '700 42px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.message, viewWidth / 2, viewHeight * 0.35);
      ctx.restore();
    }

    if (paused && !state.gameOver) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.font = '700 48px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Paused', viewWidth / 2, viewHeight / 2);
      ctx.restore();
    }

    if (state.gameOver) {
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = '#f87171';
      ctx.font = '800 54px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Game Over', viewWidth / 2, viewHeight / 2 - 20);
      ctx.font = '600 24px "Inter", system-ui, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('Press R to restart', viewWidth / 2, viewHeight / 2 + 20);
      ctx.restore();
    }
  }

  function render(now) {
    drawBackground(now);
    drawAsteroids();
    drawBullets();
    drawShip();
    drawUI(now);
  }

  function updateOverlay() {
    if (!overlay?.stats) return;
    const status = state.gameOver ? 'Game Over' : paused ? 'Paused' : 'Running';
    overlay.stats.textContent = `Score ${state.score} · Level ${state.level} · Lives ${state.lives} · Best ${bestScore} · ${status}`;
  }

  function togglePause(force) {
    const target = typeof force === 'boolean' ? force : !paused;
    if (state.gameOver && !target) return;
    if (paused === target) return;
    paused = target;
    hud?.setPaused(paused);
    updateOverlay();
  }

  function restartGame() {
    bestScore = Math.max(bestScore, state.best);
    state = createState({ width: viewWidth, height: viewHeight, best: bestScore });
    paused = false;
    hud?.setPaused(false);
    updateOverlay();
  }

  function step(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.12);
    lastTime = now;
    updateInput();
    if (!paused) {
      stepState(state, input, dt);
      if (state.gameOver) {
        paused = true;
        hud?.setPaused(true);
      }
      if (state.best > bestScore) {
        bestScore = state.best;
        storeBestScore(bestScore);
      }
    }
    render(now);
    updateOverlay();
    raf = requestAnimationFrame(step);
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    controls?.dispose?.();
    window.removeEventListener('resize', resizeCanvas);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    overlay?.root?.remove?.();
  }

  function onBlur() {
    togglePause(true);
  }

  function onVisibility() {
    if (document.hidden) togglePause(true);
  }

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('beforeunload', cleanup, { once: true });
  window.addEventListener('keydown', event => {
    if (event.code === 'Space') event.preventDefault();
  });

  if (overlay?.hint) overlay.hint.textContent = '⬅️➡️ rotate • ⬆️ thrust • Space fire • P pause • R restart';
  resizeCanvas();
  try { window.GG?.incPlays?.(); } catch {}
  controls.on('pause', () => togglePause());
  controls.on('restart', () => restartGame());
  raf = requestAnimationFrame(step);
}

boot();
