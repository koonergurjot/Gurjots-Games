import { Controls } from '../../src/runtime/controls.js';
import { startSessionTimer, endSessionTimer } from '../../shared/metrics.js';
import { pushEvent } from '/games/common/diag-adapter.js';
import { gameEvent } from '../../shared/telemetry.js';
import { createShopUi } from './ui.js';

const SLUG = 'asteroids';
const TWO_PI = Math.PI * 2;
const BASE_WIDTH = 960;
const BASE_HEIGHT = 720;
const SHIP_BASE_MAX_SPEED = 320;
const SHIP_BASE_THRUST = 520;
const SHIP_BASE_TURN_SPEED = 3.6;
const SHIP_RADIUS = 18;
const ASTEROID_SIZES = [0, 14, 26, 40]; // index by size tier (1-3)
const ASTEROID_SEGMENTS = 8;
const ASTEROID_BASE_SPEED = [0, 120, 90, 70];
const ASTEROID_BASE_SCORE = [0, 100, 50, 20];
const STAR_LAYER_CONFIG = [
  { density: 0.2, speed: 30, size: 2, color: '#e2e8f0' },
  { density: 0.1, speed: 12, size: 1.5, color: '#cbd5f5' },
  { density: 0.05, speed: 5, size: 1.1, color: '#94a3b8' },
];
const STAR_TWINKLE_SPEED = { min: 0.5, max: 1.2 };
const DEFAULT_GLOW_CONFIG = {
  engine: { alpha: 0.32, radius: 24, length: 46, pulse: 0.35 },
  bullet: { alpha: 0.55, radius: 10 },
  particles: { alpha: 0.28, radius: 2.2, count: 5 },
};
const DIFFICULTY_PRESETS = [
  { key: 'relaxed', label: 'Relaxed', shipSpeed: 0.85, asteroidSpeed: 0.75, score: 0.75 },
  { key: 'standard', label: 'Standard', shipSpeed: 1, asteroidSpeed: 1, score: 1 },
  { key: 'veteran', label: 'Veteran', shipSpeed: 1.15, asteroidSpeed: 1.25, score: 1.4 },
];
const STORAGE_KEYS = {
  best: `${SLUG}:best`,
};

const markFirstFrame = (() => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    try {
      window.ggFirstFrame?.();
    } catch (_) {
      /* noop */
    }
  };
})();

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
    { type: 'asteroids', rocks: [ { size: 3, count: 2 } ] },
    { type: 'asteroids', rocks: [ { size: 3, count: 3 } ] },
    { type: 'asteroids', rocks: [ { size: 3, count: 3 }, { size: 2, count: 1 } ] },
    { type: 'objective', label: 'Disable the Beacons', targets: 3, targetHealth: 2, rocks: [ { size: 3, count: 3 }, { size: 2, count: 1 } ] },
    { type: 'asteroids', rocks: [ { size: 3, count: 4 }, { size: 2, count: 2 } ] },
    { type: 'asteroids', rocks: [ { size: 3, count: 4 }, { size: 2, count: 2 }, { size: 1, count: 1 } ] },
    { type: 'asteroids', rocks: [ { size: 3, count: 5 }, { size: 2, count: 2 }, { size: 1, count: 1 } ] },
    { type: 'boss', label: 'Rogue Hunter', boss: { hp: 18, radius: 44, speed: 140, fireRate: 1.4, score: 1500 }, rocks: [ { size: 2, count: 2 }, { size: 1, count: 2 } ] },
    { type: 'asteroids', rocks: [ { size: 3, count: 6 }, { size: 2, count: 3 }, { size: 1, count: 2 } ] },
    { type: 'objective', label: 'Secure Data Cores', targets: 4, targetHealth: 3, rocks: [ { size: 3, count: 4 }, { size: 2, count: 2 }, { size: 1, count: 1 } ] },
    { type: 'boss', label: 'Dreadnought Escort', boss: { hp: 24, radius: 50, speed: 160, fireRate: 1.1, score: 2200 }, rocks: [ { size: 2, count: 3 }, { size: 1, count: 2 } ] },
    { type: 'asteroids', label: 'Endless Siege', rocks: [ { size: 3, count: 6 }, { size: 2, count: 4 }, { size: 1, count: 3 } ] },
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
  if (!config?.waves?.length) return normalizeWaveEntry(DEFAULT_WAVE_CONFIG.waves[0]);
  const index = Math.min(config.waves.length - 1, Math.max(0, wave - 1));
  return normalizeWaveEntry(config.waves[index]);
}

function resolveSplitRules(config, size) {
  const table = config?.splits || DEFAULT_WAVE_CONFIG.splits;
  return Array.isArray(table?.[String(size)]) ? table[String(size)] : [];
}

function normalizeWaveEntry(entry) {
  if (!entry) return { type: 'asteroids', rocks: [] };
  const type = typeof entry.type === 'string' ? entry.type : 'asteroids';
  const normalized = { ...entry, type };
  if (!Array.isArray(normalized.rocks)) {
    normalized.rocks = [];
  }
  return normalized;
}

function mergeGlowConfig(overrides = {}) {
  return {
    engine: { ...DEFAULT_GLOW_CONFIG.engine, ...(overrides.engine || {}) },
    bullet: { ...DEFAULT_GLOW_CONFIG.bullet, ...(overrides.bullet || {}) },
    particles: { ...DEFAULT_GLOW_CONFIG.particles, ...(overrides.particles || {}) },
  };
}

function parseFxModes(search = '') {
  if (!search || typeof search !== 'string') return new Set();
  let params;
  try {
    params = new URLSearchParams(search);
  } catch (_) {
    return new Set();
  }
  const modes = new Set();
  for (const value of params.getAll('fx')) {
    if (!value) continue;
    const parts = value.split(',');
    for (const part of parts) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed) modes.add(trimmed);
    }
  }
  return modes;
}

async function loadFxTuning() {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(new URL('../../assets/asteroids/fx.json', import.meta.url));
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    pushEvent('diagnostics', {
      level: 'info',
      message: '[asteroids] fx config unavailable, using defaults',
      details: sanitizeForLog(error),
    });
    return null;
  }
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
    const fxModes = parseFxModes(globalScope?.location?.search || '');
    this.fx = {
      glow: {
        enabled: fxModes.has('glow'),
        config: mergeGlowConfig(),
      },
    };
    this.fxTime = 0;
    this.shipGlow = 0;
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
    this.handleShopPurchase = this.handleShopPurchase.bind(this);
    this.handleShopSkip = this.handleShopSkip.bind(this);

    this.width = BASE_WIDTH;
    this.height = BASE_HEIGHT;
    this.dpr = 1;

    this.world = createWorld(this.width, this.height);
    this.shipEntity = null;

    this.difficultyIndex = 1;
    this.tuning = this.createDifficultyTuning(DIFFICULTY_PRESETS[this.difficultyIndex]?.key || 'standard');
    this.shipMaxSpeed = this.tuning.shipMaxSpeed;

    this.bulletCooldown = 0;
    this.thrustTimer = 0;
    this.postedReady = false;
    this.baseBulletCooldown = 0.18;
    this.primaryFireCooldown = this.baseBulletCooldown;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.lastAccuracy = 0;
    this.tookDamage = false;
    this.missionState = { wave10NoDamage: false, accuracy70: false };
    this.speedBonus = 0;
    this.accuracyBonus = 0;
    this.shopActive = false;
    this.pendingWave = null;
    this.shop = null;

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
    this.runStartTime = performance.now();

    this.waveSpawnDelay = 0;

    this.parallaxTime = 0;
    this.parallaxEvents = [];
    this.nextParallaxEvent = this.scheduleParallaxEvent();

    this.starfieldTime = 0;
    this.starfield = [];

    this.specialWave = null;
    this.enemyProjectiles = [];

    this.sounds = {
      laser: createAudio('../../assets/audio/laser.wav', 0.45),
      explode: createAudio('../../assets/audio/explode.wav', 0.6),
    };

    if (this.fx.glow.enabled) {
      loadFxTuning()
        .then((config) => {
          if (config?.glow) {
            this.fx.glow.config = mergeGlowConfig(config.glow);
          }
        })
        .catch(() => {
          /* ignore */
        });
    }

    this.hud = this.createHud();
    this.updateDifficultyUi();
    if (this.hud?.best) this.hud.best.textContent = String(this.bestScore);
    if (this.hud?.score) this.hud.score.textContent = '0';
    if (this.hud?.wave) this.hud.wave.textContent = String(this.wave);
    if (this.hud?.accuracy) this.hud.accuracy.textContent = '--';

    this.shop = createShopUi({
      host: this.hud?.surface || (typeof document !== 'undefined' ? document.querySelector('.game-shell__surface') : null),
      onPurchase: this.handleShopPurchase,
      onSkip: this.handleShopSkip,
    });
    this.resetRunStats();

    this.resizeCanvas();
    this.starfield = this.createStarLayers();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleResize);
      document.addEventListener('visibilitychange', this.handleVisibility);
    }

    this.shipEntity = this.spawnShip();
    this.applyPerkStats();
    this.updateLivesDisplay();
    this.showOverlay('Asteroids', 'Rotate with ←/→, thrust with ↑, fire with Space/Enter. Missions: Reach wave 10 without damage and keep accuracy at ≥70%. Press Start to play.');

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
    this.shop?.root?.remove?.();
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
    const rawWidth = rect.width || BASE_WIDTH;
    const rawHeight = rect.height || BASE_HEIGHT;
    this.width = Math.max(1, Math.round(rawWidth));
    this.height = Math.max(1, Math.round(rawHeight));
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    if (this.canvas.style) {
      this.canvas.style.width = '';
      this.canvas.style.height = '';
      this.canvas.style.removeProperty?.('width');
      this.canvas.style.removeProperty?.('height');
    }
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
        accuracy: { textContent: '--' },
        overlayTitle: { textContent: '' },
        overlayMessage: { textContent: '' },
        objectiveRow: { setAttribute() {}, removeAttribute() {} },
        objectiveValue: { textContent: '', style: {} },
        difficultySlider: { value: '0' },
        difficultyLabels: [],
        surface: null,
      };
    }

    const surface = document.querySelector('.game-shell__surface') || document.body;

    const hud = document.createElement('div');
    hud.className = 'asteroids-hud';
    const difficultyLabels = DIFFICULTY_PRESETS.map((preset, index) => `<span data-index="${index}">${preset.label}</span>`).join('');
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
      <div class="asteroids-hud__row">
        <span class="asteroids-hud__label">Accuracy</span>
        <span class="asteroids-hud__value" id="asteroids-accuracy">--</span>
      </div>
      <div class="asteroids-hud__row asteroids-hud__row--objective" data-objective-row hidden>
        <span class="asteroids-hud__label">Objective</span>
        <span class="asteroids-hud__value" id="asteroids-objective">--</span>
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
      <div class="asteroids-overlay__difficulty" id="asteroids-difficulty-panel">
        <label for="asteroids-difficulty">Difficulty</label>
        <input type="range" id="asteroids-difficulty" min="0" max="${DIFFICULTY_PRESETS.length - 1}" step="1" value="${this.difficultyIndex}" />
        <div class="asteroids-overlay__difficulty-labels">${difficultyLabels}</div>
      </div>
    `;
    surface.appendChild(overlay);

    overlay.querySelector('[data-action="resume"]').addEventListener('click', () => {
      if (this.gameOver) this.restart();
      else this.start();
    });
    overlay.querySelector('[data-action="restart"]').addEventListener('click', () => this.restart());

    const difficultyPanel = overlay.querySelector('#asteroids-difficulty-panel');
    if (difficultyPanel) {
      difficultyPanel.style.marginTop = '16px';
      const label = difficultyPanel.querySelector('label');
      if (label) {
        label.style.display = 'block';
        label.style.fontSize = '13px';
        label.style.fontWeight = '600';
        label.style.marginBottom = '6px';
        label.style.textTransform = 'uppercase';
        label.style.letterSpacing = '0.08em';
      }
      const slider = difficultyPanel.querySelector('input[type="range"]');
      if (slider) {
        slider.style.width = '100%';
        slider.style.margin = '0';
      }
      const labelsRow = difficultyPanel.querySelector('.asteroids-overlay__difficulty-labels');
      if (labelsRow) {
        labelsRow.style.display = 'flex';
        labelsRow.style.justifyContent = 'space-between';
        labelsRow.style.gap = '8px';
        labelsRow.style.marginTop = '6px';
        labelsRow.style.fontSize = '11px';
        labelsRow.style.textTransform = 'uppercase';
        labelsRow.style.letterSpacing = '0.08em';
        labelsRow.style.opacity = '0.8';
      }
    }

    const difficultySlider = overlay.querySelector('#asteroids-difficulty');
    const difficultySpans = Array.from(overlay.querySelectorAll('.asteroids-overlay__difficulty-labels span'));
    if (difficultySlider) {
      difficultySlider.addEventListener('input', (event) => {
        const value = Number(event.target?.value);
        if (!Number.isNaN(value)) {
          this.setDifficultyIndex(value);
        }
      });
    }

    return {
      root: hud,
      overlay,
      players: null,
      score: hud.querySelector('#asteroids-score'),
      best: hud.querySelector('#asteroids-best'),
      wave: hud.querySelector('#asteroids-wave'),
      lives: hud.querySelector('#asteroids-lives'),
      accuracy: hud.querySelector('#asteroids-accuracy'),
      objectiveRow: hud.querySelector('[data-objective-row]'),
      objectiveValue: hud.querySelector('#asteroids-objective'),
      overlayTitle: overlay.querySelector('#asteroids-overlay-title'),
      overlayMessage: overlay.querySelector('#asteroids-overlay-message'),
      difficultySlider,
      difficultyLabels: difficultySpans,
      surface,
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

  resetRunStats() {
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.lastAccuracy = 0;
    this.tookDamage = false;
    this.missionState = { wave10NoDamage: false, accuracy70: false };
    if (this.hud?.accuracy) this.hud.accuracy.textContent = '--';
  }

  resetPerks() {
    this.speedBonus = 0;
    this.accuracyBonus = 0;
    this.shopActive = false;
    this.pendingWave = null;
    if (this.shop?.hide) this.shop.hide();
    this.applyPerkStats();
  }

  applyPerkStats() {
    const baseMaxSpeed = this.tuning?.shipMaxSpeed ?? SHIP_BASE_MAX_SPEED;
    const baseThrust = this.tuning?.shipThrust ?? SHIP_BASE_THRUST;
    const baseTurn = this.tuning?.shipTurnSpeed ?? SHIP_BASE_TURN_SPEED;
    this.shipMaxSpeed = baseMaxSpeed + this.speedBonus;
    const ship = this.shipEntity != null ? getComponent(this.world, 'ship', this.shipEntity) : null;
    if (ship) {
      ship.thrust = baseThrust + this.speedBonus * 1.2;
      ship.turnSpeed = baseTurn;
    }
    const reduction = this.accuracyBonus * 0.02;
    const cooldown = Math.max(0.08, this.baseBulletCooldown - reduction);
    this.primaryFireCooldown = cooldown;
    this.bulletCooldown = Math.min(this.bulletCooldown, cooldown);
  }

  getAccuracyRatio() {
    if (!this.shotsFired) return 0;
    return clamp(this.shotsHit / this.shotsFired, 0, 1);
  }

  getAccuracyPercent() {
    return this.getAccuracyRatio() * 100;
  }

  formatPercent(value) {
    if (!Number.isFinite(value)) return '0%';
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
  }

  getAccuracySummary(includeCounts = false) {
    if (!this.shotsFired) {
      return includeCounts ? 'No shots fired' : '--';
    }
    const percent = this.getAccuracyPercent();
    const label = this.formatPercent(percent);
    if (!includeCounts) return label;
    return `${label} (${this.shotsHit}/${this.shotsFired})`;
  }

  updateAccuracyDisplay() {
    const percent = this.getAccuracyPercent();
    this.lastAccuracy = Number.isFinite(percent) ? Math.round(percent * 10) / 10 : 0;
    if (this.hud?.accuracy) {
      this.hud.accuracy.textContent = this.shotsFired ? this.formatPercent(percent) : '--';
    }
    this.checkAccuracyMission();
  }

  registerShotFired() {
    this.shotsFired += 1;
    gameEvent('score_event', {
      slug: SLUG,
      name: 'shot_fired',
      value: this.shotsFired,
    });
    this.updateAccuracyDisplay();
  }

  registerShotHit() {
    this.shotsHit += 1;
    gameEvent('score_event', {
      slug: SLUG,
      name: 'shot_hit',
      value: this.shotsHit,
    });
    this.updateAccuracyDisplay();
  }

  checkAccuracyMission() {
    if (this.missionState?.accuracy70) return;
    if (!this.shotsFired) return;
    if (this.getAccuracyPercent() < 70) return;
    this.missionState.accuracy70 = true;
    gameEvent('score_event', {
      slug: SLUG,
      name: 'accuracy_70',
      value: 1,
    });
  }

  handleWaveCleared(clearedWave) {
    if (clearedWave >= 10 && !this.tookDamage && !this.missionState.wave10NoDamage) {
      this.missionState.wave10NoDamage = true;
      gameEvent('score_event', {
        slug: SLUG,
        name: 'wave10_no_damage',
        value: 1,
      });
    }

    const nextWave = clearedWave + 1;
    this.wave = nextWave;

    if (clearedWave > 0 && clearedWave % 3 === 0) {
      this.openShop(nextWave);
      return;
    }

    this.spawnWave();
  }

  openShop(nextWave) {
    if (!this.shop || typeof this.shop.show !== 'function') {
      this.shopActive = false;
      this.pendingWave = null;
      this.spawnWave();
      return;
    }

    this.shopActive = true;
    this.pendingWave = nextWave;
    this.specialWave = null;
    this.refreshObjectiveHud();
    if (this.hud?.wave) {
      this.hud.wave.textContent = `${nextWave} • Shop`;
    }
    this.shop.show({
      wave: nextWave,
      accuracy: this.lastAccuracy,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
    });
  }

  closeShop() {
    if (this.shop?.hide) {
      this.shop.hide();
    }
    this.shopActive = false;
    this.pendingWave = null;
  }

  beginNextWave() {
    this.closeShop();
    this.waveSpawnDelay = 0;
    this.spawnWave();
  }

  handleShopPurchase(perkId) {
    if (!this.shopActive) return;

    switch (perkId) {
      case 'shield':
        this.lives = Math.min(this.lives + 1, 6);
        this.updateLivesDisplay();
        break;
      case 'speed':
        this.speedBonus = Math.min(this.speedBonus + 40, 200);
        break;
      case 'accuracy':
        this.accuracyBonus = Math.min(this.accuracyBonus + 1, 5);
        break;
      default:
        break;
    }

    this.applyPerkStats();
    gameEvent('score_event', {
      slug: SLUG,
      name: 'shop_purchase',
      value: 1,
      meta: { item: perkId },
    });
    this.beginNextWave();
  }

  handleShopSkip() {
    if (!this.shopActive) return;
    gameEvent('score_event', {
      slug: SLUG,
      name: 'shop_skip',
      value: 1,
    });
    this.beginNextWave();
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

  createDifficultyTuning(key) {
    const preset = DIFFICULTY_PRESETS.find((entry) => entry.key === key) || DIFFICULTY_PRESETS[1] || DIFFICULTY_PRESETS[0];
    const shipSpeedScale = typeof preset.shipSpeed === 'number' ? preset.shipSpeed : 1;
    const asteroidSpeedScale = typeof preset.asteroidSpeed === 'number' ? preset.asteroidSpeed : shipSpeedScale;
    const scoreScale = typeof preset.score === 'number' ? preset.score : 1;
    const turnScale = clamp(0.85 + (shipSpeedScale - 1) * 0.45, 0.75, 1.3);
    return {
      key: preset.key,
      label: preset.label,
      shipThrust: SHIP_BASE_THRUST * shipSpeedScale,
      shipTurnSpeed: SHIP_BASE_TURN_SPEED * turnScale,
      shipMaxSpeed: SHIP_BASE_MAX_SPEED * shipSpeedScale,
      asteroidSpeed: ASTEROID_BASE_SPEED.map((speed) => speed * asteroidSpeedScale),
      asteroidScore: ASTEROID_BASE_SCORE.map((score) => Math.max(5, Math.round(score * scoreScale))),
      scoreScale,
    };
  }

  setDifficultyIndex(index) {
    const clamped = clamp(Math.round(index), 0, DIFFICULTY_PRESETS.length - 1);
    if (this.difficultyIndex === clamped && this.tuning) {
      this.updateDifficultyUi();
      return;
    }
    this.difficultyIndex = clamped;
    const key = DIFFICULTY_PRESETS[clamped]?.key || 'standard';
    this.tuning = this.createDifficultyTuning(key);
    this.shipMaxSpeed = this.tuning.shipMaxSpeed;
    const ship = this.shipEntity != null ? getComponent(this.world, 'ship', this.shipEntity) : null;
    if (ship) {
      ship.thrust = this.tuning.shipThrust;
      ship.turnSpeed = this.tuning.shipTurnSpeed;
    }
    this.applyPerkStats();
    if (this.specialWave?.type === 'boss' && typeof this.specialWave.baseScore === 'number') {
      this.specialWave.score = Math.round(this.specialWave.baseScore * (this.tuning?.scoreScale ?? 1));
    } else if (this.specialWave?.type === 'objective') {
      if (typeof this.specialWave.basePerTarget === 'number') {
        this.specialWave.perTargetScore = Math.max(50, Math.round(this.specialWave.basePerTarget * (this.tuning?.scoreScale ?? 1)));
      }
      if (typeof this.specialWave.baseCompletion === 'number') {
        this.specialWave.targetScore = Math.max(100, Math.round(this.specialWave.baseCompletion * (this.tuning?.scoreScale ?? 1)));
      }
    }
    this.updateDifficultyUi();
  }

  updateDifficultyUi() {
    if (!this.hud) return;
    if (this.hud.difficultySlider && this.hud.difficultySlider.value !== String(this.difficultyIndex)) {
      this.hud.difficultySlider.value = String(this.difficultyIndex);
    }
    if (Array.isArray(this.hud.difficultyLabels)) {
      for (const span of this.hud.difficultyLabels) {
        const spanIndex = Number(span.dataset?.index ?? -1);
        const isActive = spanIndex === this.difficultyIndex;
        span.style.opacity = isActive ? '1' : '0.5';
        span.style.fontWeight = isActive ? '700' : '500';
      }
    }
    if (this.specialWave) {
      this.refreshObjectiveHud();
    }
  }

  updateWaveLabel(config) {
    if (!this.hud?.wave) return;
    const label = typeof config?.label === 'string' && config.label.trim() ? config.label.trim() : '';
    this.hud.wave.textContent = label ? `${this.wave} – ${label}` : String(this.wave);
  }

  refreshObjectiveHud() {
    if (!this.hud?.objectiveRow || !this.hud?.objectiveValue) return;
    if (!this.specialWave) {
      this.hud.objectiveRow.setAttribute('hidden', '');
      this.hud.objectiveValue.textContent = '--';
      this.hud.objectiveValue.style.opacity = '0.8';
      return;
    }

    this.hud.objectiveRow.removeAttribute('hidden');
    let text = this.specialWave.label || 'Objective';
    if (this.specialWave.type === 'boss' && this.specialWave.boss) {
      const hp = Math.max(0, Math.ceil(this.specialWave.boss.hp ?? 0));
      text = `${this.specialWave.label || 'Eliminate the boss'} (${hp} HP)`;
    } else if (this.specialWave.type === 'objective') {
      const remaining = this.specialWave.targets?.length ?? 0;
      if (this.specialWave.complete) {
        text = `${this.specialWave.label || 'Objective'} complete`;
      } else {
        const label = this.specialWave.label || 'Objective';
        text = `${label}: ${remaining} target${remaining === 1 ? '' : 's'} remaining`;
      }
    }
    this.hud.objectiveValue.textContent = text;
    this.hud.objectiveValue.style.opacity = this.specialWave.complete ? '0.7' : '1';
  }

  spawnBossWave(config) {
    const bossConfig = config?.boss || {};
    const label = typeof config?.label === 'string' && config.label.trim() ? config.label.trim() : 'Boss Incoming';
    const radius = Math.max(30, bossConfig.radius ?? 48);
    const hp = Math.max(8, bossConfig.hp ?? 20);
    const speed = Math.max(90, bossConfig.speed ?? 140);
    const fireRate = Math.max(0.6, bossConfig.fireRate ?? 1.3);
    const baseScore = typeof bossConfig.score === 'number' ? bossConfig.score : 1600;
    const entryY = randomRange(radius * 1.5, Math.max(radius * 1.5, this.height - radius * 1.5));
    this.specialWave = {
      type: 'boss',
      label,
      boss: {
        x: this.width + radius + 80,
        y: entryY,
        radius,
        hp,
        maxHp: hp,
        speed,
        fireRate,
        fireCooldown: fireRate * 0.6,
        direction: -1,
        sineTimer: Math.random() * TWO_PI,
        verticalAmplitude: randomRange(70, 120),
        entryTimer: 1.2,
      },
      score: Math.round(baseScore * (this.tuning?.scoreScale ?? 1)),
      baseScore,
      complete: false,
    };
    this.refreshObjectiveHud();
  }

  spawnObjectiveWave(config) {
    const label = typeof config?.label === 'string' && config.label.trim() ? config.label.trim() : 'Objective';
    const count = Math.max(1, Math.round(config?.targets ?? 3));
    const health = Math.max(1, Math.round(config?.targetHealth ?? 2));
    const radius = Math.max(18, config?.targetRadius ?? 26);
    const baseScore = typeof config?.score === 'number' ? config.score : 260 * count;
    const shipPos = getComponent(this.world, 'position', this.shipEntity) || { x: this.width / 2, y: this.height / 2 };
    const shipRadius = getComponent(this.world, 'collider', this.shipEntity)?.radius || SHIP_RADIUS;
    const safeRadius = shipRadius * 8;
    const targets = [];
    for (let i = 0; i < count; i++) {
      let attempt = 0;
      let x = 0;
      let y = 0;
      do {
        x = randomRange(radius * 1.5, this.width - radius * 1.5);
        y = randomRange(radius * 1.5, this.height - radius * 1.5);
        attempt++;
      } while (distanceSquared(x, y, shipPos.x, shipPos.y) < safeRadius * safeRadius && attempt < 12);
      targets.push({
        x,
        y,
        baseX: x,
        baseY: y,
        radius,
        hp: health,
        pulse: Math.random() * TWO_PI,
        pulseSpeed: randomRange(1.2, 2.2),
        orbitAngle: Math.random() * TWO_PI,
        orbitSpeed: randomRange(-0.6, 0.6),
        orbitRadius: randomRange(10, 26),
      });
    }

    const scoreScale = this.tuning?.scoreScale ?? 1;
    const basePerTarget = Math.max(50, Math.round(baseScore / count));
    const baseCompletion = Math.max(100, Math.round(baseScore * 0.6));
    const perTarget = Math.max(50, Math.round(basePerTarget * scoreScale));
    const completionBonus = Math.max(100, Math.round(baseCompletion * scoreScale));

    this.specialWave = {
      type: 'objective',
      label,
      targets,
      perTargetScore: perTarget,
      targetScore: completionBonus,
      basePerTarget,
      baseCompletion,
      complete: false,
    };
    this.refreshObjectiveHud();
  }

  updateSpecialWave(dt) {
    if (!this.specialWave) return;
    if (this.specialWave.type === 'boss') {
      const boss = this.specialWave.boss;
      if (!boss) return;
      const ship = getComponent(this.world, 'ship', this.shipEntity);
      const shipPos = getComponent(this.world, 'position', this.shipEntity);
      const shipCol = getComponent(this.world, 'collider', this.shipEntity);
      boss.entryTimer = Math.max(0, boss.entryTimer - dt);
      const entryFactor = boss.entryTimer > 0 ? clamp(1 - boss.entryTimer / 1.2, 0.35, 1) : 1;
      boss.x += boss.direction * boss.speed * entryFactor * dt;
      if (boss.x < boss.radius * 1.1) {
        boss.x = boss.radius * 1.1;
        boss.direction = 1;
      } else if (boss.x > this.width - boss.radius * 1.1) {
        boss.x = this.width - boss.radius * 1.1;
        boss.direction = -1;
      }
      boss.sineTimer += dt;
      boss.y += Math.sin(boss.sineTimer * 1.2) * boss.verticalAmplitude * dt;
      boss.y = clamp(boss.y, boss.radius * 0.9, this.height - boss.radius * 0.9);

      boss.fireCooldown -= dt;
      if (boss.fireCooldown <= 0) {
        boss.fireCooldown += boss.fireRate;
        if (ship && shipPos) {
          const angle = Math.atan2(shipPos.y - boss.y, shipPos.x - boss.x);
          const spread = 0.4;
          const projectileSpeed = 220 + 40 * this.difficultyIndex;
          this.spawnEnemyProjectile(boss.x, boss.y, angle, projectileSpeed, 4.5, 6);
          this.spawnEnemyProjectile(boss.x, boss.y, angle + spread, projectileSpeed * 0.85, 4, 6);
          this.spawnEnemyProjectile(boss.x, boss.y, angle - spread, projectileSpeed * 0.85, 4, 6);
        }
      }

      if (ship?.alive && ship.invulnerable <= 0 && shipPos && shipCol) {
        if (distanceSquared(shipPos.x, shipPos.y, boss.x, boss.y) < (shipCol.radius + boss.radius * 0.8) ** 2) {
          this.shipDestroyed();
        }
      }
    } else if (this.specialWave.type === 'objective') {
      if (Array.isArray(this.specialWave.targets)) {
        for (const target of this.specialWave.targets) {
          target.orbitAngle += target.orbitSpeed * dt;
          target.x = target.baseX + Math.cos(target.orbitAngle) * target.orbitRadius;
          target.y = target.baseY + Math.sin(target.orbitAngle) * target.orbitRadius;
          target.pulse += target.pulseSpeed * dt;
        }
      }
    }
  }

  spawnEnemyProjectile(x, y, angle, speed, lifetime = 4, radius = 5) {
    const color = 'rgba(248, 113, 113, 0.9)';
    this.enemyProjectiles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: lifetime,
      radius,
      color,
    });
  }

  updateEnemyProjectiles(dt) {
    if (!this.enemyProjectiles.length) return;
    const ship = getComponent(this.world, 'ship', this.shipEntity);
    const shipPos = getComponent(this.world, 'position', this.shipEntity);
    const shipCol = getComponent(this.world, 'collider', this.shipEntity);
    const boundsMargin = 40;
    for (const projectile of this.enemyProjectiles) {
      projectile.life -= dt;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      if (ship?.alive && ship.invulnerable <= 0 && shipPos && shipCol) {
        if (distanceSquared(projectile.x, projectile.y, shipPos.x, shipPos.y) < (projectile.radius + shipCol.radius) ** 2) {
          projectile.life = 0;
          this.shipDestroyed();
        }
      }
      if (
        projectile.x < -boundsMargin ||
        projectile.x > this.width + boundsMargin ||
        projectile.y < -boundsMargin ||
        projectile.y > this.height + boundsMargin
      ) {
        projectile.life = 0;
      }
    }
    this.enemyProjectiles = this.enemyProjectiles.filter((projectile) => projectile.life > 0);
  }

  handleSpecialBulletHit(bulletPos, radius) {
    if (!this.specialWave || this.specialWave.complete) return false;
    if (this.specialWave.type === 'boss') {
      const boss = this.specialWave.boss;
      if (!boss) return false;
      const distance = distanceSquared(bulletPos.x, bulletPos.y, boss.x, boss.y);
      if (distance < (radius + boss.radius) ** 2) {
        boss.hp -= 1;
        this.spawnExplosion(bulletPos.x, bulletPos.y, 0.6);
        if (boss.hp <= 0) {
          this.specialWave.complete = true;
          this.specialWave.boss = null;
          this.enemyProjectiles.length = 0;
          this.addScore(this.specialWave.score || Math.round(1500 * (this.tuning?.scoreScale ?? 1)));
          this.spawnExplosion(boss.x, boss.y, 4);
        }
        this.refreshObjectiveHud();
        return true;
      }
      return false;
    }
    if (this.specialWave.type === 'objective' && Array.isArray(this.specialWave.targets)) {
      for (let i = 0; i < this.specialWave.targets.length; i++) {
        const target = this.specialWave.targets[i];
        if (distanceSquared(bulletPos.x, bulletPos.y, target.x, target.y) < (radius + target.radius) ** 2) {
          target.hp -= 1;
          this.spawnExplosion(target.x, target.y, 1.2);
          if (target.hp <= 0) {
            this.specialWave.targets.splice(i, 1);
            this.addScore(this.specialWave.perTargetScore || Math.round(150 * (this.tuning?.scoreScale ?? 1)));
            i--;
          }
          if (!this.specialWave.targets.length && !this.specialWave.complete) {
            this.specialWave.complete = true;
            this.addScore(this.specialWave.targetScore || Math.round(300 * (this.tuning?.scoreScale ?? 1)));
          }
          this.refreshObjectiveHud();
          return true;
        }
      }
    }
    return false;
  }

  scheduleParallaxEvent() {
    return randomRange(18, 36);
  }

  spawnParallaxEvent() {
    const type = Math.random() < 0.6 ? 'comet' : 'nebula';
    if (type === 'comet') {
      const layerIndex = Math.floor(Math.random() * Math.max(1, this.starfield.length));
      const baseLayer = this.starfield[layerIndex] || { speed: 24, color: '#e2e8f0' };
      const speed = (baseLayer.speed || 24) * randomRange(4, 6.5);
      const y = randomRange(this.height * 0.15, this.height * 0.85);
      this.parallaxEvents.push({
        type: 'comet',
        x: this.width + 120,
        y,
        vx: -speed,
        vy: randomRange(-18, 18),
        radius: 3,
        duration: (this.width + 240) / speed,
        time: 0,
        color: baseLayer.color || '#f8fafc',
        trail: [],
        tailLength: 18,
      });
    } else {
      const layerIndex = Math.floor(Math.random() * Math.max(1, this.starfield.length));
      const baseLayer = this.starfield[layerIndex] || { color: '#38bdf8' };
      this.parallaxEvents.push({
        type: 'nebula',
        x: randomRange(this.width * 0.2, this.width * 0.8),
        y: randomRange(this.height * 0.2, this.height * 0.8),
        radius: randomRange(140, 220),
        duration: randomRange(5, 8),
        time: 0,
        color: baseLayer.color || '#38bdf8',
      });
    }
  }

  updateParallaxEvents(dt) {
    if (typeof dt !== 'number') return;
    if (this.nextParallaxEvent != null) {
      this.nextParallaxEvent -= dt;
      if (this.nextParallaxEvent <= 0) {
        this.spawnParallaxEvent();
        this.nextParallaxEvent = this.scheduleParallaxEvent();
      }
    }
    if (!this.parallaxEvents.length) return;
    for (const event of this.parallaxEvents) {
      event.time += dt;
      if (event.type === 'comet') {
        event.x += event.vx * dt;
        event.y += event.vy * dt;
        event.trail.unshift({ x: event.x, y: event.y });
        if (event.trail.length > event.tailLength) {
          event.trail.pop();
        }
      }
    }
    this.parallaxEvents = this.parallaxEvents.filter((event) => {
      if (event.type === 'comet') {
        return event.time < event.duration && event.x > -180;
      }
      return event.time < event.duration;
    });
  }

  renderParallaxEvents(ctx) {
    if (!this.parallaxEvents.length) return;
    for (const event of this.parallaxEvents) {
      if (event.type === 'comet') {
        const trail = event.trail || [];
        for (let i = 0; i < trail.length; i++) {
          const point = trail[i];
          const t = 1 - i / trail.length;
          ctx.globalAlpha = t * 0.5;
          ctx.fillStyle = event.color || '#f8fafc';
          ctx.beginPath();
          ctx.arc(this.snap(point.x), this.snap(point.y), 2 + 6 * t, 0, TWO_PI);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(this.snap(event.x), this.snap(event.y), event.radius + 1.5, 0, TWO_PI);
        ctx.fill();
      } else if (event.type === 'nebula') {
        const progress = clamp(event.time / event.duration, 0, 1);
        const alpha = Math.sin(progress * Math.PI);
        const x = this.snap(event.x);
        const y = this.snap(event.y);
        const gradient = ctx.createRadialGradient(x, y, event.radius * 0.2, x, y, event.radius);
        gradient.addColorStop(0, `${event.color}80`);
        gradient.addColorStop(1, `${event.color}00`);
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, event.radius, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  renderSpecialWave(ctx, stage = 'all') {
    if (!this.specialWave) return;
    const allowObjective = stage === 'all' || stage === 'pre';
    const allowBoss = stage === 'all' || stage === 'post';
    if (allowObjective && this.specialWave.type === 'objective' && Array.isArray(this.specialWave.targets)) {
      for (const target of this.specialWave.targets) {
        const pulse = 0.6 + 0.4 * Math.sin(target.pulse);
        const x = this.snap(target.x);
        const y = this.snap(target.y);
        const gradient = ctx.createRadialGradient(x, y, target.radius * 0.3, x, y, target.radius * 1.1);
        gradient.addColorStop(0, `rgba(96, 165, 250, ${0.6 * pulse})`);
        gradient.addColorStop(1, 'rgba(96, 165, 250, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, target.radius * 1.1, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = 'rgba(191, 219, 254, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, target.radius * 0.65, 0, TWO_PI);
        ctx.stroke();
      }
    }
    if (allowBoss && this.specialWave.type === 'boss' && this.specialWave.boss) {
      const boss = this.specialWave.boss;
      const hpRatio = clamp(boss.hp / (boss.maxHp || boss.hp || 1), 0, 1);
      const bx = this.snap(boss.x);
      const by = this.snap(boss.y);
      const bodyGradient = ctx.createRadialGradient(bx, by, boss.radius * 0.3, bx, by, boss.radius);
      bodyGradient.addColorStop(0, 'rgba(248, 113, 113, 0.9)');
      bodyGradient.addColorStop(1, 'rgba(248, 113, 113, 0.1)');
      ctx.fillStyle = bodyGradient;
      ctx.beginPath();
      ctx.arc(bx, by, boss.radius, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = 'rgba(252, 165, 165, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bx, by, boss.radius * 0.75, 0, TWO_PI);
      ctx.stroke();

      // health ring
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(bx, by, boss.radius + 8, -Math.PI / 2, -Math.PI / 2 + hpRatio * TWO_PI);
      ctx.stroke();
    }
  }

  renderEnemyProjectiles(ctx) {
    if (!this.enemyProjectiles.length) return;
    for (const projectile of this.enemyProjectiles) {
      ctx.fillStyle = projectile.color || 'rgba(248, 113, 113, 0.9)';
      ctx.beginPath();
      ctx.arc(this.snap(projectile.x), this.snap(projectile.y), projectile.radius, 0, TWO_PI);
      ctx.fill();
    }
  }

  renderBulletGlow(ctx, x, y, config, normalized, id = 0) {
    const bulletConfig = config?.bullet || DEFAULT_GLOW_CONFIG.bullet;
    const radius = Math.max(4, Number(bulletConfig.radius) || DEFAULT_GLOW_CONFIG.bullet.radius);
    const baseAlpha = clamp(Number(bulletConfig.alpha) || DEFAULT_GLOW_CONFIG.bullet.alpha, 0, 1);
    const flicker = 0.85 + 0.15 * Math.sin(this.fxTime * 45 + id * 0.6);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = baseAlpha * flicker * Math.max(0.1, normalized);
    const gradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
    gradient.addColorStop(0, 'rgba(252, 211, 77, 0.95)');
    gradient.addColorStop(0.55, 'rgba(165, 243, 252, 0.45)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  renderShip(ctx, ship, shipPos, shipRot, glowConfig) {
    if (!ship?.alive || !shipPos || !shipRot) return;
    const blink = ship.invulnerable > 0 && Math.floor(ship.invulnerable * 10) % 2 === 0;
    if (blink) return;
    const x = this.snap(shipPos.x);
    const y = this.snap(shipPos.y);
    const angle = shipRot?.angle ?? 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;

    if (glowConfig && this.shipGlow > 0.001) {
      const engineConfig = glowConfig.engine || DEFAULT_GLOW_CONFIG.engine;
      const engineAlpha = clamp(Number(engineConfig.alpha) || DEFAULT_GLOW_CONFIG.engine.alpha, 0, 1);
      const engineRadius = Math.max(6, Number(engineConfig.radius) || DEFAULT_GLOW_CONFIG.engine.radius);
      const engineLength = Math.max(engineRadius, Number(engineConfig.length) || DEFAULT_GLOW_CONFIG.engine.length);
      const pulse = clamp(Number(engineConfig.pulse) || DEFAULT_GLOW_CONFIG.engine.pulse, 0, 1);
      const pulseFactor = 1 + pulse * Math.sin(this.fxTime * 3.6 + angle);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = engineAlpha * this.shipGlow;
      const gradient = ctx.createRadialGradient(-SHIP_RADIUS * 0.6, 0, engineRadius * 0.3, -SHIP_RADIUS * 0.6, 0, engineLength);
      gradient.addColorStop(0, 'rgba(134, 239, 172, 0.92)');
      gradient.addColorStop(0.45, 'rgba(94, 234, 212, 0.45)');
      gradient.addColorStop(1, 'rgba(14, 165, 233, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(-SHIP_RADIUS - engineLength * 0.25, 0, engineRadius, engineLength * 0.65 * pulseFactor, 0, 0, TWO_PI);
      ctx.fill();

      const particles = glowConfig.particles || DEFAULT_GLOW_CONFIG.particles;
      const particleCount = Math.max(0, Math.round(Number(particles.count) || 0));
      if (particleCount > 0) {
        ctx.globalAlpha = clamp((Number(particles.alpha) || DEFAULT_GLOW_CONFIG.particles.alpha) * this.shipGlow, 0, 1);
        ctx.fillStyle = 'rgba(165, 243, 252, 1)';
        for (let i = 0; i < particleCount; i++) {
          const t = ((this.fxTime * 1.2) + i / particleCount) % 1;
          const px = -SHIP_RADIUS - engineLength * 0.75 * t;
          const py = Math.sin(this.fxTime * 6 + i * 1.4) * engineRadius * 0.35;
          const size = Math.max(0.5, (Number(particles.radius) || DEFAULT_GLOW_CONFIG.particles.radius) * (1 - t));
          ctx.beginPath();
          ctx.arc(px, py, size, 0, TWO_PI);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    ctx.strokeStyle = '#34d399';
    ctx.beginPath();
    ctx.moveTo(SHIP_RADIUS, 0);
    ctx.lineTo(-SHIP_RADIUS * 0.8, SHIP_RADIUS * 0.6);
    ctx.lineTo(-SHIP_RADIUS * 0.5, 0);
    ctx.lineTo(-SHIP_RADIUS * 0.8, -SHIP_RADIUS * 0.6);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  snap(value) {
    if (!Number.isFinite(value)) return value;
    const scale = this.dpr || 1;
    return Math.round(value * scale) / scale;
  }

  spawnShip() {
    const entity = createEntity(this.world);
    addComponent(this.world, 'position', entity, { x: this.width / 2, y: this.height / 2 });
    addComponent(this.world, 'velocity', entity, { x: 0, y: 0 });
    addComponent(this.world, 'rotation', entity, { angle: -Math.PI / 2 });
    addComponent(this.world, 'collider', entity, { radius: SHIP_RADIUS });
    addComponent(this.world, 'ship', entity, {
      alive: true,
      thrust: this.tuning?.shipThrust ?? SHIP_BASE_THRUST,
      turnSpeed: this.tuning?.shipTurnSpeed ?? SHIP_BASE_TURN_SPEED,
      invulnerable: 2.4,
      respawn: 0,
    });
    return entity;
  }

  spawnWave() {
    const config = resolveWaveConfig(this.waveConfig, this.wave);
    this.specialWave = null;
    this.enemyProjectiles.length = 0;
    if (config.type === 'boss') {
      this.spawnBossWave(config);
    } else if (config.type === 'objective') {
      this.spawnObjectiveWave(config);
    }

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
        const baseSpeed = this.tuning?.asteroidSpeed?.[entry.size] ?? ASTEROID_BASE_SPEED[entry.size] ?? 80;
        const speed = baseSpeed * randomRange(0.7, 1.1);
        this.spawnAsteroid(entry.size, {
          x: spawnX,
          y: spawnY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
        });
      }
    }

    this.waveSpawnDelay = 0;
    this.updateWaveLabel(config);
    this.refreshObjectiveHud();
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
      this.resetRunStats();
      this.score = 0;
      this.hud.score.textContent = '0';
      this.hideOverlay();
      this.startSession();
      this.runStartTime = performance.now();
      gameEvent('play', {
        slug: SLUG,
      });
      if (!this.asteroidsRemaining()) {
        this.spawnWave();
      }
    }
    this.paused = false;
    this.hideOverlay();
  }

  pause() {
    if (this.paused || this.gameOver || this.shopActive) return;
    this.paused = true;
    const summary = this.getAccuracySummary(true);
    const message = summary === 'No shots fired'
      ? 'No shots fired yet. Press Resume or Space to continue.'
      : `Accuracy ${summary}. Press Resume or Space to continue.`;
    this.showOverlay('Paused', message);
  }

  resume() {
    if (!this.paused || this.gameOver || this.shopActive) return;
    this.paused = false;
    this.hideOverlay();
  }

  restart() {
    this.world = createWorld(this.width, this.height);
    this.shipEntity = this.spawnShip();
    this.resetRunStats();
    this.resetPerks();
    this.score = 0;
    this.hud.score.textContent = '0';
    this.wave = 1;
    this.lives = 3;
    this.gameOver = false;
    this.paused = true;
    this.started = false;
    this.bulletCooldown = 0;
    this.waveSpawnDelay = 0;
    this.specialWave = null;
    this.enemyProjectiles = [];
    this.parallaxEvents = [];
    this.nextParallaxEvent = this.scheduleParallaxEvent();
    this.updateLivesDisplay();
    if (this.hud?.wave) this.hud.wave.textContent = String(this.wave);
    if (this.hud?.score) this.hud.score.textContent = '0';
    this.refreshObjectiveHud();
    this.updateDifficultyUi();
    this.hideOverlay();
    this.showOverlay('Asteroids', 'Rotate with ←/→, thrust with ↑, fire with Space/Enter. Missions: Reach wave 10 without damage and keep accuracy at ≥70%. Press Start to play.');
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

    if (!this.paused && !this.gameOver && !this.shopActive) {
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
      this.shipGlow = Math.max(0, this.shipGlow - dt * 4);
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
      this.updateParallaxEvents(dt);
      this.updateSpecialWave(dt);
      this.updateEnemyProjectiles(dt);
      this.resolveCollisions();
      this.advanceWave(dt);
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
      const maxSpeed = this.shipMaxSpeed ?? SHIP_BASE_MAX_SPEED;
      shipVel.x = clamp(shipVel.x + ax, -maxSpeed, maxSpeed);
      shipVel.y = clamp(shipVel.y + ay, -maxSpeed, maxSpeed);
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
    const glowTarget = thrusting ? 1 : 0;
    const glowLerp = thrusting ? 9 : 4;
    this.shipGlow += (glowTarget - this.shipGlow) * Math.min(1, dt * glowLerp);
    this.shipGlow = clamp(this.shipGlow, 0, 1);

    this.bulletCooldown = Math.max(0, this.bulletCooldown - dt);
    if (this.controls.isDown('a') && this.bulletCooldown <= 0) {
      this.firePrimary(shipPos, shipVel, shipRot.angle);
    }

    this.systems(dt);
    this.updateParallaxEvents(dt);
    this.updateSpecialWave(dt);
    this.updateEnemyProjectiles(dt);
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
      if (!bulletPos || !bulletCol) continue;
      const radius = bulletCol.radius || 3;
      let hit = this.handleSpecialBulletHit(bulletPos, radius);
      if (hit) {
        this.registerShotHit();
      } else {
        for (const rock of rocks) {
          if (!this.world.alive[rock]) continue;
          const rockPos = getComponent(this.world, 'position', rock);
          const rockCol = getComponent(this.world, 'collider', rock);
          if (distanceSquared(bulletPos.x, bulletPos.y, rockPos.x, rockPos.y) < (radius + rockCol.radius) ** 2) {
            hit = true;
            this.handleAsteroidHit(rock);
            this.registerShotHit();
            break;
          }
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
    const points = this.tuning?.asteroidScore?.[rock.size] ?? ASTEROID_BASE_SCORE[rock.size] ?? 20;
    this.addScore(points);
    this.spawnExplosion(pos.x, pos.y, rock.size);
    destroyEntity(this.world, entity);

    const splits = resolveSplitRules(this.waveConfig, rock.size);
    if (!splits.length) return;
    const parentSize = Math.max(1, rock.size - 1);
    const parentBaseSpeed = this.tuning?.asteroidSpeed?.[parentSize] ?? ASTEROID_BASE_SPEED[parentSize] ?? 90;
    for (const childSize of splits) {
      const angle = Math.random() * TWO_PI;
      const speed = parentBaseSpeed * randomRange(0.8, 1.2);
      this.spawnAsteroid(childSize, {
        x: pos.x,
        y: pos.y,
        vx: vel.x * 0.3 + Math.cos(angle) * speed,
        vy: vel.y * 0.3 + Math.sin(angle) * speed,
      });
    }
  }

  advanceWave(dt) {
    if (this.shopActive) return;
    if (!this.isWaveComplete()) return;
    this.waveSpawnDelay += dt;
    if (this.waveSpawnDelay < 1.5) return;
    this.waveSpawnDelay = 0;
    const clearedWave = this.wave;
    gameEvent('level_up', {
      slug: SLUG,
      level: clearedWave,
    });
    this.handleWaveCleared(clearedWave);
  }

  asteroidsRemaining() {
    const rocks = queryEntities(this.world, COMPONENT_FLAGS.rock);
    return rocks.length;
  }

  isWaveComplete() {
    if (this.specialWave && !this.specialWave.complete) {
      if (this.specialWave.type === 'boss' && this.specialWave.boss) {
        return false;
      }
      if (this.specialWave.type === 'objective' && (this.specialWave.targets?.length ?? 0) > 0) {
        return false;
      }
      if (!this.specialWave.complete) {
        return false;
      }
    }
    return this.asteroidsRemaining() <= 0;
  }

  addScore(points) {
    this.score += points;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.persistBestScore();
    }
    this.hud.score.textContent = String(this.score);
    this.hud.best.textContent = String(this.bestScore);
    gameEvent('score', {
      slug: SLUG,
      value: this.score,
      meta: {
        best: this.bestScore,
        lives: this.lives,
        wave: this.wave,
      },
    });
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
    this.bulletCooldown = this.primaryFireCooldown;
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
    addComponent(this.world, 'lifetime', entity, { remaining: 0.9, duration: 0.9, payload: 'bullet' });
    try {
      this.sounds.laser();
    } catch (_) {
      /* ignore */
    }
    this.registerShotFired();
  }

  shipDestroyed() {
    const ship = getComponent(this.world, 'ship', this.shipEntity);
    if (!ship.alive) return;
    ship.alive = false;
    ship.respawn = 2;
    const shipPos = getComponent(this.world, 'position', this.shipEntity);
    this.spawnExplosion(shipPos.x, shipPos.y, 2);
    this.lives = Math.max(0, this.lives - 1);
    this.tookDamage = true;
    this.updateLivesDisplay();
    if (this.lives <= 0) {
      this.gameOver = true;
      this.paused = true;
      if (this.shopActive) {
        this.closeShop();
      }
      this.endSession();
      const now = performance.now();
      const durationMs = Math.max(0, Math.round(now - (this.runStartTime || now)));
      gameEvent('game_over', {
        slug: SLUG,
        value: this.score,
        durationMs,
        meta: {
          wave: this.wave,
          accuracy: this.lastAccuracy,
        },
      });
      gameEvent('lose', {
        slug: SLUG,
        meta: {
          wave: this.wave,
          score: this.score,
        },
      });
      const summary = this.getAccuracySummary(true);
      const message = summary === 'No shots fired'
        ? `Score ${this.score}. Press Restart to try again.`
        : `Score ${this.score} • Accuracy ${summary}. Press Restart to try again.`;
      this.showOverlay('Game Over', message);
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
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.paused || this.gameOver || this.shopActive) {
      this.shipGlow = Math.max(0, this.shipGlow - dt * 2.5);
    }

    this.fxTime += dt;
    const glowEnabled = Boolean(this.fx?.glow?.enabled);
    const glowConfig = glowEnabled ? this.fx.glow.config : null;

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

    this.renderParallaxEvents(ctx);
    this.renderSpecialWave(ctx, 'pre');

    const particles = queryEntities(this.world, COMPONENT_FLAGS.position | COMPONENT_FLAGS.particle);
    for (const entity of particles) {
      const pos = getComponent(this.world, 'position', entity);
      const particle = getComponent(this.world, 'particle', entity);
      const x = this.snap(pos.x);
      const y = this.snap(pos.y);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(x, y, particle.size, 0, TWO_PI);
      ctx.fill();
    }

    const bullets = queryEntities(this.world, COMPONENT_FLAGS.position | COMPONENT_FLAGS.bullet);
    ctx.fillStyle = '#f8fafc';
    for (const entity of bullets) {
      const pos = getComponent(this.world, 'position', entity);
      const lifetime = getComponent(this.world, 'lifetime', entity);
      const x = this.snap(pos.x);
      const y = this.snap(pos.y);
      if (glowEnabled && glowConfig) {
        const duration = typeof lifetime?.duration === 'number' && lifetime.duration > 0 ? lifetime.duration : 0.9;
        const normalized = clamp((lifetime?.remaining ?? duration) / duration, 0, 1);
        this.renderBulletGlow(ctx, x, y, glowConfig, normalized, entity);
      }
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, TWO_PI);
      ctx.fill();
    }

    const rocks = queryEntities(this.world, COMPONENT_FLAGS.position | COMPONENT_FLAGS.rock);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const entity of rocks) {
      const pos = getComponent(this.world, 'position', entity);
      const rot = getComponent(this.world, 'rotation', entity);
      const rock = getComponent(this.world, 'rock', entity);
      rot.angle += rock.spin * dt;
      ctx.beginPath();
      const shape = rock.shape;
      for (let i = 0; i < shape.length; i++) {
        const point = shape[i];
        const px = this.snap(pos.x + Math.cos(rot.angle) * point.x - Math.sin(rot.angle) * point.y);
        const py = this.snap(pos.y + Math.sin(rot.angle) * point.x + Math.cos(rot.angle) * point.y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }

    this.renderSpecialWave(ctx, 'post');
    this.renderEnemyProjectiles(ctx);

    const ship = getComponent(this.world, 'ship', this.shipEntity);
    const shipPos = getComponent(this.world, 'position', this.shipEntity);
    const shipRot = getComponent(this.world, 'rotation', this.shipEntity);
    this.renderShip(ctx, ship, shipPos, shipRot, glowEnabled ? glowConfig : null);

    ctx.restore();
    markFirstFrame();
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
