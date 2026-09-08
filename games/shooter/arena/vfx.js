import { ParticleSystem } from './particles.js';

async function loadConfig(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load fx config: ${response.status}`);
  }
  return response.json();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class VfxController {
  constructor(config, options = {}) {
    const maxParticles = config?.maxParticles ?? options.maxParticles ?? 512;
    this.particles = new ParticleSystem({ maxParticles });
    this.particles.configure(config?.effects ?? {});
    this.config = config;
    this.flashIntensity = 0;
    this.flashTimer = 0;
    this.flashTotal = 0;
    this.flashColor = '#ffffff';
  }

  static async create(url, options) {
    const config = await loadConfig(url);
    return new VfxController(config, options);
  }

  update(dt) {
    this.particles.update(dt);
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flashTimer = 0;
        this.flashTotal = 0;
        this.flashIntensity = 0;
      }
    }
  }

  draw(ctx, width, height) {
    this.particles.draw(ctx);
    if (this.flashTimer > 0 && this.flashIntensity > 0) {
      const prevComposite = ctx.globalCompositeOperation;
      const prevAlpha = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter';
      const remaining = this.flashTotal > 0 ? this.flashTimer / this.flashTotal : 0;
      ctx.globalAlpha = this.flashIntensity * clamp(remaining, 0, 1);
      ctx.fillStyle = this.flashColor;
      const w = width ?? ctx.canvas.width;
      const h = height ?? ctx.canvas.height;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = prevAlpha;
      ctx.globalCompositeOperation = prevComposite;
    }
  }

  burst(name, x, y, options = {}) {
    this.particles.emit(name, x, y, options);
  }

  explosion(x, y, strength = 1) {
    const scale = clamp(strength, 0.5, 2.5);
    const speedScale = 0.8 + scale * 0.35;
    this.burst('explosion', x, y, { scale, speedScale, lifeScale: scale });
    this.burst('explosionSparks', x, y, {
      scale,
      speedScale: speedScale * 1.4,
      lifeScale: 0.8 + scale * 0.2,
    });
  }

  dust(x, y, intensity = 1) {
    const scale = clamp(intensity, 0.5, 2);
    this.burst('dust', x, y, {
      scale,
      speedScale: 0.5 + scale * 0.5,
      lifeScale: 0.8 + scale * 0.4,
    });
  }

  muzzle(x, y, angle, intensity = 1) {
    const scale = clamp(intensity, 0.8, 1.8);
    this.burst('muzzle', x, y, {
      scale,
      angle,
      speedScale: 0.8 + intensity * 0.4,
      lifeScale: 0.8,
    });
    this.burst('muzzleFlash', x, y, {
      scale: scale * 1.1,
      angle,
      lifeScale: 1,
    });
    this.triggerFlash(0.08 * intensity, 0.08, '#fff2b3');
  }

  triggerFlash(power = 0.1, duration = 0.08, color = '#fff6d0') {
    this.flashIntensity = clamp(power, 0, 1);
    this.flashTimer = Math.max(duration, 0);
    this.flashTotal = this.flashTimer;
    this.flashColor = color;
  }
}
