import { VfxController } from './vfx.js';

const TWO_PI = Math.PI * 2;
const MAX_TIME_STEP = 1 / 30; // clamp delta to keep physics consistent
const BULLET_RADIUS = 3;
const PLAYER_RADIUS = 18;
const EDGE_SPAWN_PADDING = 32;
const LOOP_DIFFICULTY_SCALE = 0.22;

const THEMES = {
  default: {
    id: 'default',
    label: 'Standard',
    backgroundTop: '#111522',
    backgroundBottom: '#05070f',
    grid: 'rgba(255,255,255,0.04)',
    playerHull: '#3e6dd8',
    playerTrim: '#1b2750',
    playerCore: '#8fb9ff',
    playerHitFlash: 'rgba(255, 237, 160, 0.85)',
    bullet: '#f7f3d0',
    pointerRing: 'rgba(230, 240, 255, 0.65)',
    pointerCore: '#e6f0ff',
    enemyColors: {
      scout: '#ff6b6b',
      striker: '#ff924c',
      gunner: '#f2d45c',
    },
    enemyCore: 'rgba(20, 26, 46, 0.9)',
    enemyBullet: '#ff8f8f',
    hitFlash: '#fff5c0',
    statusAccent: '#8fb9ff',
  },
  colorblind: {
    id: 'colorblind',
    label: 'High Contrast',
    backgroundTop: '#0f172a',
    backgroundBottom: '#020617',
    grid: 'rgba(148, 197, 255, 0.18)',
    playerHull: '#0ea5e9',
    playerTrim: '#0b2a47',
    playerCore: '#a5f3fc',
    playerHitFlash: 'rgba(255, 255, 188, 0.9)',
    bullet: '#fef08a',
    pointerRing: 'rgba(249, 250, 229, 0.7)',
    pointerCore: '#fefce8',
    enemyColors: {
      scout: '#f97316',
      striker: '#facc15',
      gunner: '#22c55e',
    },
    enemyCore: 'rgba(4, 21, 37, 0.92)',
    enemyBullet: '#fb7185',
    hitFlash: '#fff7b5',
    statusAccent: '#5eead4',
  },
};

const ENEMY_TYPES = {
  scout: {
    radius: 16,
    speed: 58,
    turnRate: 4.2,
    hp: 2,
    damage: 1,
    wobble: { magnitude: 22, frequency: 1.6 },
    score: 80,
  },
  striker: {
    radius: 18,
    speed: 82,
    turnRate: 5,
    hp: 3,
    damage: 1,
    wobble: { magnitude: 36, frequency: 0.9 },
    score: 120,
  },
  gunner: {
    radius: 20,
    speed: 42,
    turnRate: 2.4,
    hp: 4,
    damage: 1,
    score: 160,
    fireInterval: 2.8,
    bulletSpeed: 240,
  },
};

const WAVE_PLAN = [
  {
    name: 'Scout Sweep',
    duration: 22,
    spawns: [
      { type: 'scout', interval: 2.6, start: 1.2, count: 1 },
      { type: 'scout', interval: 6, start: 9, count: 2 },
    ],
  },
  {
    name: 'Crossfire',
    duration: 28,
    spawns: [
      { type: 'scout', interval: 2.4, start: 0.9, count: 1 },
      { type: 'striker', interval: 5.4, start: 6, count: 1 },
      { type: 'striker', interval: 8.2, start: 14, count: 2 },
    ],
  },
  {
    name: 'Artillery Line',
    duration: 32,
    spawns: [
      { type: 'scout', interval: 2.8, start: 0.8, count: 1 },
      { type: 'gunner', interval: 7.4, start: 5.2, count: 1 },
      { type: 'striker', interval: 9.6, start: 16, count: 2 },
    ],
  },
];

const ACHIEVEMENTS = [
  {
    id: 'first-clear',
    title: 'Wavebreaker',
    description: 'Clear your first wave.',
    condition: (wave) => wave.globalIndex === 0,
  },
  {
    id: 'flawless',
    title: 'Untouchable',
    description: 'Clear a wave without taking damage.',
    condition: (wave) => wave.hitsTaken === 0,
  },
  {
    id: 'loop',
    title: 'Escalation',
    description: 'Reach difficulty loop two.',
    condition: (wave) => wave.loop >= 1 && wave.waveIndex === 0,
  },
];

const ACHIEVEMENT_MAP = new Map(ACHIEVEMENTS.map((entry) => [entry.id, entry]));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatScore(value) {
  return value.toLocaleString('en-US');
}

class AlienShooterGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) {
      throw new Error('Canvas 2D context not supported');
    }

    this.width = canvas.width;
    this.height = canvas.height;
    this.dpr = window.devicePixelRatio || 1;
    this.lastTime = 0;

    this.player = {
      x: this.width / 2,
      y: this.height / 2,
      speed: 320,
      health: 3,
      maxHealth: 3,
      hitTimer: 0,
    };

    this.keys = new Set();
    this.pointer = {
      x: this.width / 2,
      y: this.height / 2,
      active: false,
      shooting: false,
    };

    this.bullets = [];
    this.enemyBullets = [];
    this.bulletCooldown = 0;
    this.dustTimer = 0;
    this.bombCooldown = 0;
    this.fx = null;
    this.ready = false;

    this.enemies = [];
    this.wave = null;
    this.waveIndex = -1;
    this.loop = 0;
    this.elapsed = 0;

    this.score = 0;
    this.statusMessage = '';
    this.achievements = new Set();

    this.hud = {
      score: document.getElementById('hud-score'),
      wave: document.getElementById('hud-wave'),
      health: document.getElementById('hud-health'),
      pulse: document.getElementById('hud-pulse'),
      status: document.getElementById('hud-status'),
      achievementFeed: document.getElementById('achievement-feed'),
      pauseOverlay: document.getElementById('pause-overlay'),
      pauseTitle: document.getElementById('pause-title'),
      pauseDetails: document.getElementById('pause-details'),
      pauseButton: document.getElementById('pause-btn'),
      themeToggle: document.getElementById('theme-toggle'),
    };

    this.theme = 'default';
    this.palette = THEMES[this.theme];

    this.manualPause = false;
    this.pauseReasons = new Set();
    this.paused = false;

    this.hudDirty = true;

    this.pendingReset = 0;
    this.runActive = true;

    this.boundLoop = (time) => this.loopFrame(time);
  }
  async init() {
    this.fx = await VfxController.create('/assets/alien-shooter/fx.json');
    this.resize();
    this.ready = true;

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.onKeyUp(event));
    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    window.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer.active = false;
      this.pointer.shooting = false;
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.autoPause('hidden', 'Tab inactive');
      } else {
        this.autoResume('hidden');
      }
    });
    window.addEventListener('blur', () => this.autoPause('blur', 'Focus lost'));
    window.addEventListener('focus', () => this.autoResume('blur'));

    this.hud.pauseButton?.addEventListener('click', () => {
      this.setManualPause(!this.manualPause);
    });
    this.hud.themeToggle?.addEventListener('click', () => {
      const next = this.theme === 'default' ? 'colorblind' : 'default';
      this.setTheme(next);
    });

    this.setTheme(this.theme);
    this.resetRun(true);

    requestAnimationFrame(this.boundLoop);
  }

  setTheme(name) {
    if (!THEMES[name]) return;
    this.theme = name;
    this.palette = THEMES[name];
    document.body.dataset.colorblind = name === 'colorblind' ? 'true' : 'false';
    if (this.hud.themeToggle) {
      this.hud.themeToggle.textContent = name === 'colorblind' ? 'Color blind: On' : 'Color blind: Off';
    }
    this.hudDirty = true;
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

  autoPause(reason, message) {
    this.pauseReasons.add(reason);
    this.updatePauseState(message);
  }

  autoResume(reason) {
    if (this.pauseReasons.delete(reason)) {
      this.updatePauseState();
    }
  }

  setManualPause(flag) {
    this.manualPause = flag;
    this.updatePauseState();
  }

  updatePauseState(message) {
    const shouldPause = this.manualPause || this.pauseReasons.size > 0;
    if (shouldPause !== this.paused) {
      this.paused = shouldPause;
      if (!shouldPause) {
        this.lastTime = 0;
      }
    }

    if (this.hud.pauseOverlay) {
      if (this.paused) {
        this.hud.pauseOverlay.removeAttribute('hidden');
      } else {
        this.hud.pauseOverlay.setAttribute('hidden', '');
      }
    }

    if (this.hud.pauseTitle) {
      this.hud.pauseTitle.textContent = this.manualPause ? 'Paused' : 'Hold on';
    }
    if (this.hud.pauseDetails) {
      if (this.manualPause) {
        this.hud.pauseDetails.textContent = 'Press Escape or the pause button to resume.';
      } else if (this.pauseReasons.size > 0) {
        this.hud.pauseDetails.textContent = message || 'Focus the window to continue.';
      } else {
        this.hud.pauseDetails.textContent = '';
      }
    }
    if (this.hud.pauseButton) {
      this.hud.pauseButton.textContent = this.manualPause ? 'Resume' : 'Pause';
    }
  }

  onKeyDown(event) {
    if (event.repeat) return;
    this.keys.add(event.code);
    if (event.code === 'Space' || event.code === 'KeyE') {
      event.preventDefault();
      this.usePulseBomb();
    }
    if (event.code === 'Escape') {
      event.preventDefault();
      this.setManualPause(!this.manualPause);
    }
  }

  onKeyUp(event) {
    this.keys.delete(event.code);
  }

  onPointerDown(event) {
    if (this.paused) {
      this.setManualPause(false);
      return;
    }
    this.pointer.shooting = true;
    this.pointer.active = true;
    this.updatePointer(event);
    this.canvas.setPointerCapture?.(event.pointerId);
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
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.pointer.x = clamp(x, 0, this.width);
    this.pointer.y = clamp(y, 0, this.height);
  }
  loopFrame(time) {
    if (!this.ready) return;
    if (!this.lastTime) {
      this.lastTime = time;
    }
    const deltaMs = time - this.lastTime;
    const delta = Math.min(MAX_TIME_STEP, deltaMs / 1000);
    this.lastTime = time;

    if (!this.paused) {
      this.update(delta);
    }
    this.render();

    requestAnimationFrame(this.boundLoop);
  }

  resetRun(initial = false) {
    this.enemies = [];
    this.enemyBullets = [];
    this.bullets = [];
    this.wave = null;
    this.waveIndex = -1;
    this.loop = 0;
    this.elapsed = 0;
    this.score = initial ? 0 : Math.floor(this.score * 0.5);
    this.player.health = this.player.maxHealth;
    this.player.hitTimer = 0;
    this.player.x = this.width / 2;
    this.player.y = this.height / 2;
    this.pendingReset = 0;
    this.runActive = true;
    this.announce(initial ? 'Pilot online. Hold the perimeter.' : 'Systems rebooted – stay sharp.');
    this.advanceWave();
    this.hudDirty = true;
  }

  usePulseBomb() {
    if (this.bombCooldown > 0 || this.paused) return;
    const x = this.pointer.x;
    const y = this.pointer.y;
    this.fx?.explosion(x, y, 1.6);
    this.fx?.triggerFlash(0.22, 0.32, '#ffe9a5');
    const radius = 120;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      if (dx * dx + dy * dy <= radius * radius) {
        this.damageEnemy(enemy, i, 3, true);
      }
    }
    this.bombCooldown = 8;
    this.hudDirty = true;
    this.announce('Pulse bomb deployed!');
  }

  advanceWave() {
    this.waveIndex += 1;
    const base = WAVE_PLAN[this.waveIndex % WAVE_PLAN.length];
    this.loop = Math.floor(this.waveIndex / WAVE_PLAN.length);
    const difficulty = 1 + this.loop * LOOP_DIFFICULTY_SCALE;
    this.wave = {
      config: base,
      timer: 0,
      spawnTimers: base.spawns.map((spawn) => spawn.start ?? 0),
      difficulty,
      globalIndex: this.waveIndex,
      loop: this.loop,
      waveIndex: this.waveIndex % WAVE_PLAN.length,
      hitsTaken: 0,
      cleared: false,
    };
    this.announce(`Wave ${this.waveIndex + 1}: ${base.name}`);
    this.hudDirty = true;
  }

  announce(message) {
    this.statusMessage = message;
    if (this.hud.status) {
      this.hud.status.textContent = message;
    }
  }

  update(delta) {
    this.elapsed += delta;
    this.updatePlayer(delta);
    this.updateBullets(delta);
    this.updateEnemyBullets(delta);
    this.updateWave(delta);
    this.fx?.update(delta);

    if (this.bombCooldown > 0) {
      this.bombCooldown = Math.max(0, this.bombCooldown - delta);
    }

    if (!this.runActive) {
      this.pendingReset -= delta;
      if (this.pendingReset <= 0) {
        this.resetRun();
      }
    }

    if (this.player.hitTimer > 0) {
      this.player.hitTimer = Math.max(0, this.player.hitTimer - delta);
    }

    if (this.wave) {
      this.wave.spawnTimers = this.wave.spawnTimers.map((timer) => timer - delta);
    }

    if (this.hudDirty) {
      this.flushHud();
    }
  }

  updatePlayer(dt) {
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
    this.player.x = clamp(this.player.x, PLAYER_RADIUS, this.width - PLAYER_RADIUS);
    this.player.y = clamp(this.player.y, PLAYER_RADIUS, this.height - PLAYER_RADIUS);

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

    if (this.pointer.shooting || this.keys.has('Space')) {
      this.bulletCooldown -= dt;
      if (this.bulletCooldown <= 0) {
        this.fireBullet(aimAngle);
        this.bulletCooldown = 0.16;
      }
    } else {
      this.bulletCooldown = Math.max(0, this.bulletCooldown - dt);
    }
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
      damage: 1,
    });
    this.fx?.muzzle(startX, startY, angle, 1);
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.bullets[i];
      bullet.life -= dt;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (this.resolveBulletCollision(bullet)) {
        this.bullets.splice(i, 1);
        continue;
      }
      const outOfBounds =
        bullet.x < -20 || bullet.x > this.width + 20 || bullet.y < -20 || bullet.y > this.height + 20;
      if (bullet.life <= 0 || outOfBounds) {
        this.bullets.splice(i, 1);
      }
    }
  }

  resolveBulletCollision(bullet) {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      const dx = enemy.x - bullet.x;
      const dy = enemy.y - bullet.y;
      const radius = (ENEMY_TYPES[enemy.type]?.radius || 16) + BULLET_RADIUS;
      if (dx * dx + dy * dy <= radius * radius) {
        this.damageEnemy(enemy, i, bullet.damage);
        this.fx?.burst('radialBurst', bullet.x, bullet.y, { scale: 0.9 });
        return true;
      }
    }
    return false;
  }

  damageEnemy(enemy, index, amount = 1, fromBomb = false) {
    enemy.hp -= amount;
    enemy.hitTimer = fromBomb ? 0.25 : 0.16;
    if (enemy.hp <= 0) {
      this.onEnemyDestroyed(enemy, index);
      return true;
    }
    return false;
  }

  onEnemyDestroyed(enemy, index) {
    this.enemies.splice(index, 1);
    this.fx?.explosion(enemy.x, enemy.y, 1);
    this.fx?.burst('radialBurst', enemy.x, enemy.y, { scale: 1.2 });
    const reward = Math.round((ENEMY_TYPES[enemy.type]?.score || 100) * (1 + this.loop * 0.2));
    this.score += reward;
    this.hudDirty = true;
  }

  updateEnemyBullets(dt) {
    for (let i = this.enemyBullets.length - 1; i >= 0; i -= 1) {
      const shot = this.enemyBullets[i];
      shot.life -= dt;
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      if (shot.life <= 0) {
        this.enemyBullets.splice(i, 1);
        continue;
      }
      if (shot.x < -30 || shot.x > this.width + 30 || shot.y < -30 || shot.y > this.height + 30) {
        this.enemyBullets.splice(i, 1);
        continue;
      }
      const dx = this.player.x - shot.x;
      const dy = this.player.y - shot.y;
      if (dx * dx + dy * dy <= (PLAYER_RADIUS - 2) * (PLAYER_RADIUS - 2)) {
        this.enemyBullets.splice(i, 1);
        this.damagePlayer(1);
      }
    }
  }

  updateWave(dt) {
    if (!this.wave) return;
    const { config } = this.wave;
    this.wave.timer += dt;

    if (this.wave.timer <= config.duration) {
      for (let i = 0; i < config.spawns.length; i += 1) {
        const spawn = config.spawns[i];
        if (this.wave.spawnTimers[i] <= 0 && this.wave.timer >= (spawn.start ?? 0)) {
          this.wave.spawnTimers[i] += spawn.interval;
          this.spawnEnemies(spawn.type, spawn.count || 1);
        }
      }
    }

    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      this.updateEnemy(enemy, dt, i);
    }

    const waveFinished = this.wave.timer >= config.duration && this.enemies.length === 0;
    if (waveFinished && !this.wave.cleared) {
      this.wave.cleared = true;
      this.onWaveCleared();
    }
  }

  updateEnemy(enemy, dt, index) {
    const type = ENEMY_TYPES[enemy.type];
    if (!type) return;
    const diff = this.wave?.difficulty ?? 1;

    enemy.spawnGrace = Math.max(0, enemy.spawnGrace - dt);
    enemy.hitTimer = Math.max(0, enemy.hitTimer - dt);

    const dx = this.player.x - enemy.x;
    const dy = this.player.y - enemy.y;
    const distance = Math.hypot(dx, dy) || 1;
    const targetVx = (dx / distance) * type.speed * diff;
    const targetVy = (dy / distance) * type.speed * diff;
    const turn = type.turnRate * dt;
    enemy.vx += (targetVx - enemy.vx) * clamp(turn, 0, 1);
    enemy.vy += (targetVy - enemy.vy) * clamp(turn, 0, 1);

    if (type.wobble) {
      enemy.wobbleTime += dt * type.wobble.frequency;
      const wobble = Math.sin(enemy.wobbleTime) * type.wobble.magnitude;
      enemy.vx += (-dy / distance) * wobble * dt * 0.6;
      enemy.vy += (dx / distance) * wobble * dt * 0.6;
    }

    enemy.x += enemy.vx * dt;
    enemy.y += enemy.vy * dt;

    const damageRadius = PLAYER_RADIUS + (type.radius - 2);
    if (enemy.spawnGrace <= 0) {
      const pdx = this.player.x - enemy.x;
      const pdy = this.player.y - enemy.y;
      if (pdx * pdx + pdy * pdy <= damageRadius * damageRadius) {
        this.damagePlayer(type.damage || 1);
        this.damageEnemy(enemy, index, type.hp);
        return;
      }
    }

    if (type.fireInterval) {
      enemy.shootTimer -= dt * diff;
      if (enemy.shootTimer <= 0 && distance < 520) {
        enemy.shootTimer = type.fireInterval / (0.8 + diff * 0.3);
        this.spawnEnemyShot(enemy, Math.atan2(dy, dx), type);
      }
    }
  }

  spawnEnemyShot(enemy, angle, type) {
    const speed = (type.bulletSpeed || 200) * (1 + this.loop * 0.05);
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    this.enemyBullets.push({
      x: enemy.x,
      y: enemy.y,
      vx,
      vy,
      life: 3,
    });
  }

  damagePlayer(amount) {
    if (!this.runActive) return;
    this.player.health = Math.max(0, this.player.health - amount);
    this.player.hitTimer = 0.35;
    if (this.wave) {
      this.wave.hitsTaken += 1;
    }
    this.fx?.triggerFlash(0.18, 0.28, '#ff8f8f');
    this.hudDirty = true;
    if (this.player.health <= 0) {
      this.onPlayerDefeated();
    }
  }

  onPlayerDefeated() {
    this.runActive = false;
    this.pendingReset = 2.5;
    this.pointer.shooting = false;
    this.keys.clear();
    this.announce('Hull breached! Rebooting systems...');
  }

  onWaveCleared() {
    const bonus = Math.round(260 * (1 + this.loop * 0.35));
    this.score += bonus;
    this.hudDirty = true;
    this.announce(`Wave ${this.wave.globalIndex + 1} cleared! +${bonus} pts`);
    const waveSnapshot = {
      globalIndex: this.wave.globalIndex,
      loop: this.wave.loop,
      waveIndex: this.wave.waveIndex,
      hitsTaken: this.wave.hitsTaken,
    };
    for (const entry of ACHIEVEMENTS) {
      this.unlockAchievement(entry.id, waveSnapshot);
    }
    this.advanceWave();
  }

  spawnEnemies(type, count) {
    for (let i = 0; i < count; i += 1) {
      this.enemies.push(this.createEnemy(type));
    }
  }

  createEnemy(type) {
    const base = ENEMY_TYPES[type] ?? ENEMY_TYPES.scout;
    const side = Math.floor(Math.random() * 4);
    let x;
    let y;
    switch (side) {
      case 0:
        x = -EDGE_SPAWN_PADDING;
        y = Math.random() * this.height;
        break;
      case 1:
        x = this.width + EDGE_SPAWN_PADDING;
        y = Math.random() * this.height;
        break;
      case 2:
        x = Math.random() * this.width;
        y = -EDGE_SPAWN_PADDING;
        break;
      default:
        x = Math.random() * this.width;
        y = this.height + EDGE_SPAWN_PADDING;
        break;
    }
    return {
      type,
      x,
      y,
      vx: 0,
      vy: 0,
      hp: Math.round(base.hp * (1 + this.loop * 0.2)),
      wobbleTime: Math.random() * TWO_PI,
      spawnGrace: 0.6,
      hitTimer: 0,
      shootTimer: base.fireInterval ? base.fireInterval * (0.4 + Math.random() * 0.4) : 0,
    };
  }

  unlockAchievement(id, context) {
    if (this.achievements.has(id)) return;
    const entry = ACHIEVEMENT_MAP.get(id);
    if (!entry) return;
    if (entry.condition && !entry.condition(context)) return;
    this.achievements.add(id);
    if (this.hud.achievementFeed) {
      const item = document.createElement('div');
      item.className = 'achievement-callout';
      item.innerHTML = `<strong>${entry.title}</strong><span>${entry.description}</span>`;
      this.hud.achievementFeed.appendChild(item);
      requestAnimationFrame(() => item.classList.add('visible'));
      setTimeout(() => {
        item.classList.remove('visible');
        setTimeout(() => item.remove(), 420);
      }, 4200);
    }
    this.fx?.triggerFlash(0.12, 0.24, '#9be4ff');
  }

  flushHud() {
    if (this.hud.score) {
      this.hud.score.textContent = `Score ${formatScore(this.score)}`;
    }
    if (this.hud.wave) {
      const waveNumber = (this.wave?.globalIndex ?? this.waveIndex) + 1;
      this.hud.wave.textContent = `Wave ${waveNumber}`;
    }
    if (this.hud.health) {
      const filled = '●'.repeat(this.player.health);
      const empty = '○'.repeat(Math.max(0, this.player.maxHealth - this.player.health));
      this.hud.health.textContent = `Shields ${filled}${empty}`;
    }
    if (this.hud.pulse) {
      if (this.bombCooldown <= 0) {
        this.hud.pulse.textContent = 'Pulse Ready';
        this.hud.pulse.classList.add('ready');
      } else {
        this.hud.pulse.textContent = `Pulse ${this.bombCooldown.toFixed(1)}s`;
        this.hud.pulse.classList.remove('ready');
      }
    }
    if (this.hud.status) {
      this.hud.status.textContent = this.statusMessage;
    }
    this.hudDirty = false;
  }
  render() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawBackground(ctx);
    this.drawEnemyBullets(ctx);
    this.drawEnemies(ctx);
    this.drawPlayer(ctx);
    this.drawBullets(ctx);
    this.drawPointer(ctx);
    this.fx?.draw(ctx, this.width, this.height);

    if (this.paused) {
      ctx.save();
      ctx.fillStyle = 'rgba(8, 12, 24, 0.36)';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }
  }

  drawBackground(ctx) {
    const palette = this.palette;
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, palette.backgroundTop);
    gradient.addColorStop(1, palette.backgroundBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = palette.grid;
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

    ctx.fillStyle = this.palette.playerHull;
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 14, 0, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = this.palette.playerTrim;
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

    ctx.fillStyle = this.palette.playerCore;
    ctx.fillRect(10, -3, 16, 6);

    if (this.player.hitTimer > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(this.player.hitTimer / 0.35, 0, 1) * 0.7;
      ctx.fillStyle = this.palette.playerHitFlash;
      ctx.beginPath();
      ctx.ellipse(0, 0, 24, 18, 0, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  drawEnemies(ctx) {
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      const type = ENEMY_TYPES[enemy.type];
      const radius = type?.radius ?? 16;
      const color = this.palette.enemyColors?.[enemy.type] ?? '#ff6b6b';
      ctx.save();
      ctx.translate(enemy.x, enemy.y);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TWO_PI);
      ctx.fill();

      ctx.fillStyle = this.palette.enemyCore;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.45, 0, TWO_PI);
      ctx.fill();

      if (enemy.hitTimer > 0) {
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = clamp(enemy.hitTimer / 0.16, 0, 1);
        ctx.fillStyle = this.palette.hitFlash;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.1, 0, TWO_PI);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  drawEnemyBullets(ctx) {
    ctx.fillStyle = this.palette.enemyBullet;
    for (let i = 0; i < this.enemyBullets.length; i += 1) {
      const bullet = this.enemyBullets[i];
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 4, 0, TWO_PI);
      ctx.fill();
    }
  }

  drawBullets(ctx) {
    ctx.fillStyle = this.palette.bullet;
    this.bullets.forEach((bullet) => {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, BULLET_RADIUS, 0, TWO_PI);
      ctx.fill();
    });
  }

  drawPointer(ctx) {
    if (!this.pointer.active) return;
    ctx.save();
    ctx.translate(this.pointer.x, this.pointer.y);
    ctx.strokeStyle = this.palette.pointerRing;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, TWO_PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(14, 0);
    ctx.moveTo(0, -14);
    ctx.lineTo(0, 14);
    ctx.stroke();
    ctx.fillStyle = this.palette.pointerCore;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, 3.6, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
}

async function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) {
    console.error('[alien-shooter] Missing #game canvas');
    return;
  }
  const game = new AlienShooterGame(canvas);
  try {
    await game.init();
  } catch (error) {
    console.error('[alien-shooter] Failed to start', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
