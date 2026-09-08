const TWO_PI = Math.PI * 2;

function randRange(range, fallback = 0) {
  if (Array.isArray(range)) {
    const [min, max] = range;
    if (max === undefined) return min ?? fallback;
    return min + Math.random() * (max - min);
  }
  if (typeof range === 'number') return range;
  return fallback;
}

function pick(array, fallback = '#fff') {
  if (!Array.isArray(array) || array.length === 0) return fallback;
  const idx = Math.floor(Math.random() * array.length);
  return array[idx];
}

class Particle {
  constructor() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.life = 0.5;
    this.age = 0;
    this.size = 8;
    this.thickness = 1;
    this.color = '#fff';
    this.alpha = 1;
    this.baseAlpha = 1;
    this.fadePower = 1;
    this.gravity = 0;
    this.drag = 0;
    this.rotation = 0;
    this.spin = 0;
    this.shape = 'circle';
    this.blend = 'source-over';
  }

  init(data) {
    this.active = true;
    this.x = data.x;
    this.y = data.y;
    this.vx = data.vx;
    this.vy = data.vy;
    this.life = Math.max(0.001, data.life);
    this.age = 0;
    this.size = Math.max(0.1, data.size);
    this.thickness = Math.max(0.1, data.thickness);
    this.color = data.color;
    this.alpha = 1;
    this.baseAlpha = data.alpha ?? 1;
    this.fadePower = data.fadePower ?? 1;
    this.gravity = data.gravity ?? 0;
    this.drag = Math.max(0, data.drag ?? 0);
    this.rotation = data.rotation ?? 0;
    this.spin = data.spin ?? 0;
    this.shape = data.shape ?? 'circle';
    this.blend = data.blend ?? 'source-over';
  }

  update(dt) {
    this.age += dt;
    if (this.age >= this.life) {
      return false;
    }

    const dragFactor = Math.max(0, 1 - this.drag * dt);
    this.vx *= dragFactor;
    this.vy *= dragFactor;
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rotation += this.spin * dt;

    const t = this.age / this.life;
    const fade = Math.pow(Math.max(0, 1 - t), this.fadePower);
    this.alpha = this.baseAlpha * fade;
    return true;
  }
}

export class ParticleSystem {
  constructor({ maxParticles = 512 } = {}) {
    this.maxParticles = maxParticles;
    this.active = [];
    this.free = [];
    for (let i = 0; i < maxParticles; i += 1) {
      this.free.push(new Particle());
    }
    this.effects = {};
    this.passBuffers = new Map();
    this.passOrder = [];
    this.ensurePass('source-over');
    this.lineCapSet = false;
  }

  ensurePass(blend) {
    if (!this.passBuffers.has(blend)) {
      this.passBuffers.set(blend, []);
      this.passOrder.push(blend);
    }
  }

  configure(effects = {}) {
    this.effects = effects;
    Object.values(effects).forEach((effect) => {
      this.ensurePass(effect?.blend ?? 'source-over');
    });
  }

  _allocParticle() {
    if (this.free.length > 0) {
      return this.free.pop();
    }
    if (this.active.length < this.maxParticles) {
      return new Particle();
    }
    return null;
  }

  emit(name, x, y, options = {}) {
    const effect = this.effects?.[name];
    if (!effect) return;

    const countBase = effect.count ?? 1;
    const countScale = options.countScale ?? 1;
    const count = Math.max(1, Math.round(countBase * countScale));
    const scale = options.scale ?? 1;
    const speedScale = options.speedScale ?? 1;
    const lifeScale = options.lifeScale ?? 1;
    const alpha = options.alpha;
    const blend = options.blend ?? effect.blend ?? 'source-over';
    const baseAngle = options.angle ?? 0;
    const cone = options.spread ?? effect.cone;

    const isDirectional = typeof baseAngle === 'number' && typeof cone === 'number';
    for (let i = 0; i < count; i += 1) {
      const particle = this._allocParticle();
      if (!particle) break;

      const life = Math.max(0.016, randRange(effect.life, 0.5) * lifeScale);
      const size = Math.max(0.1, randRange(effect.size, 4) * scale);
      const speed = randRange(effect.speed, 0) * speedScale;
      let angle;
      if (isDirectional) {
        const spread = cone * 0.5;
        angle = baseAngle + (Math.random() * 2 - 1) * spread;
      } else {
        angle = Math.random() * TWO_PI;
      }
      const vx = speed * Math.cos(angle);
      const vy = speed * Math.sin(angle);

      const shape = options.shape ?? effect.shape ?? 'circle';
      let rotation = options.rotation;
      if (rotation === undefined) {
        if (shape === 'spark') {
          rotation = Math.atan2(vy, vx);
        } else {
          rotation = 0;
        }
      }

      const data = {
        x,
        y,
        vx,
        vy,
        life,
        size,
        thickness: randRange(effect.thickness, 1) * (options.thicknessScale ?? 1),
        color: options.color ?? pick(effect.colors, '#ffffff'),
        alpha,
        fadePower: options.fadePower ?? effect.fadePower ?? 1,
        gravity: effect.gravity ?? 0,
        drag: effect.drag ?? 0,
        rotation,
        spin: randRange(effect.spin, 0),
        shape,
        blend,
      };

      particle.init(data);
      this.active.push(particle);
    }
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const particle = this.active[i];
      if (!particle.update(dt)) {
        const lastIndex = this.active.length - 1;
        const last = this.active[lastIndex];
        if (i !== lastIndex) {
          this.active[i] = last;
        }
        this.active.pop();
        particle.active = false;
        this.free.push(particle);
      }
    }
  }

  draw(ctx) {
    if (!this.lineCapSet) {
      ctx.lineCap = 'round';
      this.lineCapSet = true;
    }
    this.passBuffers.forEach((buffer) => {
      buffer.length = 0;
    });

    for (let i = 0; i < this.active.length; i += 1) {
      const particle = this.active[i];
      const pass = particle.blend;
      if (!this.passBuffers.has(pass)) {
        this.ensurePass(pass);
      }
      this.passBuffers.get(pass).push(particle);
    }

    const previousBlend = ctx.globalCompositeOperation;
    for (let p = 0; p < this.passOrder.length; p += 1) {
      const passName = this.passOrder[p];
      const particles = this.passBuffers.get(passName);
      if (!particles || particles.length === 0) continue;
      ctx.globalCompositeOperation = passName;
      let previousFill = null;
      let previousStroke = null;
      let previousLineWidth = null;

      for (let i = 0; i < particles.length; i += 1) {
        const particle = particles[i];
        if (particle.alpha <= 0) continue;
        if (particle.shape === 'spark') {
          if (previousStroke !== particle.color) {
            ctx.strokeStyle = particle.color;
            previousStroke = particle.color;
          }
          if (previousLineWidth !== particle.thickness) {
            ctx.lineWidth = particle.thickness;
            previousLineWidth = particle.thickness;
          }
          ctx.globalAlpha = particle.alpha;
          const dx = Math.cos(particle.rotation) * particle.size * 0.5;
          const dy = Math.sin(particle.rotation) * particle.size * 0.5;
          ctx.beginPath();
          ctx.moveTo(particle.x - dx, particle.y - dy);
          ctx.lineTo(particle.x + dx, particle.y + dy);
          ctx.stroke();
        } else {
          if (previousFill !== particle.color) {
            ctx.fillStyle = particle.color;
            previousFill = particle.color;
          }
          ctx.globalAlpha = particle.alpha;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size, 0, TWO_PI);
          ctx.fill();
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = previousBlend;
  }
}
