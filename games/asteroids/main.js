import { Controls } from '../../src/runtime/controls.js';
import { startSessionTimer, endSessionTimer } from '../../shared/metrics.js';
import { pushEvent } from '/games/common/diag-adapter.js';

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
const STAR_LAYER_CONFIG = [
  { density: 0.2, speed: 30, size: 2, color: '#e2e8f0' },
  { density: 0.1, speed: 12, size: 1.5, color: '#cbd5f5' },
  { density: 0.05, speed: 5, size: 1.1, color: '#94a3b8' },
];
const STAR_TWINKLE_SPEED = { min: 0.5, max: 1.2 };
const STORAGE_KEYS = {
  best: `${SLUG}:best`,
};

const globalScope = typeof window !== 'undefined' ? window : undefined;

let activeGame = null;
let bootInProgress = false;
let bootErrorUi = null;

function getActiveGame() {
  return activeGame;
}

function forwardGameCall(method) {
  return (...args) => {
    const game = getActiveGame();
    if (!game || typeof game[method] !== 'function') return undefined;
    try {
      return game[method](...args);
    } catch (error) {
      pushEvent('boot', {
        level: 'warn',
        message: `[${SLUG}] public api ${method} failed`,
        details: sanitizeForLog(error),
      });
      return undefined;
    }
  };
}

function readGameState(method, fallback = null) {
  const game = getActiveGame();
  if (!game || typeof game[method] !== 'function') return fallback;
  try {
    return game[method]();
  } catch (error) {
    pushEvent('diagnostics', {
      level: 'warn',
      message: `[${SLUG}] public api ${method} snapshot failed`,
      details: sanitizeForLog(error),
    });
    return fallback;
  }
}

function createAsteroidsPublicApi() {
  return {
    start: forwardGameCall('start'),
    pause: forwardGameCall('pause'),
    resume: forwardGameCall('resume'),
    restart: forwardGameCall('restart'),
    getScore: () => readGameState('getScore', null),
    getBestScore: () => readGameState('getBestScore', null),
    getShipState: () => readGameState('getShipState', null),
    getRockState: () => readGameState('getRockState', []),
    isPaused: () => readGameState('isPaused', null),
    isGameOver: () => readGameState('isGameOver', null),
    getWave: () => readGameState('getWave', null),
  };
}

const asteroidsPublicApi = createAsteroidsPublicApi();
Object.defineProperty(asteroidsPublicApi, '__instance', {
  get: getActiveGame,
  enumerable: false,
});

if (globalScope) {
  globalScope.Asteroids = asteroidsPublicApi;
}

function clearBootError() {
  if (bootErrorUi?.root?.parentNode) {
    bootErrorUi.root.remove();
  }
  bootErrorUi = null;
}

function renderBootError(message, details) {
  if (typeof document === 'undefined') {
    return;
  }

  const host = document.querySelector('.game-shell__surface') || document.body;
  if (!host) {
    return;
  }

  if (!bootErrorUi) {
    const overlay = document.createElement('div');
    overlay.className = 'asteroids-boot-error';
    overlay.setAttribute('role', 'presentation');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483646';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '24px';
    overlay.style.background = 'rgba(0, 0, 0, 0.6)';
    overlay.style.pointerEvents = 'none';

    const panel = document.createElement('div');
    panel.className = 'asteroids-boot-error__panel';
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    panel.style.pointerEvents = 'auto';
    panel.style.maxWidth = '420px';
    panel.style.width = '100%';
    panel.style.background = '#111';
    panel.style.color = '#fff';
    panel.style.borderRadius = '12px';
    panel.style.boxShadow = '0 20px 60px rgba(0, 0, 0, 0.45)';
    panel.style.padding = '24px';
    panel.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

    const title = document.createElement('h2');
    title.id = 'asteroids-boot-error-title';
    title.textContent = 'Unable to start Asteroids';
    title.style.margin = '0 0 12px';

    const messageEl = document.createElement('p');
    messageEl.id = 'asteroids-boot-error-message';
    messageEl.style.margin = '0 0 16px';

    const detailsEl = document.createElement('pre');
    detailsEl.id = 'asteroids-boot-error-details';
    detailsEl.style.margin = '0 0 16px';
    detailsEl.style.whiteSpace = 'pre-wrap';
    detailsEl.style.wordBreak = 'break-word';
    detailsEl.style.fontFamily = 'monospace';
    detailsEl.style.fontSize = '13px';

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.textContent = 'Try again';
    retryButton.style.background = '#fff';
    retryButton.style.color = '#111';
    retryButton.style.border = '0';
    retryButton.style.borderRadius = '999px';
    retryButton.style.padding = '10px 22px';
    retryButton.style.fontSize = '16px';
    retryButton.style.fontWeight = '600';
    retryButton.style.cursor = 'pointer';

    retryButton.addEventListener('click', (event) => {
      event.preventDefault();
      retryButton.disabled = true;
      setTimeout(() => {
        retryButton.disabled = false;
      }, 5000);
      clearBootError();
      invokeBootSafely();
    });

    panel.setAttribute('aria-labelledby', title.id);
    panel.setAttribute('aria-describedby', `${messageEl.id} ${detailsEl.id}`);

    panel.append(title, messageEl, detailsEl, retryButton);
    overlay.append(panel);
    host.append(overlay);

    bootErrorUi = { root: overlay, panel, messageEl, detailsEl, retryButton };
  }

  const resolvedMessage = typeof message === 'string' && message.trim() ? message : 'Something went wrong while starting the game.';
  bootErrorUi.messageEl.textContent = resolvedMessage;

  let detailText = '';
  if (details && typeof details === 'object') {
    try {
      detailText = JSON.stringify(details, null, 2);
    } catch (_) {
      detailText = String(details);
    }
  } else if (details) {
    detailText = String(details);
  }

  bootErrorUi.detailsEl.textContent = detailText;
  bootErrorUi.detailsEl.style.display = detailText ? 'block' : 'none';
  bootErrorUi.retryButton.disabled = false;

  if (!bootErrorUi.root.isConnected) {
    host.append(bootErrorUi.root);
  }

  try {
    bootErrorUi.retryButton.focus({ preventScroll: true });
  } catch (_) {
    /* noop */
  }
}

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

function resolveGameCanvas() {
  if (typeof document === 'undefined') return null;

  const modernCanvas = document.getElementById('game-canvas');
  if (modernCanvas instanceof HTMLCanvasElement) {
    return modernCanvas;
  }
  if (modernCanvas) {
    recordCanvasWarning('unexpected-element', {
      stage: 'resolve',
      selector: '#game-canvas',
      tagName: modernCanvas.tagName?.toLowerCase?.(),
    });
  }

  const legacyCanvas = document.getElementById('game');
  if (legacyCanvas instanceof HTMLCanvasElement) {
    return legacyCanvas;
  }
  if (legacyCanvas) {
    recordCanvasWarning('unexpected-element', {
      stage: 'resolve',
      selector: '#game',
      tagName: legacyCanvas.tagName?.toLowerCase?.(),
    });
  }

  return null;
}

if (typeof document !== 'undefined') {
  updateReadyState(document.readyState);
  recordMilestone('module:evaluated', { readyState: document.readyState });
  document.addEventListener(
      'DOMContentLoaded',
      () => {
        updateReadyState(document.readyState);
        recordMilestone('document:domcontentloaded', { readyState: document.readyState });
        captureCanvasSnapshot('domcontentloaded', resolveGameCanvas());
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
        captureCanvasSnapshot('load', resolveGameCanvas());
      },
      { once: true }
    );
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const COMPONENT_FLAGS = {
  position: 1 << 0,
  velocity: 1 << 1,
  rotation: 1 << 2,
  collider: 1 << 3,
  lifetime: 1 << 4,
  ship: 1 << 5,
  rock: 1 << 6,
  bullet: 1 << 7,
  particle: 1 << 8,
};

function createWorld(width, height) {
  return {
    width,
    height,
    nextId: 0,
    freeIds: [],
    alive: [],
    signatures: [],
    components: {
      position: [],
      velocity: [],
      rotation: [],
      collider: [],
      lifetime: [],
      ship: [],
      rock: [],
      bullet: [],
      particle: [],
    },
  };
}

function createEntity(world) {
  const id = world.freeIds.length ? world.freeIds.pop() : world.nextId++;
  world.alive[id] = true;
  world.signatures[id] = 0;
  return id;
}

function addComponent(world, name, entity, values) {
  const store = world.components[name];
  if (!store) return null;
  let component = store[entity];
  if (!component) {
    component = store[entity] = { ...values };
  } else {
    Object.assign(component, values);
  }
  const flag = COMPONENT_FLAGS[name];
  if (typeof flag === 'number') {
    world.signatures[entity] = (world.signatures[entity] || 0) | flag;
  }
  return component;
}

function getComponent(world, name, entity) {
  const store = world.components[name];
  return store ? store[entity] : undefined;
}

function destroyEntity(world, entity) {
  world.alive[entity] = false;
  world.signatures[entity] = 0;
  world.freeIds.push(entity);
}

function queryEntities(world, mask) {
  const result = [];
  const { signatures, alive } = world;
  for (let i = 0; i < signatures.length; i++) {
    if (!alive[i]) continue;
    if ((signatures[i] & mask) === mask) {
      result.push(i);
    }
  }
  return result;
}

function wrapValue(value, max) {
  if (max <= 0) return 0;
  return ((value % max) + max) % max;
}

function wrapVector(position, world) {
  position.x = wrapValue(position.x, world.width);
  position.y = wrapValue(position.y, world.height);
}

function distanceSquared(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

function physicsSystem(world, dt) {
  const entities = queryEntities(world, COMPONENT_FLAGS.position | COMPONENT_FLAGS.velocity);
  for (const entity of entities) {
    const position = getComponent(world, 'position', entity);
    const velocity = getComponent(world, 'velocity', entity);
    position.x += velocity.x * dt;
    position.y += velocity.y * dt;
    wrapVector(position, world);
  }
}

function lifetimeSystem(world, dt, onExpire) {
  const entities = queryEntities(world, COMPONENT_FLAGS.lifetime);
  for (const entity of entities) {
    const lifetime = getComponent(world, 'lifetime', entity);
    lifetime.remaining -= dt;
    if (lifetime.remaining <= 0) {
      const payload = lifetime.payload;
      if (typeof onExpire === 'function') {
        onExpire(entity, payload);
      }
      destroyEntity(world, entity);
    }
  }
}

const DEFAULT_WAVE_CONFIG = {
  waves: [
    { rocks: [ { size: 3, count: 2 } ] },
    { rocks: [ { size: 3, count: 3 } ] },
    { rocks: [ { size: 3, count: 3 }, { size: 2, count: 1 } ] },
    { rocks: [ { size: 3, count: 4 }, { size: 2, count: 1 } ] },
    { rocks: [ { size: 3, count: 4 }, { size: 2, count: 2 } ] },
    { rocks: [ { size: 3, count: 4 }, { size: 2, count: 2 }, { size: 1, count: 1 } ] },
    { rocks: [ { size: 3, count: 5 }, { size: 2, count: 2 }, { size: 1, count: 1 } ] },
    { rocks: [ { size: 3, count: 5 }, { size: 2, count: 3 }, { size: 1, count: 1 } ] },
    { rocks: [ { size: 3, count: 6 }, { size: 2, count: 3 }, { size: 1, count: 2 } ] },
    { rocks: [ { size: 3, count: 6 }, { size: 2, count: 4 }, { size: 1, count: 2 } ] },
  ],
  splits: {
    '3': [2, 2],
    '2': [1, 1],
    '1': [],
  },
};

async function loadWaveConfig() {
  if (typeof fetch !== 'function') {
    return DEFAULT_WAVE_CONFIG;
  }
  try {
    const response = await fetch(new URL('./waves.json', import.meta.url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return {
      waves: Array.isArray(data?.waves) ? data.waves : DEFAULT_WAVE_CONFIG.waves,
      splits: typeof data?.splits === 'object' ? data.splits : DEFAULT_WAVE_CONFIG.splits,
    };
  } catch (error) {
    pushEvent('diagnostics', {
      level: 'warn',
      message: '[asteroids] failed to load wave config, using defaults',
      details: sanitizeForLog(error),
    });
    return DEFAULT_WAVE_CONFIG;
  }
}

function resolveWaveConfig(config, wave) {
  if (!config?.waves?.length) return DEFAULT_WAVE_CONFIG.waves[0];
  const index = Math.min(config.waves.length - 1, Math.max(0, wave - 1));
  return config.waves[index];
}

function resolveSplitRules(config, size) {
  const table = config?.splits || DEFAULT_WAVE_CONFIG.splits;
  return Array.isArray(table?.[String(size)]) ? table[String(size)] : [];
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
        pause: ['KeyP', 'Escape'],
        restart: ['KeyR'],
      },
    });
    this.controls.on('pause', () => {
      if (this.gameOver) return;
      if (this.paused) this.resume();
      else this.pause();
    });
    this.controls.on('restart', () => this.restart());

    this.loop = this.loop.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.handleResize = this.handleResize.bind(this);

    this.width = BASE_WIDTH;
    this.height = BASE_HEIGHT;
    this.dpr = 1;

    this.world = createWorld(this.width, this.height);
    this.shipEntity = null;

    this.bulletCooldown = 0;
    this.thrustTimer = 0;
    this.postedReady = false;

    this.wave = 1;
    this.waveConfig = DEFAULT_WAVE_CONFIG;
    this.wavePromise = loadWaveConfig().then((config) => {
      this.waveConfig = config;
      if (!this.asteroidsRemaining()) {
        this.spawnWave();
      }
    });

    this.score = 0;
    this.bestScore = this.restoreBestScore();
    this.lives = 3;
    this.paused = true;
    this.gameOver = false;
    this.started = false;
    this.sessionActive = false;

    this.waveSpawnDelay = 0;

    this.starfieldTime = 0;
    this.starfield = [];

    this.sounds = {
      laser: createAudio('../../assets/audio/laser.wav', 0.45),
      explode: createAudio('../../assets/audio/explode.wav', 0.6),
    };

    this.hud = this.createHud();
    if (this.hud?.best) this.hud.best.textContent = String(this.bestScore);
    if (this.hud?.score) this.hud.score.textContent = '0';
    if (this.hud?.wave) this.hud.wave.textContent = String(this.wave);

    this.resizeCanvas();
    this.starfield = this.createStarLayers();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleResize);
      document.addEventListener('visibilitychange', this.handleVisibility);
    }

    this.shipEntity = this.spawnShip();
    this.updateLivesDisplay();
    this.showOverlay('Asteroids', 'Rotate with ←/→, thrust with ↑, fire with Space/Enter. Press Start to play.');

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);

    recordMilestone('game:constructor:end');
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.controls?.dispose?.();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleResize);
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
    this.endSession();
    this.hud?.root?.remove?.();
    this.hud?.overlay?.remove?.();
    this.hud?.players?.remove?.();
  }

  handleVisibility() {
    if (document.visibilityState === 'hidden') {
      this.pause();
    }
  }

  handleResize() {
    this.resizeCanvas();
    this.starfield = this.createStarLayers();
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.dpr = dpr;
    const width = rect.width || BASE_WIDTH;
    const height = rect.height || BASE_HEIGHT;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.width = width;
    this.height = height;
    this.world.width = this.width;
    this.world.height = this.height;
  }

  createHud() {
    if (typeof document === 'undefined') {
      return {
        root: null,
        overlay: { style: {}, classList: { add() {}, remove() {} } },
        players: null,
        score: { textContent: '0' },
        best: { textContent: '0' },
        wave: { textContent: '1' },
        lives: { innerHTML: '' },
        overlayTitle: { textContent: '' },
        overlayMessage: { textContent: '' },
      };
    }

    const surface = document.querySelector('.game-shell__surface') || document.body;

    const hud = document.createElement('div');
    hud.className = 'asteroids-hud';
    hud.innerHTML = `
      <div class="asteroids-hud__row">
        <span class="asteroids-hud__label">Score</span>
        <span class="asteroids-hud__value" id="asteroids-score">0</span>
      </div>
      <div class="asteroids-hud__row">
        <span class="asteroids-hud__label">Best</span>
        <span class="asteroids-hud__value" id="asteroids-best">0</span>
      </div>
      <div class="asteroids-hud__row">
        <span class="asteroids-hud__label">Wave</span>
        <span class="asteroids-hud__value" id="asteroids-wave">1</span>
      </div>
      <div class="asteroids-hud__row">
        <span class="asteroids-hud__label">Lives</span>
        <span class="asteroids-hud__lives" id="asteroids-lives"></span>
      </div>
    `;
    surface.appendChild(hud);

    const overlay = document.createElement('div');
    overlay.className = 'asteroids-overlay';
    overlay.innerHTML = `
      <h1 id="asteroids-overlay-title">Asteroids</h1>
      <p id="asteroids-overlay-message"></p>
      <div class="asteroids-overlay__actions">
        <button type="button" data-action="resume">Start</button>
        <button type="button" data-action="restart">Restart</button>
      </div>
    `;
    surface.appendChild(overlay);

    overlay.querySelector('[data-action="resume"]').addEventListener('click', () => {
      if (this.gameOver) this.restart();
      else this.start();
    });
    overlay.querySelector('[data-action="restart"]').addEventListener('click', () => this.restart());

    return {
      root: hud,
      overlay,
      players: null,
      score: hud.querySelector('#asteroids-score'),
      best: hud.querySelector('#asteroids-best'),
      wave: hud.querySelector('#asteroids-wave'),
      lives: hud.querySelector('#asteroids-lives'),
      overlayTitle: overlay.querySelector('#asteroids-overlay-title'),
      overlayMessage: overlay.querySelector('#asteroids-overlay-message'),
    };
  }

  createStarLayers() {
    const width = this.width || BASE_WIDTH;
    const height = this.height || BASE_HEIGHT;
    const areaFactor = (width * height) / 10000;
    return STAR_LAYER_CONFIG.map((config) => {
      const count = Math.max(1, Math.round(config.density * areaFactor));
      const stars = [];
      for (let i = 0; i < count; i++) {
        stars.push(this.createStar(width, height));
      }
      return {
        color: config.color,
        speed: config.speed,
        size: config.size,
        stars,
      };
    });
  }

  createStar(width, height) {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      phase: Math.random() * TWO_PI,
      twinkleSpeed: randomRange(STAR_TWINKLE_SPEED.min, STAR_TWINKLE_SPEED.max),
    };
  }

  recycleStar(star) {
    const width = this.width || BASE_WIDTH;
    const height = this.height || BASE_HEIGHT;
    star.x = width + Math.random() * width * 0.25;
    star.y = Math.random() * height;
    star.phase = Math.random() * TWO_PI;
    star.twinkleSpeed = randomRange(STAR_TWINKLE_SPEED.min, STAR_TWINKLE_SPEED.max);
  }

  spawnShip() {
    const entity = createEntity(this.world);
    addComponent(this.world, 'position', entity, { x: this.width / 2, y: this.height / 2 });
    addComponent(this.world, 'velocity', entity, { x: 0, y: 0 });
    addComponent(this.world, 'rotation', entity, { angle: -Math.PI / 2 });
    addComponent(this.world, 'collider', entity, { radius: SHIP_RADIUS });
    addComponent(this.world, 'ship', entity, {
      alive: true,
      thrust: 520,
      turnSpeed: 3.6,
      invulnerable: 2.4,
      respawn: 0,
    });
    return entity;
  }

  spawnWave() {
    const config = resolveWaveConfig(this.waveConfig, this.wave);
    const entries = Array.isArray(config?.rocks) ? config.rocks : [];
    const shipPos = getComponent(this.world, 'position', this.shipEntity);
    const originX = shipPos?.x ?? this.width / 2;
    const originY = shipPos?.y ?? this.height / 2;
    const safeRadius = (getComponent(this.world, 'collider', this.shipEntity)?.radius || SHIP_RADIUS) * 6;

    for (const entry of entries) {
      for (let i = 0; i < entry.count; i++) {
        let attempts = 0;
        let spawnX = 0;
        let spawnY = 0;
        do {
          const edge = Math.floor(Math.random() * 4);
          if (edge === 0) { spawnX = Math.random() * this.width; spawnY = -40; }
          else if (edge === 1) { spawnX = this.width + 40; spawnY = Math.random() * this.height; }
          else if (edge === 2) { spawnX = Math.random() * this.width; spawnY = this.height + 40; }
          else { spawnX = -40; spawnY = Math.random() * this.height; }
          spawnX = wrapValue(spawnX, this.width);
          spawnY = wrapValue(spawnY, this.height);
          attempts++;
          if (attempts > 8) break;
        } while (distanceSquared(spawnX, spawnY, originX, originY) < safeRadius * safeRadius);

        const angle = angleTo(spawnX, spawnY, originX, originY) + randomRange(-0.4, 0.4);
        const speed = ASTEROID_SPEED[entry.size] * randomRange(0.7, 1.1);
        this.spawnAsteroid(entry.size, {
          x: spawnX,
          y: spawnY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
        });
      }
    }

    this.waveSpawnDelay = 0;
    this.hud.wave.textContent = String(this.wave);
  }

  spawnAsteroid(size, { x, y, vx = 0, vy = 0 }) {
    const entity = createEntity(this.world);
    const radius = ASTEROID_SIZES[size];
    addComponent(this.world, 'position', entity, { x, y });
    addComponent(this.world, 'velocity', entity, { x: vx, y: vy });
    addComponent(this.world, 'rotation', entity, { angle: Math.random() * TWO_PI });
    addComponent(this.world, 'collider', entity, { radius });
    addComponent(this.world, 'rock', entity, {
      size,
      spin: randomRange(-0.9, 0.9),
      shape: makeAsteroidShape(radius),
    });
    return entity;
  }

  start() {
    if (this.started && !this.paused) return;
    if (!this.started) {
      this.started = true;
      this.score = 0;
      this.hud.score.textContent = '0';
      this.hideOverlay();
      this.startSession();
      if (!this.asteroidsRemaining()) {
        this.spawnWave();
      }
    }
    this.paused = false;
    this.hideOverlay();
  }

  pause() {
    if (this.paused || this.gameOver) return;
    this.paused = true;
    this.showOverlay('Paused', 'Press Resume or Space to continue.');
  }

  resume() {
    if (!this.paused || this.gameOver) return;
    this.paused = false;
    this.hideOverlay();
  }

  restart() {
    this.world = createWorld(this.width, this.height);
    this.shipEntity = this.spawnShip();
    this.score = 0;
    this.hud.score.textContent = '0';
    this.wave = 1;
    this.lives = 3;
    this.gameOver = false;
    this.paused = true;
    this.started = false;
    this.bulletCooldown = 0;
    this.waveSpawnDelay = 0;
    this.updateLivesDisplay();
    if (this.hud?.wave) this.hud.wave.textContent = String(this.wave);
    if (this.hud?.score) this.hud.score.textContent = '0';
    this.hideOverlay();
    this.showOverlay('Asteroids', 'Rotate with ←/→, thrust with ↑, fire with Space/Enter. Press Start to play.');
    this.endSession();
  }

  startSession() {
    if (this.sessionActive) return;
    this.sessionActive = true;
    startSessionTimer(SLUG);
  }

  endSession() {
    if (!this.sessionActive) return;
    this.sessionActive = false;
    endSessionTimer(SLUG);
  }

  loop(now) {
    recordRafTick(now);
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.12);
    this.lastTime = now;

    if (!this.paused && !this.gameOver) {
      this.step(dt);
    }

    this.render(dt);

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

  step(dt) {
    const ship = getComponent(this.world, 'ship', this.shipEntity);
    const shipPos = getComponent(this.world, 'position', this.shipEntity);
    const shipVel = getComponent(this.world, 'velocity', this.shipEntity);
    const shipRot = getComponent(this.world, 'rotation', this.shipEntity);

    if (!ship.alive) {
      ship.respawn -= dt;
      if (ship.respawn <= 0) {
        ship.alive = true;
        ship.invulnerable = 2.4;
        ship.respawn = 0;
        shipPos.x = this.width / 2;
        shipPos.y = this.height / 2;
        shipVel.x = 0;
        shipVel.y = 0;
      }
      this.systems(dt);
      return;
    }

    if (ship.invulnerable > 0) {
      ship.invulnerable = Math.max(0, ship.invulnerable - dt);
    }

    let turn = 0;
    if (this.controls.isDown('left')) turn -= 1;
    if (this.controls.isDown('right')) turn += 1;
    shipRot.angle += turn * ship.turnSpeed * dt;

    const thrusting = this.controls.isDown('up');
    if (thrusting) {
      const ax = Math.cos(shipRot.angle) * ship.thrust * dt;
      const ay = Math.sin(shipRot.angle) * ship.thrust * dt;
      shipVel.x = clamp(shipVel.x + ax, -MAX_SPEED, MAX_SPEED);
      shipVel.y = clamp(shipVel.y + ay, -MAX_SPEED, MAX_SPEED);
      this.thrustTimer += dt;
      if (this.thrustTimer > 0.02) {
        this.spawnThrusterParticles(shipPos, shipRot.angle, shipVel);
        this.thrustTimer = 0;
      }
    } else {
      shipVel.x *= 1 - Math.min(1, dt * 0.6);
      shipVel.y *= 1 - Math.min(1, dt * 0.6);
      this.thrustTimer = 0;
    }

    this.bulletCooldown = Math.max(0, this.bulletCooldown - dt);
    if (this.controls.isDown('a') && this.bulletCooldown <= 0) {
      this.firePrimary(shipPos, shipVel, shipRot.angle);
    }

    this.systems(dt);
    this.resolveCollisions();
    this.advanceWave(dt);
  }

  systems(dt) {
    physicsSystem(this.world, dt);
    lifetimeSystem(this.world, dt);
  }

  resolveCollisions() {
    const bullets = queryEntities(this.world, COMPONENT_FLAGS.position | COMPONENT_FLAGS.collider | COMPONENT_FLAGS.bullet);
    const rocks = queryEntities(this.world, COMPONENT_FLAGS.position | COMPONENT_FLAGS.collider | COMPONENT_FLAGS.rock);

    for (const bullet of bullets) {
      const bulletPos = getComponent(this.world, 'position', bullet);
      const bulletCol = getComponent(this.world, 'collider', bullet);
      let hit = false;
      for (const rock of rocks) {
        if (!this.world.alive[rock]) continue;
        const rockPos = getComponent(this.world, 'position', rock);
        const rockCol = getComponent(this.world, 'collider', rock);
        if (distanceSquared(bulletPos.x, bulletPos.y, rockPos.x, rockPos.y) < (bulletCol.radius + rockCol.radius) ** 2) {
          hit = true;
          this.handleAsteroidHit(rock);
          break;
        }
      }
      if (hit) {
        destroyEntity(this.world, bullet);
      }
    }

    const ship = getComponent(this.world, 'ship', this.shipEntity);
    if (!ship.alive || ship.invulnerable > 0) return;
    const shipPos = getComponent(this.world, 'position', this.shipEntity);
    const shipCol = getComponent(this.world, 'collider', this.shipEntity);
    for (const rock of rocks) {
      if (!this.world.alive[rock]) continue;
      const rockPos = getComponent(this.world, 'position', rock);
      const rockCol = getComponent(this.world, 'collider', rock);
      if (distanceSquared(shipPos.x, shipPos.y, rockPos.x, rockPos.y) < (shipCol.radius + rockCol.radius) ** 2) {
        this.shipDestroyed();
        this.handleAsteroidHit(rock);
        break;
      }
    }
  }

  handleAsteroidHit(entity) {
    const rock = getComponent(this.world, 'rock', entity);
    const pos = getComponent(this.world, 'position', entity);
    const vel = getComponent(this.world, 'velocity', entity);
    this.addScore(ASTEROID_SCORE[rock.size] || 20);
    this.spawnExplosion(pos.x, pos.y, rock.size);
    destroyEntity(this.world, entity);

    const splits = resolveSplitRules(this.waveConfig, rock.size);
    if (!splits.length) return;
    const baseSpeed = ASTEROID_SPEED[Math.max(1, rock.size - 1)];
    for (const childSize of splits) {
      const angle = Math.random() * TWO_PI;
      const speed = baseSpeed * randomRange(0.8, 1.2);
      this.spawnAsteroid(childSize, {
        x: pos.x,
        y: pos.y,
        vx: vel.x * 0.3 + Math.cos(angle) * speed,
        vy: vel.y * 0.3 + Math.sin(angle) * speed,
      });
    }
  }

  advanceWave(dt) {
    if (this.asteroidsRemaining() > 0) return;
    this.waveSpawnDelay += dt;
    if (this.waveSpawnDelay < 1.5) return;
    this.wave++;
    this.spawnWave();
  }

  asteroidsRemaining() {
    const rocks = queryEntities(this.world, COMPONENT_FLAGS.rock);
    return rocks.length;
  }

  addScore(points) {
    this.score += points;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.persistBestScore();
    }
    this.hud.score.textContent = String(this.score);
    this.hud.best.textContent = String(this.bestScore);
  }

  spawnThrusterParticles(pos, angle, vel) {
    for (let i = 0; i < 2; i++) {
      const entity = createEntity(this.world);
      const speed = -120 + Math.random() * -40;
      addComponent(this.world, 'position', entity, {
        x: pos.x + Math.cos(angle + Math.PI) * (SHIP_RADIUS - 4) + randomRange(-3, 3),
        y: pos.y + Math.sin(angle + Math.PI) * (SHIP_RADIUS - 4) + randomRange(-3, 3),
      });
      addComponent(this.world, 'velocity', entity, {
        x: vel.x * 0.3 + Math.cos(angle) * speed + randomRange(-20, 20),
        y: vel.y * 0.3 + Math.sin(angle) * speed + randomRange(-20, 20),
      });
      addComponent(this.world, 'collider', entity, { radius: 2 });
      addComponent(this.world, 'particle', entity, { color: 'rgba(94, 234, 212, 0.8)', size: 2 });
      addComponent(this.world, 'lifetime', entity, { remaining: 0.4, payload: 'particle' });
    }
  }

  spawnExplosion(x, y, size) {
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * TWO_PI;
      const speed = 80 + Math.random() * 180;
      const entity = createEntity(this.world);
      addComponent(this.world, 'position', entity, { x, y });
      addComponent(this.world, 'velocity', entity, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed });
      addComponent(this.world, 'collider', entity, { radius: 1.8 });
      addComponent(this.world, 'particle', entity, { color: 'rgba(239, 68, 68, 0.9)', size: 2 + size });
      addComponent(this.world, 'lifetime', entity, { remaining: 0.6, payload: 'particle' });
    }
    try {
      this.sounds.explode();
    } catch (_) {
      /* ignore */
    }
  }

  firePrimary(pos, vel, angle) {
    this.bulletCooldown = 0.18;
    const entity = createEntity(this.world);
    const speed = 460;
    addComponent(this.world, 'position', entity, {
      x: pos.x + Math.cos(angle) * (SHIP_RADIUS + 6),
      y: pos.y + Math.sin(angle) * (SHIP_RADIUS + 6),
    });
    addComponent(this.world, 'velocity', entity, {
      x: vel.x + Math.cos(angle) * speed,
      y: vel.y + Math.sin(angle) * speed,
    });
    addComponent(this.world, 'collider', entity, { radius: 3 });
    addComponent(this.world, 'bullet', entity, {});
    addComponent(this.world, 'lifetime', entity, { remaining: 0.9, payload: 'bullet' });
    try {
      this.sounds.laser();
    } catch (_) {
      /* ignore */
    }
  }

  shipDestroyed() {
    const ship = getComponent(this.world, 'ship', this.shipEntity);
    if (!ship.alive) return;
    ship.alive = false;
    ship.respawn = 2;
    const shipPos = getComponent(this.world, 'position', this.shipEntity);
    this.spawnExplosion(shipPos.x, shipPos.y, 2);
    this.lives = Math.max(0, this.lives - 1);
    this.updateLivesDisplay();
    if (this.lives <= 0) {
      this.gameOver = true;
      this.paused = true;
      this.endSession();
      this.showOverlay('Game Over', 'Press Restart to try again.');
    }
  }

  updateLivesDisplay() {
    if (!this.hud?.lives) return;
    if (typeof document === 'undefined') return;
    this.hud.lives.innerHTML = '';
    for (let i = 0; i < this.lives; i++) {
      const span = document.createElement('span');
      span.className = 'asteroids-hud__life';
      this.hud.lives.appendChild(span);
    }
  }

  render(dt) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, this.width, this.height);

    // starfield
    this.starfieldTime += dt;
    for (const layer of this.starfield) {
      ctx.fillStyle = layer.color;
      for (const star of layer.stars) {
        star.x -= layer.speed * dt;
        if (star.x < -layer.size) this.recycleStar(star);
        const alpha = 0.4 + 0.6 * Math.sin(star.phase + this.starfieldTime * star.twinkleSpeed);
        ctx.globalAlpha = clamp(alpha, 0, 1);
        ctx.fillRect(star.x, star.y, layer.size, layer.size);
      }
    }
    ctx.globalAlpha = 1;

    const particles = queryEntities(this.world, COMPONENT_FLAGS.position | COMPONENT_FLAGS.particle);
    for (const entity of particles) {
      const pos = getComponent(this.world, 'position', entity);
      const particle = getComponent(this.world, 'particle', entity);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, particle.size, 0, TWO_PI);
      ctx.fill();
    }

    const bullets = queryEntities(this.world, COMPONENT_FLAGS.position | COMPONENT_FLAGS.bullet);
    ctx.fillStyle = '#f8fafc';
    for (const entity of bullets) {
      const pos = getComponent(this.world, 'position', entity);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 2.5, 0, TWO_PI);
      ctx.fill();
    }

    const rocks = queryEntities(this.world, COMPONENT_FLAGS.position | COMPONENT_FLAGS.rock);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    for (const entity of rocks) {
      const pos = getComponent(this.world, 'position', entity);
      const rot = getComponent(this.world, 'rotation', entity);
      const rock = getComponent(this.world, 'rock', entity);
      rot.angle += rock.spin * dt;
      ctx.beginPath();
      const shape = rock.shape;
      for (let i = 0; i < shape.length; i++) {
        const point = shape[i];
        const px = pos.x + Math.cos(rot.angle) * point.x - Math.sin(rot.angle) * point.y;
        const py = pos.y + Math.sin(rot.angle) * point.x + Math.cos(rot.angle) * point.y;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }

    const ship = getComponent(this.world, 'ship', this.shipEntity);
    const shipPos = getComponent(this.world, 'position', this.shipEntity);
    const shipRot = getComponent(this.world, 'rotation', this.shipEntity);
    if (ship.alive) {
      const blink = ship.invulnerable > 0 && Math.floor(ship.invulnerable * 10) % 2 === 0;
      if (!blink) {
        ctx.save();
        ctx.translate(shipPos.x, shipPos.y);
        ctx.rotate(shipRot.angle);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(SHIP_RADIUS, 0);
        ctx.lineTo(-SHIP_RADIUS * 0.8, SHIP_RADIUS * 0.6);
        ctx.lineTo(-SHIP_RADIUS * 0.5, 0);
        ctx.lineTo(-SHIP_RADIUS * 0.8, -SHIP_RADIUS * 0.6);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();
  }

  getScore() {
    return this.score;
  }

  getBestScore() {
    return this.bestScore;
  }

  getShipState() {
    const pos = getComponent(this.world, 'position', this.shipEntity);
    const vel = getComponent(this.world, 'velocity', this.shipEntity);
    const rot = getComponent(this.world, 'rotation', this.shipEntity);
    const ship = getComponent(this.world, 'ship', this.shipEntity);
    return {
      x: pos?.x ?? null,
      y: pos?.y ?? null,
      vx: vel?.x ?? null,
      vy: vel?.y ?? null,
      angle: rot?.angle ?? null,
      invulnerable: ship?.invulnerable ?? null,
      alive: ship?.alive ?? null,
    };
  }

  getRockState() {
    const rocks = queryEntities(this.world, COMPONENT_FLAGS.position | COMPONENT_FLAGS.rock);
    return rocks.map((entity) => {
      const pos = getComponent(this.world, 'position', entity);
      const vel = getComponent(this.world, 'velocity', entity);
      const rock = getComponent(this.world, 'rock', entity);
      const col = getComponent(this.world, 'collider', entity);
      return {
        x: pos?.x ?? null,
        y: pos?.y ?? null,
        vx: vel?.x ?? null,
        vy: vel?.y ?? null,
        radius: col?.radius ?? null,
        size: rock?.size ?? null,
        spin: rock?.spin ?? null,
      };
    });
  }

  isPaused() {
    return this.paused;
  }

  isGameOver() {
    return this.gameOver;
  }

  getWave() {
    return this.wave;
  }

  showOverlay(title, message) {
    if (!this.hud?.overlay) return;
    this.hud.overlayTitle.textContent = title;
    this.hud.overlayMessage.textContent = message;
    this.hud.overlay.classList.add('is-visible');
  }

  hideOverlay() {
    if (!this.hud?.overlay) return;
    this.hud.overlay.classList.remove('is-visible');
  }

  restoreBestScore() {
    if (typeof localStorage === 'undefined') return 0;
    const value = localStorage.getItem(STORAGE_KEYS.best);
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  persistBestScore() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.best, String(this.bestScore));
  }
}
function boot(context = {}) {
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
  clearBootError();
  let canvas = null;
  let selector = null;
  if (typeof document !== 'undefined') {
    const resolvedCanvas = resolveGameCanvas();
    if (resolvedCanvas instanceof HTMLCanvasElement) {
      canvas = resolvedCanvas;
      selector = resolvedCanvas.id ? `#${resolvedCanvas.id}` : undefined;
    }
  }
  if (!(canvas instanceof HTMLCanvasElement)) {
    recordMilestone('boot:error', { reason: 'missing-canvas', readyState });
    recordCanvasWarning('missing-canvas', {
      stage: 'boot',
      selector: selector || '#game-canvas',
      readyState,
      attemptedSelectors: ['#game-canvas', '#game'],
    });
    pushEvent('boot', {
      level: 'error',
      message: '[asteroids] missing game canvas',
      details: { readyState, attemptedSelectors: ['#game-canvas', '#game'] },
    });
    bootInProgress = false;
    console.error('[asteroids] missing game canvas');
    return undefined;
  }

  captureCanvasSnapshot('boot:before-instance', canvas, { readyState, selector });

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
    const errorMessage =
      typeof details === 'string'
        ? details
        : details?.message || details?.name || String(error?.message || error || 'Unknown error');
    renderBootError(errorMessage, details);
    if (typeof window !== 'undefined') {
      try {
        window.parent?.postMessage?.(
          {
            type: 'GAME_ERROR',
            slug: SLUG,
            error: String(errorMessage).slice(0, 500),
            message: String(errorMessage).slice(0, 500),
          },
          '*',
        );
      } catch (_) {
        /* noop */
      }
    }
    bootInProgress = false;
    return undefined;
  }

  activeGame = game;
  bootTracker.entry.bootSuccesses = (bootTracker.entry.bootSuccesses || 0) + 1;
  bootTracker.entry.lastBootSuccessAt = Date.now();
  recordMilestone('boot:game-created');
  captureCanvasSnapshot('boot:after-instance', canvas, {
    readyState: typeof document !== 'undefined' ? document.readyState : readyState,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    selector,
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
    const details = sanitizeForLog(error);
    const errorMessage =
      typeof details === 'string'
        ? details
        : details?.message || details?.name || String(error?.message || error || 'Unknown error');
    renderBootError(errorMessage, details);
    if (typeof window !== 'undefined') {
      try {
        window.parent?.postMessage?.(
          {
            type: 'GAME_ERROR',
            slug: SLUG,
            error: String(errorMessage).slice(0, 500),
            message: String(errorMessage).slice(0, 500),
          },
          '*',
        );
      } catch (_) {
        /* noop */
      }
    }
    pushEvent('boot', {
      level: 'error',
      message: '[asteroids] auto boot failed',
      details,
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
