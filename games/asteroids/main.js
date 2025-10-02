import { Controls } from '../../src/runtime/controls.js';
import { startSessionTimer, endSessionTimer } from '../../shared/metrics.js';
import { emitEvent } from '../../shared/achievements.js';
import { pushEvent } from '../common/diag-adapter.js';
import {
  connect as netConnect,
  disconnect as netDisconnect,
  sendShip,
  sendShot,
  sendRocks,
  sendStats,
  onShip,
  onShot,
  onRocks,
  onEnemy,
  onPlayers,
  players as netPlayers,
} from './net.js';

const SLUG = 'asteroids';
const TWO_PI = Math.PI * 2;
const BASE_WIDTH = 960;
const BASE_HEIGHT = 720;
const MAX_SPEED = 320;
const SHIP_RADIUS = 18;
const ASTEROID_SIZES = [0, 14, 26, 40]; // index by size tier (1-3)
const ASTEROID_SEGMENTS = 8;
const ASTEROID_SPEED = [0, 120, 90, 70];
const ASTEROID_SCORE = [0, 100, 50, 20];
const WAVE_ASTEROID_COUNT = [0, 4, 6, 8];
const FIRE_MODES = ['single', 'burst', 'rapid'];
const STORAGE_KEYS = {
  best: `${SLUG}:best`,
};

const globalScope = typeof window !== 'undefined' ? window : undefined;

function sanitizeForLog(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'function') {
    return `[Function${value.name ? ` ${value.name}` : ''}]`;
  }
  if (typeof value === 'bigint') {
    return `${value.toString()}n`;
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof DOMRect !== 'undefined' && value instanceof DOMRect) {
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  }
  if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) {
    const tag = value.tagName?.toLowerCase() || 'element';
    const id = value.id ? `#${value.id}` : '';
    const cls = value.className ? `.${String(value.className).replace(/\s+/g, '.')}` : '';
    return `<${tag}${id}${cls}>`;
  }
  if (depth >= 3) {
    return '[Truncated]';
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, 10).map((item) => sanitizeForLog(item, depth + 1, seen));
    }
    const output = {};
    const entries = Object.entries(value).slice(0, 20);
    for (const [key, val] of entries) {
      output[key] = sanitizeForLog(val, depth + 1, seen);
    }
    return output;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return String(value);
  }
}

function createBootTracker(slug) {
  if (!globalScope) {
    return {
      entry: { slug, milestones: [], raf: { frames: 0, samples: [] }, canvasWarnings: [], canvasSamples: [] },
      milestone() {},
      rafTick() {},
      rafActive() {},
      warnCanvas() {},
      recordCanvasSample() {},
      updateReadyState() {},
    };
  }

  const store = (globalScope.__bootStatus = globalScope.__bootStatus || {});
  const entry = (store[slug] = store[slug] || {
    slug,
    version: 1,
    milestones: [],
    raf: { frames: 0, samples: [], active: false },
    canvasWarnings: [],
    canvasSamples: [],
    bootAttempts: 0,
    bootSuccesses: 0,
  });
  if (typeof entry.bootAttempts !== 'number') entry.bootAttempts = 0;
  if (typeof entry.bootSuccesses !== 'number') entry.bootSuccesses = 0;

  const now = () => {
    try {
      if (globalScope.performance?.now) return Math.round(globalScope.performance.now());
    } catch (_) {
      /* ignore */
    }
    return Date.now();
  };

  const clamp = (list, max) => {
    if (list.length > max) list.splice(0, list.length - max);
  };

  const milestone = (name, details) => {
    const record = { name, at: now() };
    if (details) record.details = details;
    entry.milestones.push(record);
    clamp(entry.milestones, 120);
    pushEvent('boot', {
      level: 'info',
      message: `[${slug}] ${name}`,
      details: sanitizeForLog(record),
    });
    entry.lastUpdated = record.at;
  };

  const rafTick = (timestamp) => {
    const prev = typeof entry.raf.lastTimestamp === 'number' ? entry.raf.lastTimestamp : null;
    entry.raf.lastTimestamp = timestamp;
    entry.raf.lastDelta = prev === null ? null : timestamp - prev;
    entry.raf.frames = (entry.raf.frames || 0) + 1;
    const sample = { at: now(), timestamp, delta: entry.raf.lastDelta };
    entry.raf.samples.push(sample);
    clamp(entry.raf.samples, 60);
    if (entry.raf.frames <= 5) {
      pushEvent('raf', {
        level: 'debug',
        message: `[${slug}] frame ${entry.raf.frames}`,
        details: sanitizeForLog(sample),
      });
    }
    entry.lastUpdated = sample.at;
  };

  const rafActive = (active, reason) => {
    if (entry.raf.active === active) return;
    entry.raf.active = active;
    entry.raf.lastStateChange = now();
    entry.raf.lastStateReason = reason || null;
    pushEvent('raf', {
      level: active ? 'info' : 'warn',
      message: `[${slug}] raf ${active ? 'started' : 'stopped'}`,
      details: sanitizeForLog({ reason, at: entry.raf.lastStateChange }),
    });
    entry.lastUpdated = entry.raf.lastStateChange;
  };

  const warnCanvas = (reason, metrics) => {
    const record = { reason, at: now(), metrics };
    entry.canvasWarnings.push(record);
    clamp(entry.canvasWarnings, 30);
    pushEvent('boot', {
      level: 'warn',
      message: `[${slug}] canvas warning: ${reason}`,
      details: sanitizeForLog(record),
    });
    entry.lastUpdated = record.at;
  };

  const recordCanvasSample = (stage, metrics) => {
    const sample = { stage, at: now(), metrics };
    entry.canvasSamples.push(sample);
    clamp(entry.canvasSamples, 50);
    entry.lastCanvas = sample;
    entry.lastUpdated = sample.at;
    return sample;
  };

  const updateReadyState = (state) => {
    entry.readyState = state;
    entry.lastReadyStateAt = now();
  };

  return { entry, milestone, rafTick, rafActive, warnCanvas, recordCanvasSample, updateReadyState };
}

const bootTracker = createBootTracker(SLUG);
const {
  milestone: recordMilestone,
  rafTick: recordRafTick,
  rafActive: setRafActive,
  warnCanvas: recordCanvasWarning,
  recordCanvasSample,
  updateReadyState,
} = bootTracker;

function captureCanvasSnapshot(stage, canvas, extras = {}) {
  const readyState = typeof document !== 'undefined' ? document.readyState : undefined;
  if (!canvas || typeof canvas.getBoundingClientRect !== 'function') {
    recordCanvasWarning('missing-canvas', { stage, readyState, ...extras });
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const snapshot = {
    stage,
    width: rect.width,
    height: rect.height,
    devicePixelRatio: globalScope?.devicePixelRatio || 1,
    ...extras,
  };
  recordCanvasSample(stage, snapshot);
  if (!rect.width || !rect.height) {
    recordCanvasWarning('zero-area', { ...snapshot, readyState });
  }
  return snapshot;
}

if (typeof document !== 'undefined') {
  updateReadyState(document.readyState);
  recordMilestone('module:evaluated', { readyState: document.readyState });
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      updateReadyState(document.readyState);
      recordMilestone('document:domcontentloaded', { readyState: document.readyState });
      captureCanvasSnapshot('domcontentloaded', document.getElementById('game'));
    },
    { once: true }
  );
  document.addEventListener(
    'readystatechange',
    () => {
      updateReadyState(document.readyState);
      if (document.readyState === 'complete') {
        recordMilestone('document:complete', { readyState: document.readyState });
      }
    },
    { passive: true }
  );
  if (typeof window !== 'undefined') {
    window.addEventListener(
      'load',
      () => {
        updateReadyState(document.readyState);
        recordMilestone('window:load', { readyState: document.readyState });
        captureCanvasSnapshot('load', document.getElementById('game'));
      },
      { once: true }
    );
  }
}

let activeGame = null;
let bootInProgress = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrap(value, max) {
  if (value < -50) return max + value + 50;
  if (value > max + 50) return value - max - 50;
  if (value < 0) return value + max;
  if (value > max) return value - max;
  return value;
}

function angleTo(x1, y1, x2, y2) {
  return Math.atan2(y2 - y1, x2 - x1);
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

// Asteroid shapes are cached to keep silhouettes stable during rendering.
function makeAsteroidShape(radius) {
  const vertices = [];
  for (let i = 0; i < ASTEROID_SEGMENTS; i++) {
    const angle = (i / ASTEROID_SEGMENTS) * TWO_PI;
    const distance = radius * (0.75 + Math.random() * 0.25);
    vertices.push({
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
    });
  }
  return vertices;
}

function createAudio(src, volume = 0.6) {
  const audio = new Audio(src);
  audio.volume = volume;
  audio.preload = 'auto';
  return () => {
    try {
      const instance = audio.cloneNode(true);
      instance.volume = volume;
      instance.play().catch(() => {});
    } catch (err) {
      // ignore playback failures (likely due to user gesture requirements)
    }
  };
}

class AsteroidsGame {
  constructor(canvas, context = {}) {
    recordMilestone('game:constructor:start');
    captureCanvasSnapshot('constructor:before-init', canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('[asteroids] Canvas 2D context unavailable');

    this.context = context;
    this.controls = new Controls({
      map: {
        left: ['ArrowLeft', 'KeyA'],
        right: ['ArrowRight', 'KeyD'],
        up: ['ArrowUp', 'KeyW'],
        a: ['Space', 'Enter', 'KeyJ'],
        b: ['ShiftLeft', 'KeyK'],
        pause: ['KeyP', 'Escape'],
        restart: ['KeyR'],
      },
    });

    this.sounds = {
      shoot: createAudio('../../assets/audio/hit.wav', 0.35),
      explode: createAudio('../../assets/audio/explode.wav', 0.6),
      power: createAudio('../../assets/audio/powerup.wav', 0.5),
    };

    this.width = BASE_WIDTH;
    this.height = BASE_HEIGHT;
    this.dpr = 1;

    this.lastTime = performance.now();
    this.rafId = 0;
    this.paused = false;
    this.gameOver = false;
    this.started = false;
    this.postedReady = false;
    this.netSyncTimer = 0;

    this.ship = this.createShip();
    this.asteroids = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.particles = [];
    this.remoteShips = new Map();
    this.remoteShots = [];
    this.remoteEnemy = null;
    this.remoteRocks = [];

    this.wave = 1;
    this.weaponMode = 'single';
    this.fireCooldown = 0;
    this.waveTimer = 0;
    this.waveClearTimer = 0;

    this.score = 0;
    this.lastEmittedScore = -1;
    this.lastAchievementScore = -1;
    this.lives = 3;
    this.bestScore = this.restoreBestScore();

    this.sessionActive = false;

    this.starfield = this.createStars(120);

    this.events = {
      onVisibility: () => this.handleVisibilityChange(),
      onShellPause: () => this.pause(true),
      onShellResume: () => this.resume(true),
      onShellMessage: (event) => this.handleShellMessage(event),
    };

    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);

    this.controls.on('pause', () => this.togglePause());
    this.controls.on('restart', () => this.restart());
    this.controls.on('b', () => this.hyperspace());

    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.events.onVisibility);
    window.addEventListener('ggshell:pause', this.events.onShellPause);
    window.addEventListener('ggshell:resume', this.events.onShellResume);
    window.addEventListener('message', this.events.onShellMessage, { passive: true });

    this.hud = this.buildHud();
    this.updateLivesDisplay();

    this.resize();
    this.spawnWave();
    this.applyWavePowerups();

    this.setupNet();

    this.startSession();
    emitEvent({ type: 'play', slug: SLUG });
    this.paused = true;
    this.showOverlay('Asteroids', 'Rotate with ←/→, thrust with ↑, fire with Space/Enter. Press start to begin!', false);
    if (globalScope) {
      const api = {
        start: this.start.bind(this),
        pause: this.pause.bind(this),
        resume: this.resume.bind(this),
        restart: this.restart.bind(this),
        getScore: this.getScore.bind(this),
        getBestScore: this.getBestScore.bind(this),
        getShipState: () => this.getShipState(),
        getRockState: () => this.getRockState(),
        isPaused: () => this.isPaused(),
        isGameOver: () => this.isGameOver(),
        getWave: () => this.getWave(),
      };
      Object.defineProperty(api, '__instance', { value: this, enumerable: false });
      globalScope.Asteroids = api;
    }
    recordMilestone('game:constructor:ready');
    captureCanvasSnapshot('constructor:after-init', canvas, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    });
    this.start();
  }

  buildHud() {
    if (!document.getElementById('asteroids-hud-style')) {
      const style = document.createElement('style');
      style.id = 'asteroids-hud-style';
      style.textContent = `
        .asteroids-hud{position:absolute;top:16px;left:16px;z-index:10;color:var(--fg,#eaeaf2);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}
        .asteroids-hud__row{display:flex;gap:12px;align-items:center;margin-bottom:6px;}
        .asteroids-hud__label{opacity:0.7;text-transform:uppercase;font-size:12px;letter-spacing:0.1em;}
        .asteroids-hud__value{font-size:20px;font-weight:600;min-width:60px;}
        .asteroids-hud__lives{display:flex;gap:6px;}
        .asteroids-hud__life{width:18px;height:18px;border:2px solid currentColor;transform:rotate(45deg);border-radius:4px;opacity:0.85;}
        .asteroids-overlay{position:absolute;inset:0;background:rgba(5,7,15,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--fg,#f8fafc);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;opacity:0;pointer-events:none;transition:opacity 0.25s;z-index:20;text-align:center;padding:24px;}
        .asteroids-overlay.is-active{opacity:1;pointer-events:auto;}
        .asteroids-overlay h1{font-size:42px;margin:0 0 12px;}
        .asteroids-overlay p{margin:6px 0;font-size:16px;max-width:480px;}
        .asteroids-overlay__actions{margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;justify-content:center;}
        .asteroids-overlay button{background:var(--accent,#6ee7b7);color:#021016;border:none;border-radius:999px;font-size:16px;font-weight:600;padding:10px 20px;cursor:pointer;}
        .asteroids-players{position:absolute;top:16px;right:16px;z-index:10;color:var(--muted,#9aa0a6);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:right;}
        .asteroids-players h2{margin:0 0 6px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--fg,#eaeaf2);}
        .asteroids-players ul{list-style:none;margin:0;padding:0;font-size:14px;}
        .asteroids-players li{margin-bottom:2px;}
      `;
      document.head.appendChild(style);
    }

    const hud = document.createElement('div');
    hud.className = 'asteroids-hud';
    hud.innerHTML = `
      <div class="asteroids-hud__row">
        <span class="asteroids-hud__label">Score</span>
        <span class="asteroids-hud__value" id="asteroids-score" data-game-score="0">0</span>
      </div>
      <div class="asteroids-hud__row">
        <span class="asteroids-hud__label">Best</span>
        <span class="asteroids-hud__value" id="asteroids-best">${this.bestScore}</span>
      </div>
      <div class="asteroids-hud__row">
        <span class="asteroids-hud__label">Wave</span>
        <span class="asteroids-hud__value" id="asteroids-wave">${this.wave}</span>
      </div>
      <div class="asteroids-hud__row">
        <span class="asteroids-hud__label">Mode</span>
        <span class="asteroids-hud__value" id="asteroids-mode">${this.weaponMode}</span>
      </div>
      <div class="asteroids-hud__row">
        <span class="asteroids-hud__label">Lives</span>
        <span class="asteroids-hud__lives" id="asteroids-lives"></span>
      </div>
    `;
    const surface = document.querySelector('.game-shell__surface') || document.body;
    surface.appendChild(hud);

    const overlay = document.createElement('div');
    overlay.className = 'asteroids-overlay';
    overlay.innerHTML = `
      <h1 id="asteroids-overlay-title">Asteroids</h1>
      <p id="asteroids-overlay-message">Rotate with ←/→, thrust with ↑, fire with Space/Enter. Survive the waves!</p>
      <div class="asteroids-overlay__actions">
        <button type="button" data-action="resume">Start</button>
        <button type="button" data-action="restart">Restart</button>
      </div>
    `;
    surface.appendChild(overlay);

    const players = document.createElement('div');
    players.className = 'asteroids-players';
    players.innerHTML = `
      <h2>Co-op</h2>
      <ul id="asteroids-players-list"></ul>
    `;
    surface.appendChild(players);

    overlay.querySelector('[data-action="resume"]').addEventListener('click', () => {
      if (this.gameOver) {
        this.restart();
      } else {
        this.resume();
      }
    });
    overlay.querySelector('[data-action="restart"]').addEventListener('click', () => this.restart());

    return {
      root: hud,
      overlay,
      players,
      score: hud.querySelector('#asteroids-score'),
      best: hud.querySelector('#asteroids-best'),
      wave: hud.querySelector('#asteroids-wave'),
      mode: hud.querySelector('#asteroids-mode'),
      lives: hud.querySelector('#asteroids-lives'),
      overlayTitle: overlay.querySelector('#asteroids-overlay-title'),
      overlayMessage: overlay.querySelector('#asteroids-overlay-message'),
      playersList: players.querySelector('#asteroids-players-list'),
    };
  }

  createStars(count) {
    const stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        r: Math.random() * 1.5 + 0.5,
        twinkle: Math.random() * TWO_PI,
        speed: 0.2 + Math.random() * 0.6,
      });
    }
    return stars;
  }

  createShip() {
    return {
      x: this.width / 2,
      y: this.height / 2,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      thrust: 260,
      turnSpeed: Math.PI * 2,
      radius: SHIP_RADIUS,
      alive: true,
      invulnerable: 2.5,
      respawnTimer: 0,
    };
  }

  restoreBestScore() {
    try {
      const stored = Number.parseInt(localStorage.getItem(STORAGE_KEYS.best) || '0', 10);
      return Number.isFinite(stored) ? stored : 0;
    } catch (err) {
      return 0;
    }
  }

  persistBestScore() {
    try {
      localStorage.setItem(STORAGE_KEYS.best, String(this.bestScore));
    } catch (err) {
      /* ignore storage failures */
    }
  }

  startSession() {
    if (this.sessionActive) return;
    startSessionTimer(SLUG);
    this.sessionActive = true;
  }

  endSession() {
    if (!this.sessionActive) return;
    endSessionTimer(SLUG);
    this.sessionActive = false;
  }

  setupNet() {
    try {
      netConnect();
      onShip((id, ship) => {
        this.remoteShips.set(id, { ...ship, lastSeen: performance.now() });
      });
      onShot((id, bullet) => {
        this.remoteShots.push({ id, life: bullet.life ?? 0.9, ...bullet });
      });
      onRocks((rocks) => {
        this.remoteEnemy = null;
        this.remoteRocks = Array.isArray(rocks) ? rocks : [];
      });
      onEnemy((enemy) => {
        this.remoteEnemy = enemy;
      });
      onPlayers((map) => {
        this.updatePlayersList(map);
      });
      this.updatePlayersList(netPlayers);
    } catch (err) {
      console.warn('[asteroids] network sync unavailable', err);
    }
  }

  updatePlayersList(map) {
    if (!this.hud?.playersList) return;
    const rows = Object.entries(map || {}).map(([id, stats]) => ({ id, ...stats }));
    rows.sort((a, b) => (b.score || 0) - (a.score || 0));
    const parts = rows.map((row) => `<li>${row.id.slice(0, 4)} • ${row.score ?? 0} pts • ${row.lives ?? 0} lives</li>`);
    this.hud.playersList.innerHTML = parts.join('');
    this.hud.players.style.display = rows.length ? '' : 'none';
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || BASE_WIDTH;
    this.height = rect.height || BASE_HEIGHT;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    captureCanvasSnapshot('resize', this.canvas, {
      rectWidth: rect.width,
      rectHeight: rect.height,
      computedWidth: this.width,
      computedHeight: this.height,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
    });
  }

  start() {
    this.started = true;
    this.lastTime = performance.now();
    if (!this.rafId) {
      recordMilestone('game:start');
      setRafActive(true, 'start');
      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  getScore() {
    return this.score;
  }

  getBestScore() {
    return this.bestScore;
  }

  getWave() {
    return this.wave;
  }

  isPaused() {
    return this.paused;
  }

  isGameOver() {
    return this.gameOver;
  }

  getShipState() {
    const ship = this.ship || {};
    return {
      alive: !!ship.alive,
      x: typeof ship.x === 'number' ? ship.x : null,
      y: typeof ship.y === 'number' ? ship.y : null,
      vx: typeof ship.vx === 'number' ? ship.vx : null,
      vy: typeof ship.vy === 'number' ? ship.vy : null,
      angle: typeof ship.angle === 'number' ? ship.angle : null,
      invulnerable: typeof ship.invulnerable === 'number' ? ship.invulnerable : 0,
      radius: typeof ship.radius === 'number' ? ship.radius : SHIP_RADIUS,
      lives: this.lives,
    };
  }

  getRockState() {
    if (!Array.isArray(this.asteroids)) return [];
    return this.asteroids.map((asteroid) => ({
      x: typeof asteroid.x === 'number' ? asteroid.x : null,
      y: typeof asteroid.y === 'number' ? asteroid.y : null,
      vx: typeof asteroid.vx === 'number' ? asteroid.vx : null,
      vy: typeof asteroid.vy === 'number' ? asteroid.vy : null,
      radius: typeof asteroid.radius === 'number' ? asteroid.radius : null,
      size: typeof asteroid.size === 'number' ? asteroid.size : null,
      spin: typeof asteroid.spin === 'number' ? asteroid.spin : null,
    }));
  }

  loop(now) {
    recordRafTick(now);
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.12);
    this.lastTime = now;

    if (!this.paused && !this.gameOver) {
      this.update(dt);
    }
    this.draw(dt);

    if (!this.postedReady) {
      this.postedReady = true;
      try {
        window.parent?.postMessage?.({ type: 'GAME_READY', slug: SLUG }, '*');
      } catch (err) {
        /* ignore */
      }
    }

    this.rafId = requestAnimationFrame(this.loop);
  }

  update(dt) {
    if (!this.ship.alive) {
      this.ship.respawnTimer -= dt;
      if (this.ship.respawnTimer <= 0) {
        this.respawnShip();
      }
      return;
    }

    this.waveTimer += dt;

    this.updateShip(dt);
    this.updateBullets(dt);
    this.updateAsteroids(dt);
    this.updateEnemyBullets(dt);
    this.updateParticles(dt);
    this.updateRemote(dt);

    if (!this.asteroids.length && !this.waveClearTimer) {
      this.waveClearTimer = 1.5;
      this.showOverlay('Wave Cleared', 'Prepare for the next onslaught. Press resume to continue!', true);
      this.paused = true;
      setTimeout(() => {
        if (!this.gameOver) {
          this.wave++;
          this.hud.wave.textContent = String(this.wave);
          this.applyWavePowerups();
          this.spawnWave();
          this.hideOverlay();
          this.paused = false;
        }
        this.waveClearTimer = 0;
      }, 900);
    }

    if (this.waveClearTimer) {
      this.waveClearTimer = Math.max(0, this.waveClearTimer - dt);
    }

    this.netSyncTimer += dt;
    if (this.netSyncTimer >= 0.12) {
      this.netSyncTimer = 0;
      try {
        sendShip({
          x: this.ship.x,
          y: this.ship.y,
          angle: this.ship.angle,
          vx: this.ship.vx,
          vy: this.ship.vy,
          lives: this.lives,
        });
        sendStats(this.score, this.lives);
      } catch (err) {
        /* ignore network errors */
      }
    }
  }

  updateShip(dt) {
    if (this.ship.invulnerable > 0) {
      this.ship.invulnerable = Math.max(0, this.ship.invulnerable - dt);
    }

    let turn = 0;
    if (this.controls.isDown('left')) turn -= 1;
    if (this.controls.isDown('right')) turn += 1;
    this.ship.angle += turn * this.ship.turnSpeed * dt;

    if (this.controls.isDown('up')) {
      const ax = Math.cos(this.ship.angle) * this.ship.thrust * dt;
      const ay = Math.sin(this.ship.angle) * this.ship.thrust * dt;
      this.ship.vx = clamp(this.ship.vx + ax, -MAX_SPEED, MAX_SPEED);
      this.ship.vy = clamp(this.ship.vy + ay, -MAX_SPEED, MAX_SPEED);
      this.spawnThrusterParticles();
    } else {
      this.ship.vx *= 1 - Math.min(1, dt * 0.6);
      this.ship.vy *= 1 - Math.min(1, dt * 0.6);
    }

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.controls.isDown('a') && this.fireCooldown <= 0) {
      this.fireWeapon();
    }

    this.ship.x += this.ship.vx * dt;
    this.ship.y += this.ship.vy * dt;
    this.ship.x = wrap(this.ship.x, this.width);
    this.ship.y = wrap(this.ship.y, this.height);
  }

  spawnThrusterParticles() {
    const angle = this.ship.angle + Math.PI;
    for (let i = 0; i < 2; i++) {
      this.particles.push({
        x: this.ship.x + Math.cos(angle) * 12,
        y: this.ship.y + Math.sin(angle) * 12,
        vx: Math.cos(angle + randomRange(-0.3, 0.3)) * randomRange(40, 80),
        vy: Math.sin(angle + randomRange(-0.3, 0.3)) * randomRange(40, 80),
        life: 0.25,
        color: 'rgba(110, 231, 183, 0.4)',
      });
    }
  }

  fireWeapon() {
    const baseAngle = this.ship.angle;
    const baseSpeed = 420;
    const muzzleX = this.ship.x + Math.cos(baseAngle) * (this.ship.radius + 4);
    const muzzleY = this.ship.y + Math.sin(baseAngle) * (this.ship.radius + 4);

    if (this.weaponMode === 'single') {
      this.spawnBullet(muzzleX, muzzleY, baseAngle, baseSpeed);
      this.fireCooldown = 0.32;
    } else if (this.weaponMode === 'burst') {
      const spread = 0.12;
      this.spawnBullet(muzzleX, muzzleY, baseAngle, baseSpeed);
      this.spawnBullet(muzzleX, muzzleY, baseAngle - spread, baseSpeed * 0.95);
      this.spawnBullet(muzzleX, muzzleY, baseAngle + spread, baseSpeed * 0.95);
      this.fireCooldown = 0.5;
    } else {
      this.spawnBullet(muzzleX, muzzleY, baseAngle, baseSpeed * 1.1);
      this.fireCooldown = 0.12;
    }

    this.sounds.shoot();
  }

  spawnBullet(x, y, angle, speed) {
    const vx = Math.cos(angle) * speed + this.ship.vx;
    const vy = Math.sin(angle) * speed + this.ship.vy;
    const bullet = { x, y, vx, vy, life: 0.9, r: 3 };
    this.bullets.push(bullet);
    try {
      sendShot({ x, y, vx, vy, life: bullet.life });
    } catch (err) {
      /* ignore */
    }
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      bullet.life -= dt;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.x = wrap(bullet.x, this.width);
      bullet.y = wrap(bullet.y, this.height);
      if (bullet.life <= 0) {
        this.bullets.splice(i, 1);
        continue;
      }

      for (let j = this.asteroids.length - 1; j >= 0; j--) {
        const asteroid = this.asteroids[j];
        const dx = asteroid.x - bullet.x;
        const dy = asteroid.y - bullet.y;
        if (dx * dx + dy * dy < asteroid.radius * asteroid.radius) {
          this.asteroids.splice(j, 1);
          this.bullets.splice(i, 1);
          this.destroyAsteroid(asteroid, bullet);
          break;
        }
      }
    }
  }

  updateEnemyBullets(dt) {
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const bullet = this.enemyBullets[i];
      bullet.life -= dt;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.life <= 0) {
        this.enemyBullets.splice(i, 1);
        continue;
      }
      bullet.x = wrap(bullet.x, this.width);
      bullet.y = wrap(bullet.y, this.height);
      if (this.ship.alive && this.ship.invulnerable <= 0) {
        const dx = bullet.x - this.ship.x;
        const dy = bullet.y - this.ship.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.ship.radius) {
          this.enemyBullets.splice(i, 1);
          this.hitShip();
        }
      }
    }
  }

  updateAsteroids(dt) {
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const asteroid = this.asteroids[i];
      asteroid.x += asteroid.vx * dt;
      asteroid.y += asteroid.vy * dt;
      asteroid.rotation += asteroid.spin * dt;
      asteroid.x = wrap(asteroid.x, this.width);
      asteroid.y = wrap(asteroid.y, this.height);

      if (this.ship.alive && this.ship.invulnerable <= 0) {
        const dx = asteroid.x - this.ship.x;
        const dy = asteroid.y - this.ship.y;
        const r = asteroid.radius + this.ship.radius * 0.75;
        if (dx * dx + dy * dy < r * r) {
          this.hitShip();
          this.asteroids.splice(i, 1);
          this.destroyAsteroid(asteroid);
        }
      }
    }
  }

  destroyAsteroid(asteroid, source) {
    this.spawnExplosion(asteroid.x, asteroid.y, asteroid.radius);
    const nextSize = asteroid.size - 1;
    if (nextSize >= 1) {
      for (let n = 0; n < 2; n++) {
        const angle = randomRange(0, TWO_PI);
        const speed = ASTEROID_SPEED[nextSize] * randomRange(0.7, 1.2);
        const radius = ASTEROID_SIZES[nextSize];
        this.asteroids.push({
          x: asteroid.x,
          y: asteroid.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: nextSize,
          radius,
          shape: makeAsteroidShape(radius),
          rotation: randomRange(0, TWO_PI),
          spin: randomRange(-1, 1),
        });
      }
    }

    this.addScore(ASTEROID_SCORE[asteroid.size]);
    this.sounds.explode();

    if (source && source.enemy) {
      this.addScore(50);
    }

    try {
      sendRocks(this.asteroids.map((rock) => ({
        x: rock.x,
        y: rock.y,
        vx: rock.vx,
        vy: rock.vy,
        size: rock.size,
      })));
    } catch (err) {
      /* ignore */
    }
  }

  spawnExplosion(x, y, radius) {
    const count = 12 + Math.floor(radius * 0.6);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * TWO_PI;
      const speed = randomRange(40, 180);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.6,
        color: 'rgba(249, 115, 22, 0.7)',
      });
    }
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 0.8;
      p.vy *= 1 - dt * 0.8;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  updateRemote(dt) {
    const now = performance.now();
    for (const [id, ship] of this.remoteShips.entries()) {
      if (now - ship.lastSeen > 2000) this.remoteShips.delete(id);
    }

    for (let i = this.remoteShots.length - 1; i >= 0; i--) {
      const bullet = this.remoteShots[i];
      bullet.life -= dt;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.life <= 0) {
        this.remoteShots.splice(i, 1);
      }
    }
  }

  spawnWave() {
    const count = WAVE_ASTEROID_COUNT[Math.min(3, Math.ceil(this.wave / 2))] + Math.max(0, this.wave - 3);
    const rocks = [];
    for (let i = 0; i < count; i++) {
      const edge = Math.floor(Math.random() * 4);
      const size = 3;
      let x = 0;
      let y = 0;
      if (edge === 0) { x = Math.random() * this.width; y = -60; }
      if (edge === 1) { x = this.width + 60; y = Math.random() * this.height; }
      if (edge === 2) { x = Math.random() * this.width; y = this.height + 60; }
      if (edge === 3) { x = -60; y = Math.random() * this.height; }
      const angle = angleTo(x, y, this.width / 2, this.height / 2) + randomRange(-0.5, 0.5);
      const speed = ASTEROID_SPEED[size] * randomRange(0.6, 1.1);
      const radius = ASTEROID_SIZES[size];
      rocks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size,
        radius,
        shape: makeAsteroidShape(radius),
        rotation: randomRange(0, TWO_PI),
        spin: randomRange(-0.5, 0.5),
      });
    }
    this.asteroids = rocks;
    try {
      sendRocks(rocks.map((rock) => ({ x: rock.x, y: rock.y, vx: rock.vx, vy: rock.vy, size: rock.size })));
    } catch (err) {
      /* ignore */
    }
  }

  applyWavePowerups() {
    const prevMode = this.weaponMode;
    if (this.wave >= 7) this.weaponMode = 'rapid';
    else if (this.wave >= 4) this.weaponMode = 'burst';
    else this.weaponMode = 'single';
    this.hud.mode.textContent = this.weaponMode;
    if (prevMode !== this.weaponMode) {
      this.sounds.power();
      this.showOverlay('Weapon Upgrade', `Your ship unlocked ${this.weaponMode.toUpperCase()} fire!`, true);
      setTimeout(() => this.hideOverlay(), 1400);
    }
  }

  draw(dt) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
    for (const star of this.starfield) {
      star.twinkle += dt * star.speed;
      const alpha = 0.3 + Math.sin(star.twinkle) * 0.2;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(star.x * this.width, star.y * this.height, star.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const particle of this.particles) {
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = Math.max(0, particle.life / 0.6);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, 2.2, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#6ee7b7';
    ctx.lineWidth = 2;
    for (const bullet of this.bullets) {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.r, 0, TWO_PI);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(248, 113, 113, 0.9)';
    for (const bullet of this.enemyBullets) {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 3, 0, TWO_PI);
      ctx.stroke();
    }

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    for (const asteroid of this.asteroids) {
      this.drawAsteroid(asteroid);
    }

    for (const ship of this.remoteShips.values()) {
      this.drawShipModel(ship.x, ship.y, ship.angle ?? -Math.PI / 2, 'rgba(94, 234, 212, 0.6)', 0.8);
    }

    for (const bullet of this.remoteShots) {
      ctx.strokeStyle = 'rgba(94, 234, 212, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 2.5, 0, TWO_PI);
      ctx.stroke();
    }

    if (this.ship.alive) {
      const blink = this.ship.invulnerable > 0 && Math.floor(this.ship.invulnerable * 10) % 2 === 0;
      if (!blink) {
        this.drawShipModel(this.ship.x, this.ship.y, this.ship.angle, '#6ee7b7');
      }
    }

    ctx.restore();
  }

  drawShipModel(x, y, angle, color, scale = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-14, -10);
    ctx.lineTo(-8, 0);
    ctx.lineTo(-14, 10);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  drawAsteroid(asteroid) {
    const ctx = this.ctx;
    const shape = asteroid.shape || (asteroid.shape = makeAsteroidShape(asteroid.radius));
    ctx.save();
    ctx.translate(asteroid.x, asteroid.y);
    ctx.rotate(asteroid.rotation);
    ctx.beginPath();
    if (shape.length) {
      ctx.moveTo(shape[0].x, shape[0].y);
      for (let i = 1; i < shape.length; i++) {
        const point = shape[i];
        ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }

  updateScoreDisplay() {
    if (this.hud?.score) {
      this.hud.score.textContent = String(this.score);
      this.hud.score.dataset.gameScore = String(this.score);
    }
    if (this.hud?.best) {
      this.hud.best.textContent = String(this.bestScore);
    }
    if (this.lastEmittedScore !== this.score) {
      this.lastEmittedScore = this.score;
      try {
        window.parent?.postMessage?.({ type: 'GAME_SCORE', slug: SLUG, score: this.score }, '*');
      } catch (err) {
        /* ignore */
      }
    }
    if (this.score > this.lastAchievementScore) {
      this.lastAchievementScore = this.score;
      emitEvent({ type: 'score', slug: SLUG, value: this.score });
    }
  }

  addScore(value) {
    this.score += value;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.persistBestScore();
    }
    this.updateScoreDisplay();
  }

  updateLivesDisplay() {
    if (!this.hud?.lives) return;
    this.hud.lives.innerHTML = '';
    for (let i = 0; i < this.lives; i++) {
      const life = document.createElement('span');
      life.className = 'asteroids-hud__life';
      this.hud.lives.appendChild(life);
    }
  }

  hitShip() {
    if (!this.ship.alive) return;
    this.spawnExplosion(this.ship.x, this.ship.y, this.ship.radius * 1.5);
    this.sounds.explode();
    this.ship.alive = false;
    this.ship.respawnTimer = 1.8;
    this.lives--;
    this.updateLivesDisplay();
    if (this.lives <= 0) {
      this.gameOver = true;
      this.endSession();
      this.showOverlay('Game Over', `Final score: ${this.score}. Press restart to try again.`, true);
    }
  }

  respawnShip() {
    if (this.lives <= 0) return;
    this.ship = this.createShip();
    this.ship.invulnerable = 2.5;
  }

  hyperspace() {
    if (!this.ship.alive || this.ship.invulnerable > 0) return;
    this.ship.x = Math.random() * this.width;
    this.ship.y = Math.random() * this.height;
    this.ship.vx *= 0.25;
    this.ship.vy *= 0.25;
    this.ship.invulnerable = 1.2;
  }

  togglePause() {
    if (this.gameOver) return;
    if (this.paused) this.resume(); else this.pause();
  }

  pause(fromShell = false) {
    if (this.paused) return;
    this.paused = true;
    if (!fromShell) {
      try { window.parent?.postMessage?.({ type: 'GAME_PAUSE', slug: SLUG }, '*'); } catch (err) { /* ignore */ }
    }
    this.showOverlay('Paused', 'Press resume or P to continue.', false);
  }

  resume(fromShell = false) {
    if (!this.paused && !this.gameOver) {
      this.hideOverlay();
      return;
    }
    if (this.gameOver) return;
    this.paused = false;
    this.hideOverlay();
    if (!fromShell) {
      try { window.parent?.postMessage?.({ type: 'GAME_RESUME', slug: SLUG }, '*'); } catch (err) { /* ignore */ }
    }
  }

  restart() {
    this.gameOver = false;
    this.score = 0;
    this.wave = 1;
    this.weaponMode = 'single';
    this.lives = 3;
    this.ship = this.createShip();
    this.asteroids = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.particles = [];
    this.waveTimer = 0;
    this.fireCooldown = 0;
    this.paused = false;
    this.hideOverlay();
    this.updateScoreDisplay();
    this.hud.wave.textContent = String(this.wave);
    this.hud.mode.textContent = this.weaponMode;
    this.updateLivesDisplay();
    this.applyWavePowerups();
    this.spawnWave();
    this.startSession();
  }

  showOverlay(title, message, once = false) {
    if (!this.hud?.overlay) return;
    this.hud.overlayTitle.textContent = title;
    this.hud.overlayMessage.textContent = message;
    this.hud.overlay.classList.add('is-active');
    if (once) {
      clearTimeout(this.overlayTimeout);
      this.overlayTimeout = setTimeout(() => this.hideOverlay(), 2000);
    }
  }

  hideOverlay() {
    if (!this.hud?.overlay) return;
    this.hud.overlay.classList.remove('is-active');
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.pause(true);
    }
  }

  handleShellMessage(event) {
    const data = event && typeof event.data === 'object' ? event.data : null;
    if (!data) return;
    if (data.type === 'GAME_PAUSE' || data.type === 'GG_PAUSE') this.pause(true);
    if (data.type === 'GAME_RESUME' || data.type === 'GG_RESUME') this.resume(true);
    if (data.type === 'GG_RESTART') this.restart();
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    setRafActive(false, 'destroy');
    recordMilestone('game:destroyed');
    if (activeGame === this) {
      activeGame = null;
    }
    if (globalScope?.Asteroids?.__instance === this) {
      globalScope.Asteroids = null;
    }
    this.controls?.dispose?.();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.events.onVisibility);
    window.removeEventListener('ggshell:pause', this.events.onShellPause);
    window.removeEventListener('ggshell:resume', this.events.onShellResume);
    window.removeEventListener('message', this.events.onShellMessage);
    this.hud?.root?.remove();
    this.hud?.overlay?.remove();
    this.hud?.players?.remove();
    this.endSession();
    try { netDisconnect(); } catch (err) { /* ignore */ }
  }
}

export function boot(context = {}) {
  const readyState = typeof document !== 'undefined' ? document.readyState : 'unknown';
  recordMilestone('boot:requested', { readyState });
  bootTracker.entry.bootAttempts = (bootTracker.entry.bootAttempts || 0) + 1;
  bootTracker.entry.lastBootRequestedAt = Date.now();
  bootTracker.entry.lastBootContext = sanitizeForLog(context);

  if (activeGame) {
    recordMilestone('boot:skipped', { reason: 'existing-instance' });
    return activeGame;
  }
  if (bootInProgress) {
    recordMilestone('boot:skipped', { reason: 'boot-in-progress' });
    return activeGame;
  }

  bootInProgress = true;
  let canvas = null;
  if (typeof document !== 'undefined') {
    canvas = document.getElementById('game');
  }
  if (!(canvas instanceof HTMLCanvasElement)) {
    recordMilestone('boot:error', { reason: 'missing-canvas', readyState });
    recordCanvasWarning('missing-canvas', { stage: 'boot', selector: '#game', readyState });
    pushEvent('boot', {
      level: 'error',
      message: '[asteroids] missing #game canvas',
      details: { readyState },
    });
    bootInProgress = false;
    console.error('[asteroids] missing #game canvas');
    return undefined;
  }

  captureCanvasSnapshot('boot:before-instance', canvas, { readyState });

  let game;
  try {
    game = new AsteroidsGame(canvas, context);
  } catch (error) {
    const details = sanitizeForLog(error);
    recordMilestone('boot:exception', { error: details });
    pushEvent('boot', {
      level: 'error',
      message: '[asteroids] boot threw',
      details,
    });
    bootInProgress = false;
    throw error;
  }

  activeGame = game;
  bootTracker.entry.bootSuccesses = (bootTracker.entry.bootSuccesses || 0) + 1;
  bootTracker.entry.lastBootSuccessAt = Date.now();
  recordMilestone('boot:game-created');
  captureCanvasSnapshot('boot:after-instance', canvas, {
    readyState: typeof document !== 'undefined' ? document.readyState : readyState,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  });

  try {
    game.updateLivesDisplay();
  } catch (error) {
    pushEvent('boot', {
      level: 'warn',
      message: '[asteroids] updateLivesDisplay failed during boot',
      details: sanitizeForLog(error),
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => game.destroy(), { once: true });
  }

  recordMilestone('boot:completed');
  bootInProgress = false;
  return game;
}

function invokeBootSafely(context) {
  try {
    boot(context);
  } catch (error) {
    pushEvent('boot', {
      level: 'error',
      message: '[asteroids] auto boot failed',
      details: sanitizeForLog(error),
    });
  }
}

function scheduleAutoBoot() {
  if (!globalScope || typeof document === 'undefined') {
    return;
  }
  const readyState = document.readyState;
  recordMilestone('autoboot:setup', { readyState });
  if (readyState === 'interactive' || readyState === 'complete') {
    recordMilestone('autoboot:invoke:queue', { readyState });
    Promise.resolve().then(() => {
      recordMilestone('autoboot:invoke', { readyState: document.readyState });
      invokeBootSafely();
    });
    return;
  }
  recordMilestone('autoboot:waiting', { readyState });
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      recordMilestone('autoboot:domcontentloaded', { readyState: document.readyState });
      invokeBootSafely();
    },
    { once: true }
  );
}

if (globalScope && !globalScope.__asteroidsAutoBootScheduled) {
  globalScope.__asteroidsAutoBootScheduled = true;
  scheduleAutoBoot();
}
