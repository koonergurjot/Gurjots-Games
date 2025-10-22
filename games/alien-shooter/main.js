import { VfxController } from './vfx.js';
import { send } from '../common/diag-adapter.js';
import { drawBootPlaceholder, showErrorOverlay } from '../common/boot-utils.js';

const FX_CONFIG_URL = '/assets/alien-shooter/fx.json';
const FX_TIMEOUT_MS = 4000;

const FALLBACK_FX_CONFIG = {
  maxParticles: 320,
  effects: {
    explosion: {
      count: 18,
      life: [0.28, 0.65],
      size: [6, 16],
      speed: [80, 180],
      gravity: 60,
      drag: 1.4,
      colors: ['#ff9f43', '#ffd166', '#fff1b1'],
      fadePower: 1.6,
      shape: 'circle',
      blend: 'lighter',
    },
    explosionSparks: {
      count: 12,
      life: [0.16, 0.32],
      size: [18, 36],
      speed: [340, 520],
      drag: 3,
      colors: ['#ffd166', '#ffe29a'],
      fadePower: 1.2,
      shape: 'spark',
      thickness: [1, 3],
      blend: 'lighter',
    },
    dust: {
      count: 10,
      life: [0.6, 1.1],
      size: [4, 12],
      speed: [26, 80],
      gravity: -10,
      drag: 0.9,
      colors: ['#565264', '#6c6a7a', '#7f7b8b'],
      fadePower: 2,
      shape: 'circle',
      blend: 'source-over',
    },
    muzzle: {
      count: 6,
      life: [0.05, 0.1],
      size: [18, 32],
      speed: [240, 360],
      drag: 5,
      colors: ['#ffe066', '#fff3b0'],
      fadePower: 1,
      shape: 'spark',
      thickness: [2, 3],
      blend: 'lighter',
      cone: 0.28,
    },
    muzzleFlash: {
      count: 3,
      life: [0.04, 0.07],
      size: [26, 40],
      colors: ['rgba(255, 240, 200, 1)', 'rgba(255, 220, 120, 1)'],
      fadePower: 1.3,
      shape: 'flash',
      blend: 'lighter',
    },
  },
};

function createFallbackFx() {
  return new VfxController(FALLBACK_FX_CONFIG);
}

function withTimeout(promise, ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

class AlienShooterGame {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.width = canvas.width;
    this.height = canvas.height;
    this.dpr = window.devicePixelRatio || 1;
    this.lastTime = 0;
    this.player = {
      x: this.width / 2,
      y: this.height / 2,
      speed: 320,
    };
    this.keys = new Set();
    this.pointer = {
      x: this.width / 2,
      y: this.height / 2,
      active: false,
      shooting: false,
    };
    this.bullets = [];
    this.bulletCooldown = 0;
    this.dustTimer = 0;
    this.fx = null;
    this.ready = false;
    this.boundLoop = (time) => this.loop(time);
  }

  async init() {
    this.fx = createFallbackFx();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.onKeyUp(event));
    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    window.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.ready = true;
    send('GAME_READY');
    requestAnimationFrame(this.boundLoop);

    try {
      const loadedFx = await withTimeout(VfxController.create(FX_CONFIG_URL), FX_TIMEOUT_MS);
      if (loadedFx) {
        this.fx = loadedFx;
      }
    } catch (error) {
      console.warn('[alien-shooter] Falling back to inline FX config', error);
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const nextDpr = window.devicePixelRatio || 1;
    const width = rect.width || this.canvas.width / this.dpr || 960;
    const height = rect.height || this.canvas.height / this.dpr || 540;
    this.dpr = nextDpr;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
  }

  onKeyDown(event) {
    if (event.repeat) return;
    this.keys.add(event.code);
    if (event.code === 'Space') {
      event.preventDefault();
      this.spawnExplosion(this.pointer.x, this.pointer.y);
    }
    if (event.code === 'KeyE') {
      this.spawnExplosion(this.player.x, this.player.y - 10);
    }
  }

  onKeyUp(event) {
    this.keys.delete(event.code);
  }

  onPointerDown(event) {
    this.pointer.shooting = true;
    this.pointer.active = true;
    this.updatePointer(event);
    this.canvas.setPointerCapture(event.pointerId);
  }

  onPointerUp(event) {
    if (event.pointerId && this.canvas.hasPointerCapture?.(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.pointer.shooting = false;
  }

  onPointerMove(event) {
    this.pointer.active = true;
    this.updatePointer(event);
  }

  updatePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left);
    const y = (event.clientY - rect.top);
    this.pointer.x = x;
    this.pointer.y = y;
  }

  spawnExplosion(x, y) {
    if (!this.fx) return;
    this.fx.explosion(x, y, 1.4);
  }

  loop(time) {
    if (!this.ready) return;
    if (!this.lastTime) this.lastTime = time;
    const delta = Math.min(0.1, (time - this.lastTime) / 1000);
    this.lastTime = time;
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== this.dpr) {
      this.resize();
    }
    this.update(delta);
    this.render();
    requestAnimationFrame(this.boundLoop);
  }

  update(dt) {
    const move = { x: 0, y: 0 };
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.x += 1;
    const len = Math.hypot(move.x, move.y);
    let moveDir = { x: 0, y: 0 };
    if (len > 0) {
      moveDir = { x: move.x / len, y: move.y / len };
      this.player.x += moveDir.x * this.player.speed * dt;
      this.player.y += moveDir.y * this.player.speed * dt;
    }
    this.player.x = Math.max(24, Math.min(this.width - 24, this.player.x));
    this.player.y = Math.max(24, Math.min(this.height - 24, this.player.y));

    const speedRatio = len > 0 ? 1 : 0;
    if (speedRatio > 0) {
      this.dustTimer += dt * (0.8 + speedRatio * 0.4);
      if (this.dustTimer >= 0.05) {
        const dustX = this.player.x - moveDir.x * 18;
        const dustY = this.player.y - moveDir.y * 18 + 6;
        this.fx?.dust(dustX + (Math.random() - 0.5) * 10, dustY + (Math.random() - 0.5) * 4, 1);
        this.dustTimer = 0;
      }
    } else {
      this.dustTimer = 0;
    }

    const aimDx = this.pointer.x - this.player.x;
    const aimDy = this.pointer.y - this.player.y;
    const aimAngle = Math.atan2(aimDy, aimDx);

    if (this.pointer.shooting) {
      this.bulletCooldown -= dt;
      if (this.bulletCooldown <= 0) {
        this.fireBullet(aimAngle);
        this.bulletCooldown = 0.16;
      }
    } else {
      this.bulletCooldown = Math.max(0, this.bulletCooldown - dt);
    }

    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.bullets[i];
      bullet.life -= dt;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      const outOfBounds = bullet.x < -20 || bullet.x > this.width + 20 || bullet.y < -20 || bullet.y > this.height + 20;
      if (bullet.life <= 0 || outOfBounds) {
        this.fx?.explosion(bullet.x, bullet.y, 0.8);
        this.bullets.splice(i, 1);
      }
    }

    this.fx?.update(dt);
  }

  fireBullet(angle) {
    const muzzleDistance = 28;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const startX = this.player.x + cos * muzzleDistance;
    const startY = this.player.y + sin * muzzleDistance;
    const speed = 620;
    this.bullets.push({
      x: startX,
      y: startY,
      vx: cos * speed,
      vy: sin * speed,
      life: 1.1,
    });
    this.fx?.muzzle(startX, startY, angle, 1);
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawBackground(ctx);
    this.drawPlayer(ctx);
    this.drawBullets(ctx);
    this.drawPointer(ctx);
    this.fx?.draw(ctx, this.width, this.height);
  }

  drawBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, '#111522');
    gradient.addColorStop(1, '#05070f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const gridSize = 64;
    for (let x = gridSize; x < this.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = gridSize; y < this.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
  }

  drawPlayer(ctx) {
    ctx.save();
    ctx.translate(this.player.x, this.player.y);
    const aimDx = this.pointer.x - this.player.x;
    const aimDy = this.pointer.y - this.player.y;
    const angle = Math.atan2(aimDy, aimDx);
    ctx.rotate(angle);

    ctx.fillStyle = '#3e6dd8';
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1b2750';
    ctx.beginPath();
    ctx.moveTo(-16, -8);
    ctx.lineTo(16, -8);
    ctx.quadraticCurveTo(22, -8, 22, 0);
    ctx.quadraticCurveTo(22, 8, 16, 8);
    ctx.lineTo(-16, 8);
    ctx.quadraticCurveTo(-22, 8, -22, 0);
    ctx.quadraticCurveTo(-22, -8, -16, -8);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#8fb9ff';
    ctx.fillRect(10, -3, 16, 6);

    ctx.restore();
  }

  drawBullets(ctx) {
    ctx.fillStyle = '#f7f3d0';
    this.bullets.forEach((bullet) => {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  drawPointer(ctx) {
    if (!this.pointer.active) return;
    ctx.save();
    ctx.translate(this.pointer.x, this.pointer.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(14, 0);
    ctx.moveTo(0, -14);
    ctx.lineTo(0, 14);
    ctx.stroke();
    ctx.restore();
  }
}

function boot() {
  const canvas = document.getElementById('game');
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!canvas || !ctx) {
    console.error('[alien-shooter] Missing canvas or 2D context');
    send('GAME_ERROR', { reason: 'no-canvas' });
    showErrorOverlay('Canvas rendering is not supported on this device.');
    return;
  }

  drawBootPlaceholder(canvas, ctx, 'Launching…');

  const game = new AlienShooterGame(canvas, ctx);
  game.init().catch((error) => {
    console.error('[alien-shooter] Failed to start', error);
    send('GAME_ERROR', { reason: 'init-failed', message: error?.message });
    showErrorOverlay('We could not start Alien Shooter.');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
