import * as net from './net.js';
import { pushEvent } from '/games/common/diag-adapter.js';
import { drawTileSprite, getTilePattern, getSpriteFrame, preloadTileTextures } from '../../shared/render/tileTextures.js';
import { loadStrip } from '../../shared/assets.js';
import { play as playSfx, setPaused as setAudioPaused } from '../../shared/juice/audio.js';
import { tiles } from './tiles.js';
import { createSceneManager } from '../../src/engine/scenes.js';

const globalScope = typeof window !== 'undefined' ? window : undefined;
const GAME_ID = 'platformer';
const BOOT_SNAPSHOT_INTERVAL = 5000;

const platformerApi = (() => {
  if (!globalScope) return null;
  const existing = globalScope.Platformer;
  if (existing && typeof existing === 'object') {
    return existing;
  }
  const api = {};
  globalScope.Platformer = api;
  return api;
})();

if (platformerApi) {
  if (platformerApi.onState == null) platformerApi.onState = [];
  if (platformerApi.onScore == null) platformerApi.onScore = [];
}

function ensureBootRecord() {
  if (!globalScope) {
    return {
      game: GAME_ID,
      createdAt: Date.now(),
      phases: {},
      phaseOrder: [],
      raf: { lastTick: 0, tickCount: 0 },
      canvas: { width: null, height: null, lastChange: 0, attached: null },
      logs: [],
      watchdogs: {},
    };
  }
  const root = globalScope.__bootStatus || (globalScope.__bootStatus = {});
  if (!root[GAME_ID]) {
    root[GAME_ID] = {
      game: GAME_ID,
      createdAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      phases: {},
      phaseOrder: [],
      raf: { lastTick: 0, tickCount: 0, firstTickAt: 0, stalled: false, noTickLogged: false },
      canvas: { width: null, height: null, lastChange: 0, attached: null, notifiedDetached: false },
      logs: [],
      watchdogs: {},
    };
  }
  return root[GAME_ID];
}

function toCallbackList(value) {
  if (!value) return [];
  if (typeof value === 'function') return [value];
  if (Array.isArray(value)) return value.filter((fn) => typeof fn === 'function');
  if (typeof Set !== 'undefined' && value instanceof Set) {
    return Array.from(value).filter((fn) => typeof fn === 'function');
  }
  if (typeof value.handleEvent === 'function') {
    return [value.handleEvent.bind(value)];
  }
  return [];
}

function notifyPlatformerCallbacks(property, payload) {
  if (!platformerApi) return;
  const handlers = toCallbackList(platformerApi[property]);
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch (err) {
      if (globalScope?.console?.warn) {
        globalScope.console.warn(`[${GAME_ID}] ${property} callback failed`, err);
      }
    }
  }
}

function buildPhaseSnapshot(record) {
  const phases = [];
  const source = Array.isArray(record.phaseOrder) && record.phaseOrder.length
    ? record.phaseOrder.slice()
    : Object.keys(record.phases || {});
  source.sort((a, b) => {
    const aAt = record.phases?.[a]?.at ?? 0;
    const bAt = record.phases?.[b]?.at ?? 0;
    return aAt - bAt;
  });
  for (const name of source.slice(-12)) {
    const entry = record.phases?.[name];
    if (!entry) continue;
    phases.push({
      name,
      at: entry.at ?? null,
      details: Object.keys(entry)
        .filter((key) => key !== 'at')
        .reduce((acc, key) => {
          acc[key] = entry[key];
          return acc;
        }, {}),
    });
  }
  return phases;
}

function buildLogSnapshot(record) {
  if (!Array.isArray(record.logs) || !record.logs.length) return [];
  return record.logs.slice(-10).map((entry) => ({
    level: entry.level || 'info',
    message: entry.message || '',
    timestamp: entry.timestamp || Date.now(),
  }));
}

function buildBootSnapshot(record) {
  return {
    createdAt: record.createdAt ?? null,
    phases: buildPhaseSnapshot(record),
    raf: record.raf
      ? {
          tickCount: record.raf.tickCount ?? 0,
          sinceLastTick: record.raf.sinceLastTick ?? null,
          stalled: !!record.raf.stalled,
          noTickLogged: !!record.raf.noTickLogged,
        }
      : null,
    canvas: record.canvas
      ? {
          width: record.canvas.width ?? null,
          height: record.canvas.height ?? null,
          attached: record.canvas.attached ?? null,
          lastChange: record.canvas.lastChange ?? null,
        }
      : null,
    watchdogs: record.watchdogs
      ? {
          active: !!record.watchdogs.active,
          armedAt: record.watchdogs.armedAt ?? null,
        }
      : null,
    logs: buildLogSnapshot(record),
  };
}

function determineBootLevel(record) {
  const latestLog = Array.isArray(record.logs) && record.logs.length
    ? record.logs[record.logs.length - 1]
    : null;
  if (latestLog?.level === 'error') return 'error';
  if (record.raf?.stalled) return 'warn';
  return 'info';
}

function emitBootSnapshot(message, { level, details, context } = {}) {
  if (!globalScope) return;
  const record = ensureBootRecord();
  const payload = {
    level: level ?? determineBootLevel(record),
    message: `[${GAME_ID}] ${message}`,
    details: {
      context: context || 'snapshot',
      snapshot: buildBootSnapshot(record),
    },
  };
  if (details && Object.keys(details).length) {
    payload.details.details = details;
  }
  try {
    pushEvent('boot', payload);
  } catch (err) {
    if (globalScope?.console?.warn) {
      globalScope.console.warn(`[${GAME_ID}] failed to push boot snapshot`, err);
    }
  }
  return payload;
}

let bootSnapshotTimer = 0;

function stopBootSnapshots() {
  if (!globalScope) return;
  if (bootSnapshotTimer && typeof globalScope.clearInterval === 'function') {
    globalScope.clearInterval(bootSnapshotTimer);
  }
  bootSnapshotTimer = 0;
}

function startBootSnapshots() {
  if (!globalScope) return;
  stopBootSnapshots();
  emitBootSnapshot('snapshot ready', { context: 'boot' });
  if (typeof globalScope.setInterval === 'function') {
    bootSnapshotTimer = globalScope.setInterval(() => {
      emitBootSnapshot('watchdog update', { context: 'watchdog' });
    }, BOOT_SNAPSHOT_INTERVAL);
    globalScope.addEventListener?.('beforeunload', stopBootSnapshots, { once: true });
  }
}

function markPhase(name, details) {
  const record = ensureBootRecord();
  const at = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const entry = Object.assign({ at }, details || {});
  record.phases[name] = entry;
  if (Array.isArray(record.phaseOrder) && !record.phaseOrder.includes(name)) {
    record.phaseOrder.push(name);
  }
  return entry;
}

function logBoot(level, message, details = {}) {
  const record = ensureBootRecord();
  const timestamp = Date.now();
  const entry = { timestamp, level, message, details };
  if (Array.isArray(record.logs)) {
    record.logs.push(entry);
    if (record.logs.length > 200) {
      record.logs.splice(0, record.logs.length - 200);
    }
  }
  if (globalScope) {
    const console = globalScope.console;
    if (console) {
      if (level === 'error' && typeof console.error === 'function') {
        console.error('[platformer]', message, details);
      } else if (level === 'warn' && typeof console.warn === 'function') {
        console.warn('[platformer]', message, details);
      }
    }
  }
  emitBootSnapshot(message, { level, details, context: 'log' });
  return entry;
}

function snapshotCanvas(canvas) {
  const record = ensureBootRecord();
  if (!record.canvas) record.canvas = {};
  record.canvas.width = canvas?.width ?? null;
  record.canvas.height = canvas?.height ?? null;
  record.canvas.lastChange = typeof performance !== 'undefined' ? performance.now() : Date.now();
  record.canvas.attached = isCanvasAttached(canvas);
  if (record.canvas.attached) {
    record.canvas.notifiedDetached = false;
  }
  return record.canvas;
}

function isCanvasAttached(canvas) {
  if (!canvas || !globalScope?.document) return false;
  if ('isConnected' in canvas) return !!canvas.isConnected;
  return globalScope.document.contains(canvas);
}

let bootStarted = false;
let diagRafWatchTimer = 0;
let diagCanvasWatchTimer = 0;
let diagWatchCleanup = null;

if (platformerApi) {
  if (typeof platformerApi.start !== 'function') {
    platformerApi.start = () => { if (!bootStarted) boot(); };
  }
  if (typeof platformerApi.pause !== 'function') {
    platformerApi.pause = () => {};
  }
  if (typeof platformerApi.resume !== 'function') {
    platformerApi.resume = () => {};
  }
  if (typeof platformerApi.restartGame !== 'function') {
    platformerApi.restartGame = () => {};
  }
}

function stopWatchdogs() {
  if (!globalScope) return;
  if (diagWatchCleanup) {
    try { diagWatchCleanup(); } catch (_) {}
    diagWatchCleanup = null;
  }
  const record = ensureBootRecord();
  if (record.watchdogs) {
    record.watchdogs.active = false;
  }
  stopBootSnapshots();
}

function startWatchdogs(canvas) {
  if (!globalScope) return;
  stopWatchdogs();
  const record = ensureBootRecord();
  record.watchdogs = record.watchdogs || {};
  record.watchdogs.armedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const canvasSnapshot = snapshotCanvas(canvas);
  if (typeof globalScope.setInterval !== 'function') {
    record.watchdogs.active = false;
    logBoot('warn', 'Watchdog timers unavailable in this environment', {
      canvasWidth: canvasSnapshot.width,
      canvasHeight: canvasSnapshot.height,
    });
    return;
  }
  record.watchdogs.active = true;
  logBoot('info', 'Watchdogs armed', {
    canvasWidth: canvasSnapshot.width,
    canvasHeight: canvasSnapshot.height,
    attached: canvasSnapshot.attached,
  });

  let rafStalled = false;
  diagRafWatchTimer = globalScope.setInterval(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const raf = record.raf || (record.raf = {});
    const sinceStart = now - (record.phases['boot:start']?.at ?? record.createdAt ?? now);
    if (!raf.tickCount) {
      if (sinceStart > 2000 && !raf.noTickLogged) {
        raf.noTickLogged = true;
        logBoot('error', 'No animation frames after boot', { sinceStart: Math.round(sinceStart) });
      }
      return;
    }
    const lastTick = raf.lastTick || 0;
    if (!lastTick) return;
    const gap = now - lastTick;
    raf.sinceLastTick = gap;
    if (gap > 2000 && !rafStalled) {
      rafStalled = true;
      raf.stalled = true;
      logBoot('warn', 'rAF watchdog detected stall', { gap: Math.round(gap) });
    } else if (rafStalled && gap <= 1200) {
      rafStalled = false;
      raf.stalled = false;
      logBoot('info', 'rAF watchdog recovered', { gap: Math.round(gap) });
    }
  }, 1000);

  let lastSizeKey = `${canvas?.width ?? 0}x${canvas?.height ?? 0}`;
  diagCanvasWatchTimer = globalScope.setInterval(() => {
    const attached = isCanvasAttached(canvas);
    const sizeKey = `${canvas?.width ?? 0}x${canvas?.height ?? 0}`;
    if (sizeKey !== lastSizeKey) {
      lastSizeKey = sizeKey;
      const snap = snapshotCanvas(canvas);
      logBoot('info', 'Canvas size changed', {
        canvasWidth: snap.width,
        canvasHeight: snap.height,
        attached: snap.attached,
      });
    } else if (!attached && !record.canvas?.notifiedDetached) {
      if (record.canvas) record.canvas.notifiedDetached = true;
      logBoot('error', 'Canvas detached from document', { size: sizeKey });
    }
  }, 1500);

  diagWatchCleanup = () => {
    if (typeof globalScope.clearInterval === 'function') {
      globalScope.clearInterval(diagRafWatchTimer);
      globalScope.clearInterval(diagCanvasWatchTimer);
    }
    diagRafWatchTimer = 0;
    diagCanvasWatchTimer = 0;
  };

  startBootSnapshots();
}

const GRAVITY = 0.7;
const MOVE_SPEED = 4;
const JUMP_FORCE = 13;
const STATE_INTERVAL = 90; // ms

const KEY_LEFT = ['arrowleft', 'a'];
const KEY_RIGHT = ['arrowright', 'd'];
const KEY_JUMP = ['space', 'spacebar', 'arrowup', 'w'];
const PLAYER_RUN_FRAME_DURATION = 100; // ms between run frames
const PLAYER_MOVE_EPSILON = 0.05;

const PARALLAX_LAYER_CONFIG = [
  { src: '/assets/backgrounds/parallax/forest_layer1.png', factor: 0.1 },
  { src: '/assets/backgrounds/parallax/forest_layer2.png', factor: 0.25 },
];

const PLAYER_SPRITE_SPECS = {
  idle: { src: '/assets/sprites/player/platformer_idle.png', frameWidth: 16, frameHeight: 16, frames: 1 },
  run: { src: '/assets/sprites/player/platformer_run.png', frameWidth: 16, frameHeight: 16, frames: 8 },
  jump: { src: '/assets/sprites/player/platformer_jump.png', frameWidth: 16, frameHeight: 16, frames: 1 },
};

const COIN_SPRITE = tiles['2']?.sprite ?? null;
const GOAL_SPRITE = tiles['3']?.sprite ?? null;
const COIN_FRAME = COIN_SPRITE?.frame ?? getSpriteFrame('coin');
const GOAL_FRAME = GOAL_SPRITE?.frame ?? getSpriteFrame('goal');
const CHECKPOINT_FRAME = getSpriteFrame('checkpoint');
const CHECKPOINT_SPRITE = CHECKPOINT_FRAME
  ? { key: 'checkpoint', frame: CHECKPOINT_FRAME }
  : null;

const LEGACY_COIN_SIZE = 18;
const COIN_LAYOUT = [
  { id: 'coin-0', cx: 259, centerOffset: 163 },
  { id: 'coin-1', cx: 579, centerOffset: 223 },
  { id: 'coin-2', cx: 649, centerOffset: 53 },
  { id: 'coin-3', cx: 799, centerOffset: 113 },
];

function normKey(key) {
  if (key === ' ') return 'space';
  return key.toLowerCase();
}

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function createPlatforms(width, groundY) {
  return [
    { x: 0, y: groundY, w: 260, h: 60 },
    { x: 340, y: groundY, w: width - 340, h: 60 },
    { x: 220, y: groundY - 140, w: 130, h: 16 },
    { x: 520, y: groundY - 210, w: 160, h: 16 },
    { x: 720, y: groundY - 90, w: 140, h: 16 },
    { x: 600, y: groundY - 40, w: 70, h: 12 }
  ];
}

function createCoins(groundY) {
  const width = COIN_FRAME?.sw ?? LEGACY_COIN_SIZE;
  const height = COIN_FRAME?.sh ?? LEGACY_COIN_SIZE;
  return COIN_LAYOUT.map(({ id, cx, centerOffset }) => {
    const centerY = groundY - centerOffset;
    return {
      id,
      x: cx - width / 2,
      y: centerY - height / 2,
      w: width,
      h: height,
      collected: false,
      sprite: COIN_SPRITE,
    };
  });
}

function createGoal(groundY, width) {
  const goalWidth = GOAL_FRAME?.sw ?? 50;
  const goalHeight = GOAL_FRAME?.sh ?? 120;
  const goalCenterX = width - 65;
  const goal = {
    x: goalCenterX - goalWidth / 2,
    y: groundY - goalHeight,
    w: goalWidth,
    h: goalHeight,
  };
  if (GOAL_SPRITE) goal.sprite = GOAL_SPRITE;
  return goal;
}

function createCheckpoint(groundY) {
  if (!CHECKPOINT_SPRITE) return null;
  const width = CHECKPOINT_FRAME?.sw ?? 32;
  const height = CHECKPOINT_FRAME?.sh ?? 48;
  const centerX = 140;
  return {
    x: centerX - width / 2,
    y: groundY - height,
    w: width,
    h: height,
    sprite: CHECKPOINT_SPRITE,
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function boot() {
  const record = ensureBootRecord();
  record.bootInvokedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (bootStarted) {
    logBoot('warn', 'boot() called after initialization', { ignored: true });
    return;
  }
  bootStarted = true;
  markPhase('boot:start');

  if (!globalScope?.document) {
    logBoot('error', 'boot() called without document context');
    markPhase('boot:error', { reason: 'no-document' });
    return;
  }

  const canvas = globalScope.document.getElementById('game');
  if (!canvas) {
    logBoot('error', 'Missing #game canvas', { selector: '#game' });
    markPhase('boot:error', { reason: 'missing-canvas' });
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    logBoot('error', 'Failed to acquire 2d context on #game canvas');
    markPhase('boot:error', { reason: 'no-2d-context' });
    return;
  }
  const assetCache = new Map();
  const parallaxLayers = PARALLAX_LAYER_CONFIG.map(({ src, factor }) => ({
    src,
    factor,
    image: null,
  }));
  const playerSprites = Object.entries(PLAYER_SPRITE_SPECS).reduce((acc, [key, spec]) => {
    acc[key] = { ...spec, image: null, strip: null };
    return acc;
  }, {});
  const playerRunState = {
    local: { frame: 0, lastAdvance: 0 },
    remote: { frame: 0, lastAdvance: 0 },
  };

  function loadImageAsset(src) {
    const existing = assetCache.get(src);
    if (existing) {
      if (existing.image) return Promise.resolve(existing.image);
      return existing.promise;
    }
    if (!globalScope?.Image) return Promise.resolve(null);
    const img = new globalScope.Image();
    try {
      img.decoding = 'async';
    } catch (_) {
      /* noop */
    }
    if ('loading' in img) {
      img.loading = 'eager';
    }
    const promise = new Promise((resolve) => {
      img.onload = () => {
        assetCache.set(src, { image: img });
        resolve(img);
      };
      img.onerror = () => {
        assetCache.delete(src);
        resolve(null);
      };
    });
    assetCache.set(src, { promise });
    img.src = src;
    return promise;
  }

  function cachedImage(src) {
    const entry = assetCache.get(src);
    return entry?.image ?? null;
  }

  function preloadParallaxLayers() {
    return Promise.all(
      parallaxLayers.map((layer) =>
        loadImageAsset(layer.src).then((img) => {
          layer.image = img;
          return img;
        }),
      ),
    );
  }

  function ensureStripForSpec(spec) {
    if (!spec) return Promise.resolve(null);
    if (spec.strip) return Promise.resolve(spec.strip);
    return loadStrip(spec.src, spec.frameWidth, spec.frameHeight, { slug: GAME_ID })
      .then((strip) => {
        spec.strip = strip;
        spec.image = strip.image;
        if (typeof spec.frames !== 'number' || spec.frames <= 0) {
          spec.frames = strip.frameCount;
        }
        assetCache.set(spec.src, { image: strip.image });
        return strip;
      });
  }

  function preloadPlayerSprites() {
    return Promise.all(
      Object.values(playerSprites).map((spec) =>
        ensureStripForSpec(spec).catch(() => null),
      ),
    );
  }

  let blockPattern = null;
  let lavaPattern = null;
  const hydratePatterns = () => {
    if (!blockPattern) {
      const next = getTilePattern(ctx, 'block');
      if (next) blockPattern = next;
    }
    if (!lavaPattern) {
      const next = getTilePattern(ctx, 'lava');
      if (next) lavaPattern = next;
    }
  };
  preloadTileTextures().then(() => {
    hydratePatterns();
  }).catch(() => {});
  preloadParallaxLayers().catch(() => {});
  preloadPlayerSprites().catch(() => {});
  const VIRTUAL_WIDTH = 960;
  const VIRTUAL_HEIGHT = 540;
  let cssWidth = VIRTUAL_WIDTH;
  let cssHeight = VIRTUAL_HEIGHT;
  let renderScale = 1;
  let renderOffsetX = 0;
  let renderOffsetY = 0;
  let dpr = globalScope?.devicePixelRatio && Number.isFinite(globalScope.devicePixelRatio)
    ? globalScope.devicePixelRatio
    : 1;
  function resizeCanvas() {
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect()
      : null;
    cssWidth = rect && rect.width > 0 ? rect.width : VIRTUAL_WIDTH;
    cssHeight = rect && rect.height > 0 ? rect.height : VIRTUAL_HEIGHT;
    dpr = globalScope?.devicePixelRatio && Number.isFinite(globalScope.devicePixelRatio)
      ? globalScope.devicePixelRatio
      : 1;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scaleX = cssWidth / VIRTUAL_WIDTH;
    const scaleY = cssHeight / VIRTUAL_HEIGHT;
    // Uniformly scale the virtual playfield dimensions, leaving centered letterbox offsets.
    renderScale = Math.min(scaleX, scaleY);
    const scaledWidth = VIRTUAL_WIDTH * renderScale;
    const scaledHeight = VIRTUAL_HEIGHT * renderScale;
    renderOffsetX = (cssWidth - scaledWidth) / 2;
    renderOffsetY = (cssHeight - scaledHeight) / 2;
    if (!Number.isFinite(renderScale) || renderScale <= 0) {
      renderScale = 1;
      renderOffsetX = 0;
      renderOffsetY = 0;
    }
    snapshotCanvas(canvas);
  }

  resizeCanvas();
  markPhase('boot:canvas-ready', {
    width: canvas.width,
    height: canvas.height,
    attached: isCanvasAttached(canvas),
  });
  startWatchdogs(canvas);

  const handleResize = () => {
    resizeCanvas();
  };
  // Keep the shell layout responsive by resizing with the window.
  window.addEventListener('resize', handleResize);

  const W = VIRTUAL_WIDTH;
  const H = VIRTUAL_HEIGHT;
  const groundY = H - 60;
  let postedReady = false;

  const OVERLAY_FADE_MS = 220;

  function buildPlatformerOverlay(existingRoot) {
    let root = existingRoot;
    if (!root) {
      root = document.createElement('div');
      document.body.appendChild(root);
    }
    root.className = 'platformer-overlay';
    root.dataset.scene = '';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '';

    const makeButton = (label, id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'platformer-overlay__btn';
      if (id) btn.id = id;
      btn.textContent = label;
      return btn;
    };

    const titlePanel = document.createElement('div');
    titlePanel.className = 'platformer-overlay__panel';
    titlePanel.dataset.scene = 'title';
    const titleHeading = document.createElement('h2');
    titleHeading.className = 'platformer-overlay__heading';
    titleHeading.textContent = 'Retro Platformer';
    const titleInfo = document.createElement('p');
    titleInfo.className = 'platformer-overlay__text';
    titleInfo.id = 'platformer-overlay-title';
    const titleActions = document.createElement('div');
    titleActions.className = 'platformer-overlay__actions';
    const titleStart = makeButton('Start Adventure', 'platformer-overlay-start');
    titleActions.append(titleStart);
    titlePanel.append(titleHeading, titleInfo, titleActions);

    const pausePanel = document.createElement('div');
    pausePanel.className = 'platformer-overlay__panel';
    pausePanel.dataset.scene = 'pause';
    const pauseHeading = document.createElement('h2');
    pauseHeading.className = 'platformer-overlay__heading';
    pauseHeading.textContent = 'Paused';
    const pauseInfo = document.createElement('p');
    pauseInfo.className = 'platformer-overlay__text';
    pauseInfo.id = 'platformer-overlay-pause';
    const pauseActions = document.createElement('div');
    pauseActions.className = 'platformer-overlay__actions';
    const pauseResume = makeButton('Resume', 'platformer-overlay-resume');
    const pauseRestart = makeButton('Restart', 'platformer-overlay-restart');
    const pauseMenu = makeButton('Main Menu', 'platformer-overlay-menu');
    pauseActions.append(pauseResume, pauseRestart, pauseMenu);
    pausePanel.append(pauseHeading, pauseInfo, pauseActions);

    const gameoverPanel = document.createElement('div');
    gameoverPanel.className = 'platformer-overlay__panel';
    gameoverPanel.dataset.scene = 'gameover';
    const gameoverHeading = document.createElement('h2');
    gameoverHeading.className = 'platformer-overlay__heading';
    gameoverHeading.id = 'platformer-overlay-gameover-heading';
    const gameoverInfo = document.createElement('p');
    gameoverInfo.className = 'platformer-overlay__text';
    gameoverInfo.id = 'platformer-overlay-gameover-detail';
    const gameoverScore = document.createElement('p');
    gameoverScore.className = 'platformer-overlay__score';
    gameoverScore.id = 'platformer-overlay-gameover-score';
    const gameoverActions = document.createElement('div');
    gameoverActions.className = 'platformer-overlay__actions';
    const gameoverRestart = makeButton('Play Again', 'platformer-overlay-gameover-restart');
    const gameoverMenu = makeButton('Main Menu', 'platformer-overlay-gameover-menu');
    const gameoverShare = makeButton('Share Run', 'shareBtn');
    gameoverActions.append(gameoverRestart, gameoverMenu, gameoverShare);
    gameoverPanel.append(gameoverHeading, gameoverInfo, gameoverScore, gameoverActions);

    root.append(titlePanel, pausePanel, gameoverPanel);

    return {
      root,
      title: { panel: titlePanel, info: titleInfo, startBtn: titleStart },
      pause: { panel: pausePanel, info: pauseInfo, resumeBtn: pauseResume, restartBtn: pauseRestart, menuBtn: pauseMenu },
      gameover: {
        panel: gameoverPanel,
        heading: gameoverHeading,
        detail: gameoverInfo,
        score: gameoverScore,
        restartBtn: gameoverRestart,
        menuBtn: gameoverMenu,
        shareBtn: gameoverShare,
      },
    };
  }

  const overlayElements = buildPlatformerOverlay(document.getElementById('overlay'));
  const overlayRoot = overlayElements?.root;
  const shareBtn = overlayElements?.gameover?.shareBtn;
  const startCoopBtn = document.getElementById('startCoop');
  const connStatus = document.getElementById('connStatus');
  const netHud = document.getElementById('netHud');
  const hud = document.querySelector('.hud');
  const defaultShareLabel = shareBtn?.textContent?.trim() ?? 'Share';
  const titleControls = overlayElements?.title;
  const pauseControls = overlayElements?.pause;
  const gameoverControls = overlayElements?.gameover;

  function setOverlayScene(kind) {
    if (!overlayRoot) return;
    overlayRoot.dataset.scene = kind || '';
    overlayRoot.setAttribute('aria-hidden', kind ? 'false' : 'true');
  }

  function animateOverlayVisibility(kind, immediate = false) {
    if (!overlayRoot) return Promise.resolve();
    if (immediate) {
      if (kind) overlayRoot.classList.add('show');
      else overlayRoot.classList.remove('show');
      return Promise.resolve();
    }
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        overlayRoot.removeEventListener('transitionend', onEnd);
        resolve();
      };
      const onEnd = event => {
        if (event.target === overlayRoot) finish();
      };
      overlayRoot.addEventListener('transitionend', onEnd);
      requestAnimationFrame(() => {
        if (kind) overlayRoot.classList.add('show');
        else overlayRoot.classList.remove('show');
      });
      setTimeout(finish, OVERLAY_FADE_MS + 120);
    });
  }

  function updateTitleOverlay() {
    if (!titleControls?.info) return;
    titleControls.info.textContent = 'Collect all coins and reach the goal. Press P to pause, R to restart.';
  }

  function updatePauseOverlay(reason = 'user') {
    if (!pauseControls?.info) return;
    pauseControls.info.textContent = reason === 'shell'
      ? 'Paused by system overlay. Return to resume.'
      : 'Take a breather, hero!';
    if (pauseControls.resumeBtn) {
      pauseControls.resumeBtn.disabled = reason === 'shell';
    }
  }

  function updateGameOverOverlay(data = {}) {
    if (!gameoverControls) return;
    const title = data.title || 'Run Complete';
    const info = data.info || '';
    if (gameoverControls.heading) gameoverControls.heading.textContent = title;
    if (gameoverControls.detail) gameoverControls.detail.textContent = info;
    if (gameoverControls.score) {
      const coins = Number.isFinite(data.coins) ? data.coins : (localPlayer?.collected ?? 0);
      const totalCoins = Number.isFinite(data.totalCoins)
        ? data.totalCoins
        : Number.isFinite(data.coins)
          ? data.coins + Math.max(0, data.missed ?? 0)
          : coins;
      const coinsLabel = Number.isFinite(totalCoins) && totalCoins >= coins
        ? `${coins}/${totalCoins}`
        : String(coins);
      const timeText = Number.isFinite(data.time)
        ? `Time ${data.time.toFixed(2)}s`
        : `Time ${secondsElapsed().toFixed(2)}s`;
      gameoverControls.score.textContent = `Coins ${coinsLabel} • ${timeText}`;
    }
  }

  function showOverlay(kind, data = {}, immediate = false) {
    if (kind === 'title') updateTitleOverlay();
    if (kind === 'pause') updatePauseOverlay(data.reason);
    if (kind === 'gameover') updateGameOverOverlay(data);
    setOverlayScene(kind);
    return animateOverlayVisibility(kind, immediate);
  }

  function hideOverlay(immediate = false) {
    setOverlayScene(null);
    return animateOverlayVisibility(null, immediate);
  }

  const scenes = createSceneManager({ id: 'platformer-scenes' });

  function dispatchAction(action, payload) {
    try {
      return scenes.handle(action, payload);
    } catch (err) {
      console.error('[platformer] dispatch action failed', err);
      return false;
    }
  }

  titleControls?.startBtn?.addEventListener('click', () => dispatchAction('start', { source: 'ui' }));
  pauseControls?.resumeBtn?.addEventListener('click', () => dispatchAction('resume', { source: 'ui' }));
  pauseControls?.restartBtn?.addEventListener('click', () => dispatchAction('restart', { source: 'ui' }));
  pauseControls?.menuBtn?.addEventListener('click', () => dispatchAction('menu', { source: 'ui' }));
  gameoverControls?.restartBtn?.addEventListener('click', () => dispatchAction('restart', { source: 'ui' }));
  gameoverControls?.menuBtn?.addEventListener('click', () => dispatchAction('menu', { source: 'ui' }));
  gameoverControls?.shareBtn?.addEventListener('click', () => shareRun());
  const defaultCoopLabel = startCoopBtn?.textContent?.trim() ?? 'Start Co-op';

  function applyPause(reason = 'user', opts = {}) {
    const { emitEvent = true } = opts || {};
    pauseReason = reason;
    paused = true;
    setAudioPaused(true);
    if (net.isConnected()) sendState();
    if (emitEvent) emitState('paused', { reason });
  }

  function applyResume(opts = {}) {
    const { emitEvent = true } = opts || {};
    paused = false;
    pauseReason = 'user';
    setAudioPaused(false);
    lastFrame = performance.now();
    if (net.isConnected()) sendState();
    if (emitEvent) emitState('running');
  }

  function initializeScenes() {
    scenes.clear({ transition: null }).catch(() => {});
    scenes.push(() => createTitleScene()).catch(err => {
      console.error('[platformer] failed to enter title scene', err);
    });
  }

  function createTitleScene() {
    return {
      id: 'title',
      transition: {
        enter: () => showOverlay('title', {}, true),
        exit: () => hideOverlay(),
      },
      onEnter(ctx) {
        resetState({ autoStart: false });
        gameOver = false;
        pausedByShell = false;
        pauseReason = 'menu';
        updateTitleOverlay();
        ctx.setInputs({
          async start(currentCtx) {
            try {
              await currentCtx.manager.replace(() => createGameScene({ reset: true, reason: 'start' }));
            } catch (err) {
              console.error('[platformer] start failed', err);
            }
          },
          pause() {},
          async resume(currentCtx) {
            try {
              await currentCtx.manager.replace(() => createGameScene({ reset: true, reason: 'start' }));
            } catch (err) {
              console.error('[platformer] start failed', err);
            }
          },
          async restart(currentCtx) {
            try {
              await currentCtx.manager.replace(() => createGameScene({ reset: true, reason: 'start' }));
            } catch (err) {
              console.error('[platformer] start failed', err);
            }
          },
          menu() {},
          gameover() {},
        });
      },
    };
  }

  function createGameScene(options = {}) {
    return {
      id: 'gameplay',
      transition: {
        enter: () => hideOverlay(),
        resume: () => hideOverlay(),
      },
      onEnter(ctx) {
        const shouldReset = options.reset !== false;
        const reason = options.reason || 'resume';
        if (shouldReset) {
          resetState({ autoStart: false });
          if (net.isConnected()) {
            net.sendAssist();
            sendState();
          }
          if (reason === 'start') {
            emitState('start', { reason });
          } else {
            emitState('restart', { reason });
            emitScore('reset', { reason });
          }
        }
        gameOver = false;
        pausedByShell = false;
        pauseReason = 'user';
        applyResume();
        ctx.setInputs({
          async pause(currentCtx, info) {
            const reason = info?.reason === 'shell' ? 'shell' : 'user';
            try {
              await currentCtx.manager.push(() => createPauseScene({ reason }));
            } catch (err) {
              console.error('[platformer] pause failed', err);
            }
          },
          resume() {},
          async start(currentCtx, info) {
            const reason = info?.reason === 'shell' ? 'shell' : 'user';
            try {
              await currentCtx.manager.push(() => createPauseScene({ reason }));
            } catch (err) {
              console.error('[platformer] pause failed', err);
            }
          },
          async restart(currentCtx) {
            try {
              await currentCtx.manager.replace(() => createGameScene({ reset: true, reason: 'restart' }));
            } catch (err) {
              console.error('[platformer] restart failed', err);
            }
          },
          async menu(currentCtx) {
            try {
              await currentCtx.manager.replace(() => createTitleScene());
            } catch (err) {
              console.error('[platformer] menu failed', err);
            }
          },
          async gameover(currentCtx, details) {
            try {
              await currentCtx.manager.push(() => createGameOverScene(details || {}));
            } catch (err) {
              console.error('[platformer] gameover scene failed', err);
            }
          },
        });
      },
      onResume() {
        applyResume();
      },
      onExit() {
        setAudioPaused(true);
      },
    };
  }

  function createPauseScene({ reason = 'user' } = {}) {
    let currentReason = reason;
    return {
      id: 'pause',
      transition: {
        enter: () => showOverlay('pause', { reason: currentReason }),
        exit: () => hideOverlay(),
      },
      onEnter(ctx) {
        applyPause(currentReason, { emitEvent: currentReason !== 'shell' });
        ctx.setInputs({
          async pause(currentCtx, info) {
            if (info?.reason === 'shell') {
              currentReason = 'shell';
              updatePauseOverlay(currentReason);
              pauseReason = currentReason;
              return;
            }
            try {
              await currentCtx.manager.pop();
            } catch (err) {
              console.error('[platformer] resume failed', err);
            }
          },
          async resume(currentCtx, info) {
            if (currentReason === 'shell' && info?.source !== 'shell') return;
            try {
              await currentCtx.manager.pop();
            } catch (err) {
              console.error('[platformer] resume failed', err);
            }
          },
          async start(currentCtx, info) {
            if (currentReason === 'shell' && info?.source !== 'shell') return;
            try {
              await currentCtx.manager.pop();
            } catch (err) {
              console.error('[platformer] resume failed', err);
            }
          },
          async restart(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => createGameScene({ reset: true, reason: 'restart' }));
            } catch (err) {
              console.error('[platformer] restart failed', err);
            }
          },
          async menu(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => createTitleScene());
            } catch (err) {
              console.error('[platformer] menu failed', err);
            }
          },
          async gameover(currentCtx, details) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.push(() => createGameOverScene(details || {}));
            } catch (err) {
              console.error('[platformer] pause -> gameover failed', err);
            }
          },
        });
      },
      onExit() {
        pauseReason = 'user';
      },
    };
  }

  function createGameOverScene(details = {}) {
    const payload = { ...details };
    return {
      id: 'gameover',
      transition: {
        enter: () => showOverlay('gameover', payload),
        exit: () => hideOverlay(),
      },
      onEnter(ctx) {
        pauseReason = 'gameover';
        updateGameOverOverlay(payload);
        ctx.setInputs({
          async start(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => createGameScene({ reset: true, reason: 'restart' }));
            } catch (err) {
              console.error('[platformer] restart failed', err);
            }
          },
          async restart(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => createGameScene({ reset: true, reason: 'restart' }));
            } catch (err) {
              console.error('[platformer] restart failed', err);
            }
          },
          async pause(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => createGameScene({ reset: true, reason: 'restart' }));
            } catch (err) {
              console.error('[platformer] restart failed', err);
            }
          },
          async resume(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
            } catch (err) {
              console.error('[platformer] dismiss gameover failed', err);
            }
          },
          async menu(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => createTitleScene());
            } catch (err) {
              console.error('[platformer] return to menu failed', err);
            }
          },
          gameover() {},
        });
      },
      onExit() {
        pauseReason = 'user';
      },
    };
  }

  if (hud && !hud.dataset.platformerAugmented) {
    hud.dataset.platformerAugmented = 'true';
    const extra = document.createElement('div');
    extra.style.marginTop = '6px';
    extra.style.fontSize = '12px';
    extra.style.color = '#9fb3d0';
    extra.textContent = 'Co-op works in another open tab of this site. Share uses your browser\'s share/clipboard permissions.';
    hud.appendChild(extra);
  }

  const platforms = createPlatforms(W, groundY);
  let coins = createCoins(groundY);
  const goal = createGoal(groundY, W);
  const checkpoint = createCheckpoint(groundY);

  const localPlayer = {
    x: 100,
    y: groundY - 40,
    w: 28,
    h: 40,
    vx: 0,
    vy: 0,
    onGround: true,
    facing: 1,
    collected: 0,
  };

  const remotePlayer = {
    x: 100,
    y: groundY - 40,
    w: 28,
    h: 40,
    facing: 1,
    onGround: false,
    vx: 0,
    vy: 0,
    coins: 0,
    lastSeen: 0,
    active: false,
    gameOver: false,
  };

  function imageForSpec(spec) {
    if (!spec) return null;
    if (!spec.strip) {
      ensureStripForSpec(spec).catch(() => {});
    }
    return spec.image || cachedImage(spec.src) || null;
  }

  function advanceRunAnimation(trackKey, now, spec, moving) {
    const state = playerRunState[trackKey];
    if (!state) return 0;
    const totalFrames = Math.max(1, spec?.frames || spec?.strip?.frameCount || 1);
    if (!moving || totalFrames <= 1) {
      state.frame = 0;
      state.lastAdvance = now;
      return 0;
    }
    if (now - state.lastAdvance >= PLAYER_RUN_FRAME_DURATION) {
      state.frame = (state.frame + 1) % totalFrames;
      state.lastAdvance = now;
    }
    return state.frame;
  }

  function drawPlayerCharacter(player, trackKey, now, fallbackColor) {
    const moving = Math.abs(player.vx ?? 0) > PLAYER_MOVE_EPSILON;
    const airborne = !player.onGround;
    let spriteKey = 'idle';
    if (airborne) {
      spriteKey = 'jump';
    } else if (moving) {
      spriteKey = 'run';
    }
    const spec = playerSprites[spriteKey];
    const image = imageForSpec(spec);
    const strip = spec?.strip;
    const frameWidth = strip?.frameWidth ?? spec?.frameWidth ?? player.w;
    const frameHeight = strip?.frameHeight ?? spec?.frameHeight ?? player.h;
    let sx = 0;
    if (spriteKey === 'run') {
      const frameIndex = advanceRunAnimation(trackKey, now, spec, moving);
      sx = frameIndex * frameWidth;
    } else {
      advanceRunAnimation(trackKey, now, spec, false);
    }
    if (!image) {
      ctx.fillStyle = fallbackColor || '#1c1c1c';
      ctx.fillRect(player.x, player.y, player.w, player.h);
      return false;
    }
    ctx.save();
    if (player.facing === -1) {
      ctx.translate(player.x + player.w, player.y);
      ctx.scale(-1, 1);
      ctx.drawImage(image, sx, 0, frameWidth, frameHeight, 0, 0, player.w, player.h);
    } else {
      ctx.drawImage(image, sx, 0, frameWidth, frameHeight, player.x, player.y, player.w, player.h);
    }
    ctx.restore();
    return true;
  }

  function drawParallaxBackground() {
    for (const layer of parallaxLayers) {
      const image = layer.image || cachedImage(layer.src);
      if (!image) continue;
      const sourceWidth = image.naturalWidth || image.width || 0;
      const sourceHeight = image.naturalHeight || image.height || 0;
      if (!sourceWidth || !sourceHeight) continue;
      const scale = H / sourceHeight;
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      if (!drawWidth || !drawHeight) continue;
      let offset = (localPlayer.x * layer.factor) % drawWidth;
      if (offset < 0) offset += drawWidth;
      let drawX = -offset;
      const drawY = H - drawHeight;
      while (drawX < W) {
        ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
        drawX += drawWidth;
      }
    }
  }

  if (platformerApi) {
    platformerApi.localPlayer = localPlayer;
    platformerApi.coins = coins;
    platformerApi.goal = goal;
    platformerApi.checkpoint = checkpoint;
  }

  let paused = false;
  let pausedByShell = false;
  let gameOver = false;
  let pauseReason = 'user';
  const lastGameOver = { title: '', info: '', coins: 0, totalCoins: 0, time: 0 };
  let finalTime = null;
  let rafId = 0;
  let lastFrame = performance.now();
  let sendTimer = 0;
  let runStart = performance.now();
  let shareResetTimer = 0;
  let coopRetryTimer = 0;

  const keys = new Set();

  function resetState(opts = {}) {
    const { autoStart = true } = opts || {};
    localPlayer.x = 100;
    localPlayer.y = groundY - localPlayer.h;
    localPlayer.vx = 0;
    localPlayer.vy = 0;
    localPlayer.onGround = true;
    localPlayer.facing = 1;
    localPlayer.collected = 0;
    coins = createCoins(groundY);
    if (platformerApi) {
      platformerApi.coins = coins;
    }
    const now = performance.now();
    playerRunState.local.frame = 0;
    playerRunState.local.lastAdvance = now;
    playerRunState.remote.frame = 0;
    playerRunState.remote.lastAdvance = now;
    gameOver = false;
    paused = !autoStart;
    pauseReason = autoStart ? 'user' : 'menu';
    setAudioPaused(!autoStart ? true : false);
    finalTime = null;
    runStart = performance.now();
    keys.clear();
    if (connStatus) connStatus.textContent = net.isConnected() ? connectionLabel() : 'Offline';
    clearTimeout(shareResetTimer);
    shareResetTimer = 0;
    if (shareBtn) {
      shareBtn.textContent = defaultShareLabel;
      shareBtn.style.pointerEvents = 'auto';
      shareBtn.removeAttribute('aria-disabled');
    }
  }

  function secondsElapsed() {
    const end = finalTime ?? performance.now();
    return Math.max(0, (end - runStart) / 1000);
  }

  function stateSnapshot(type, extra = {}) {
    return {
      type,
      timestamp: Date.now(),
      paused,
      gameOver,
      collected: localPlayer.collected,
      totalCoins: coins.length,
      time: secondsElapsed(),
      ...extra,
    };
  }

  function scoreSnapshot(type, extra = {}) {
    return {
      type,
      timestamp: Date.now(),
      collected: localPlayer.collected,
      totalCoins: coins.length,
      time: secondsElapsed(),
      ...extra,
    };
  }

  function emitState(type, extra = {}) {
    notifyPlatformerCallbacks('onState', stateSnapshot(type, extra));
  }

  function emitScore(type, extra = {}) {
    notifyPlatformerCallbacks('onScore', scoreSnapshot(type, extra));
  }

  function triggerGameOver(title, info) {
    if (gameOver) return;
    playSfx('powerdown', { allowWhilePaused: true });
    gameOver = true;
    paused = true;
    pauseReason = 'gameover';
    setAudioPaused(true);
    finalTime = performance.now();
    lastGameOver.title = title;
    lastGameOver.info = info;
    lastGameOver.coins = localPlayer.collected;
    lastGameOver.totalCoins = coins.length;
    lastGameOver.time = secondsElapsed();
    if (net.isConnected()) sendState();
    emitState('gameover', { title, info });
    emitScore('final', { title, info });
    dispatchAction('gameover', {
      source: 'engine',
      title,
      info,
      coins: localPlayer.collected,
      totalCoins: coins.length,
      time: secondsElapsed(),
    });
  }

  function togglePause(forceState, options = {}) {
    if (gameOver) return;
    const next = typeof forceState === 'boolean' ? forceState : !paused;
    if (next === paused) return;
    const source = options.source || 'keyboard';
    const reason = options.reason || 'user';
    if (next) {
      dispatchAction('pause', { source, reason });
    } else {
      dispatchAction('resume', { source });
    }
  }

  function restartGame(source = 'ui') {
    dispatchAction('restart', { source });
  }

  if (platformerApi) {
    platformerApi.start = () => {
      if (!bootStarted) {
        boot();
        return;
      }
      if (gameOver) {
        restartGame('api');
      } else if (paused) {
        togglePause(false, { source: 'api' });
      }
    };
    platformerApi.pause = () => {
      if (!gameOver) togglePause(true, { source: 'api', reason: 'user' });
    };
    platformerApi.resume = () => {
      if (!gameOver) togglePause(false, { source: 'api' });
    };
    platformerApi.restartGame = () => {
      restartGame('api');
    };
    platformerApi.localPlayer = localPlayer;
    platformerApi.coins = coins;
    platformerApi.goal = goal;
  }

  function shareRun() {
    if (!shareBtn) return;
    const coinsInfo = `${localPlayer.collected}/${coins.length}`;
    const seconds = secondsElapsed().toFixed(1);
    const cleared = gameOver && (lastGameOver.title || '').toLowerCase().includes('clear');
    const result = cleared ? 'cleared the stage' : 'took a spill';
    const text = `I ${result} in Retro Platformer with ${coinsInfo} coins in ${seconds}s! ${location.href}`;

    shareBtn.style.pointerEvents = 'none';
    shareBtn.setAttribute('aria-disabled', 'true');
    const resetShare = () => {
      shareBtn.style.pointerEvents = 'auto';
      shareBtn.removeAttribute('aria-disabled');
      shareBtn.textContent = defaultShareLabel;
    };

    const doResetLater = () => {
      clearTimeout(shareResetTimer);
      shareResetTimer = window.setTimeout(resetShare, 2500);
    };

    if (navigator.share) {
      navigator.share({ title: 'Retro Platformer', text, url: location.href })
        .then(() => {
          shareBtn.textContent = 'Shared!';
          doResetLater();
        })
        .catch(() => {
          shareBtn.textContent = 'Share cancelled';
          doResetLater();
        });
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          shareBtn.textContent = 'Link copied!';
          doResetLater();
        })
        .catch(() => {
          shareBtn.textContent = 'Copy failed';
          doResetLater();
        });
    } else {
      alert(text);
      shareBtn.textContent = 'Shared!';
      doResetLater();
    }
  }

  function connectionLabel() {
    return net.amHost() ? 'Co-op (Host)' : 'Co-op (Guest)';
  }

  function markCoin(id) {
    const coin = coins.find(c => c.id === id);
    if (coin && !coin.collected) {
      coin.collected = true;
      localPlayer.collected = coins.filter(c => c.collected).length;
      emitScore('collect', { coinId: coin.id, source: 'remote' });
      emitState('collect', { coinId: coin.id, source: 'remote' });
    }
  }

  function setRemoteCoins(ids) {
    if (!Array.isArray(ids)) return;
    let changed = false;
    for (const coin of coins) {
      if (ids.includes(coin.id) && !coin.collected) {
        coin.collected = true;
        changed = true;
      }
    }
    if (changed) {
      localPlayer.collected = coins.filter(c => c.collected).length;
      emitScore('collect', { source: 'remote-sync', coinIds: ids.slice() });
      emitState('collect', { source: 'remote-sync', coinIds: ids.slice() });
    }
  }

  function sendState() {
    if (!net.isConnected()) return;
    net.sendState({
      x: localPlayer.x,
      y: localPlayer.y,
      vx: localPlayer.vx,
      vy: localPlayer.vy,
      facing: localPlayer.facing,
      onGround: localPlayer.onGround,
      collected: coins.filter(c => c.collected).map(c => c.id),
      gameOver,
      paused,
      time: secondsElapsed(),
    });
  }

  function handleRemoteState(data) {
    if (!data) return;
    if (Number.isFinite(data.x)) remotePlayer.x = data.x;
    if (Number.isFinite(data.y)) remotePlayer.y = data.y;
    remotePlayer.facing = data.facing === -1 ? -1 : 1;
    remotePlayer.onGround = !!data.onGround;
    remotePlayer.vx = Number.isFinite(data.vx) ? data.vx : 0;
    remotePlayer.vy = Number.isFinite(data.vy) ? data.vy : 0;
    remotePlayer.coins = Array.isArray(data.collected) ? data.collected.length : remotePlayer.coins;
    remotePlayer.gameOver = !!data.gameOver;
    remotePlayer.lastSeen = performance.now();
    remotePlayer.active = true;
    setRemoteCoins(data.collected);
  }

  function handleRemoteCollect(data) {
    if (!data) return;
    markCoin(data.id);
  }

  function handleAssist() {
    if (gameOver) {
      restartGame('network');
    } else if (paused) {
      togglePause(false, { source: 'network' });
    }
  }

  function initNet() {
    if (!startCoopBtn || !connStatus) return;

    if (!net.isAvailable()) {
      startCoopBtn.textContent = 'Co-op unavailable';
      startCoopBtn.style.pointerEvents = 'none';
      startCoopBtn.style.opacity = '0.7';
      startCoopBtn.setAttribute('aria-disabled', 'true');
      startCoopBtn.title = 'Co-op mode requires BroadcastChannel support';
      connStatus.textContent = 'Unavailable';
      return;
    }

    startCoopBtn.addEventListener('click', () => {
      if (net.isConnected()) return;
      startCoopBtn.textContent = 'Pairing…';
      startCoopBtn.style.pointerEvents = 'none';
      startCoopBtn.style.opacity = '0.7';
      startCoopBtn.setAttribute('aria-disabled', 'true');
      connStatus.textContent = 'Pairing…';
      net.connect();
      clearTimeout(coopRetryTimer);
      coopRetryTimer = window.setTimeout(() => {
        if (!net.isConnected()) {
          startCoopBtn.textContent = defaultCoopLabel;
          startCoopBtn.style.pointerEvents = 'auto';
          startCoopBtn.style.opacity = '1';
          startCoopBtn.removeAttribute('aria-disabled');
          connStatus.textContent = 'Offline';
        }
      }, 4000);
    });

    net.on('connect', () => {
      clearTimeout(coopRetryTimer);
      connStatus.textContent = connectionLabel();
      startCoopBtn.textContent = 'Connected';
      startCoopBtn.style.pointerEvents = 'none';
      startCoopBtn.style.opacity = '0.7';
      startCoopBtn.setAttribute('aria-disabled', 'true');
      remotePlayer.active = false;
      sendState();
    });

    net.on('state', data => handleRemoteState(data));
    net.on('collect', data => handleRemoteCollect(data));
    net.on('assist', () => handleAssist());

    connStatus.textContent = 'Offline';
  }

  function handleKeyDown(event) {
    const key = normKey(event.key);
    if (!key) return;

    const sceneId = scenes.currentId;

    if (key === 'enter') {
      if (sceneId === 'title' || sceneId === 'gameover') {
        event.preventDefault();
        dispatchAction('start', { source: 'keyboard' });
        return;
      }
      if (sceneId === 'pause') {
        event.preventDefault();
        dispatchAction('resume', { source: 'keyboard' });
        return;
      }
    }

    if (key === 'p') {
      event.preventDefault();
      togglePause();
      return;
    }
    if (key === 'r') {
      event.preventDefault();
      restartGame('keyboard');
      return;
    }

    keys.add(key);
    if (KEY_JUMP.includes(key)) {
      if (sceneId !== 'gameplay') {
        if (sceneId === 'title') {
          event.preventDefault();
          dispatchAction('start', { source: 'keyboard' });
        } else if (sceneId === 'pause' && pauseReason !== 'shell') {
          event.preventDefault();
          dispatchAction('resume', { source: 'keyboard' });
        }
        return;
      }
    }

    if (KEY_JUMP.includes(key) && localPlayer.onGround && !paused && !gameOver) {
      event.preventDefault();
      localPlayer.vy = -JUMP_FORCE;
      localPlayer.onGround = false;
    }
  }

  function handleKeyUp(event) {
    keys.delete(normKey(event.key));
  }

  function updatePhysics(dt) {
    localPlayer.vx = 0;
    if (!paused && !gameOver) {
      if (KEY_LEFT.some(k => keys.has(k))) {
        localPlayer.vx = -MOVE_SPEED;
        localPlayer.facing = -1;
      }
      if (KEY_RIGHT.some(k => keys.has(k))) {
        localPlayer.vx = MOVE_SPEED;
        localPlayer.facing = 1;
      }
      if (!localPlayer.onGround) {
        localPlayer.vy += GRAVITY * dt;
      }
    }

    if (paused || gameOver) {
      return;
    }

    localPlayer.x += localPlayer.vx * dt;
    localPlayer.y += localPlayer.vy * dt;

    localPlayer.onGround = false;
    for (const platform of platforms) {
      if (!aabb(localPlayer, platform)) continue;
      const prevY = localPlayer.y - localPlayer.vy * dt;
      if (prevY + localPlayer.h <= platform.y && localPlayer.vy > 0) {
        localPlayer.y = platform.y - localPlayer.h;
        localPlayer.vy = 0;
        localPlayer.onGround = true;
      } else if (prevY >= platform.y + platform.h && localPlayer.vy < 0) {
        localPlayer.y = platform.y + platform.h;
        localPlayer.vy = 0;
      } else {
        if (localPlayer.vx > 0) localPlayer.x = platform.x - localPlayer.w;
        if (localPlayer.vx < 0) localPlayer.x = platform.x + platform.w;
      }
    }

    localPlayer.x = clamp(localPlayer.x, -40, W - localPlayer.w + 40);

    if (localPlayer.y > H + 120) {
      triggerGameOver('Game Over', `You fell after collecting ${localPlayer.collected}/${coins.length} coins in ${secondsElapsed().toFixed(1)}s.`);
    }

    if (localPlayer.onGround) {
      localPlayer.vy = 0;
    }

    for (const coin of coins) {
      if (!coin.collected && aabb(localPlayer, coin)) {
        coin.collected = true;
        playSfx('coin');
        localPlayer.collected += 1;
        emitScore('collect', { coinId: coin.id });
        emitState('collect', { coinId: coin.id });
        if (net.isConnected()) {
          net.sendCollect({ id: coin.id });
        }
      }
    }

    if (localPlayer.collected >= coins.length && aabb(localPlayer, goal)) {
      triggerGameOver('Level Clear!', `Collected ${localPlayer.collected}/${coins.length} coins in ${secondsElapsed().toFixed(1)}s.`);
    }
  }

  function drawScene(now) {
    if(!postedReady){
      postedReady = true;
      markPhase('boot:ready-signal');
      logBoot('info', 'Posted GAME_READY to shell');
      try { window.parent?.postMessage({ type:'GAME_READY', slug:'platformer' }, '*'); } catch {}
    }
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.save();
    ctx.translate(renderOffsetX, renderOffsetY);
    ctx.scale(renderScale, renderScale);
    // Letterbox using the precomputed offsets so both axes keep the same scale while centering the playfield.
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, '#0d1a2b');
    gradient.addColorStop(1, '#0b1020');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    drawParallaxBackground();

    hydratePatterns();

    const lavaFill = lavaPattern ?? '#223757';
    ctx.fillStyle = lavaFill;
    ctx.fillRect(0, groundY + 30, W, H - groundY - 30);

    const blockFill = blockPattern ?? '#385a88';
    ctx.fillStyle = blockFill;
    for (const platform of platforms) {
      ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
    }

    if (checkpoint) {
      const spriteKey = checkpoint.sprite?.key ?? 'checkpoint';
      const spriteFrame = checkpoint.sprite?.frame;
      const checkpointDrawn = drawTileSprite(ctx, spriteKey, checkpoint.x, checkpoint.y, checkpoint.w, checkpoint.h, spriteFrame);
      if (!checkpointDrawn) {
        const poleX = checkpoint.x + checkpoint.w * 0.45;
        ctx.fillStyle = '#f25f5c';
        ctx.fillRect(poleX, checkpoint.y, Math.max(3, checkpoint.w * 0.12), checkpoint.h);
        ctx.fillStyle = '#ffe066';
        ctx.beginPath();
        ctx.moveTo(poleX + checkpoint.w * 0.12, checkpoint.y + checkpoint.h * 0.15);
        ctx.lineTo(checkpoint.x + checkpoint.w - checkpoint.w * 0.15, checkpoint.y + checkpoint.h * 0.35);
        ctx.lineTo(poleX + checkpoint.w * 0.12, checkpoint.y + checkpoint.h * 0.55);
        ctx.closePath();
        ctx.fill();
      }
    }

    for (const coin of coins) {
      if (coin.collected) continue;
      const spriteKey = coin.sprite?.key ?? 'coin';
      const spriteFrame = coin.sprite?.frame;
      const rendered = drawTileSprite(ctx, spriteKey, coin.x, coin.y, coin.w, coin.h, spriteFrame);
      if (!rendered) {
        const cx = coin.x + coin.w / 2;
        const cy = coin.y + coin.h / 2;
        ctx.fillStyle = '#ffe066';
        const ringRadius = coin.w * 0.28;
        ctx.beginPath();
        ctx.arc(cx - coin.w * 0.18, cy, ringRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(cx - coin.w * 0.05, cy - coin.h * 0.18, coin.w * 0.42, coin.h * 0.36);
        ctx.fillRect(cx + coin.w * 0.2, cy - coin.h * 0.08, coin.w * 0.18, coin.h * 0.16);
        ctx.fillStyle = '#d4a514';
        ctx.fillRect(cx + coin.w * 0.05, cy - coin.h * 0.02, coin.w * 0.14, coin.h * 0.04);
      }
    }

    const goalSpriteKey = goal.sprite?.key ?? 'goal';
    const goalFrame = goal.sprite?.frame;
    const goalDrawn = drawTileSprite(ctx, goalSpriteKey, goal.x, goal.y, goal.w, goal.h, goalFrame);
    if (!goalDrawn) {
      ctx.fillStyle = '#98c1ff';
      ctx.fillRect(goal.x, goal.y, goal.w, goal.h);
      ctx.fillStyle = '#0e1422';
      const doorInsetX = goal.w * 0.25;
      const doorInsetY = goal.h * 0.2;
      ctx.fillRect(goal.x + doorInsetX, goal.y + doorInsetY, goal.w - doorInsetX * 2, goal.h - doorInsetY - goal.h * 0.1);
      ctx.fillStyle = '#f5f7ff';
      ctx.beginPath();
      ctx.arc(goal.x + goal.w * 0.65, goal.y + goal.h * 0.6, Math.min(goal.w, goal.h) * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }

    if (remotePlayer.active && now - remotePlayer.lastSeen < 1200) {
      drawPlayerCharacter(remotePlayer, 'remote', now, '#ff9f1c');
      ctx.fillStyle = '#ffd37a';
      ctx.font = '12px system-ui';
      ctx.fillText('Partner', remotePlayer.x - 6, remotePlayer.y - 8);
    }

    drawPlayerCharacter(localPlayer, 'local', now, '#1c1c1c');

    ctx.fillStyle = '#f5f7ff';
    ctx.font = '14px system-ui';
    const coinsText = `Coins: ${localPlayer.collected}/${coins.length}`;
    ctx.fillText(coinsText, 16, 24);
    const timeText = `Time: ${secondsElapsed().toFixed(1)}s`;
    ctx.fillText(timeText, 16, 44);

    if (net.isConnected()) {
      ctx.fillStyle = '#aad9ff';
      ctx.font = '13px system-ui';
      const partnerCoins = `Partner coins: ${remotePlayer.coins ?? 0}`;
      ctx.fillText(partnerCoins, 16, 64);
      if (remotePlayer.gameOver) {
        ctx.fillStyle = '#f4a261';
        ctx.font = '12px system-ui';
        ctx.fillText('Partner is waiting on the overlay.', 16, 82);
      }
    } else {
      ctx.fillStyle = '#7a8dad';
      ctx.font = '12px system-ui';
      ctx.fillText('Click "Start Co-op" in the HUD to link another tab.', 16, 64);
    }

    if (!gameOver && localPlayer.collected < coins.length && aabb(localPlayer, goal)) {
      ctx.fillStyle = '#ffd166';
      ctx.font = '14px system-ui';
      ctx.fillText('Collect the remaining coins!', goal.x - 60, goal.y - 12);
    }
    ctx.restore();
  }

  function frame(now) {
    const dtMs = Math.min(Math.max(now - lastFrame, 1), 1000 / 20);
    lastFrame = now;
    const dt = dtMs / (1000 / 60); // scale to 60fps units

    const record = ensureBootRecord();
    const rafInfo = record.raf || (record.raf = {});
    rafInfo.lastTick = now;
    rafInfo.tickCount = (rafInfo.tickCount || 0) + 1;
    rafInfo.lastDelta = dtMs;
    if (!rafInfo.firstTickAt) {
      rafInfo.firstTickAt = now;
      markPhase('raf:first-tick', { at: now });
    }

    updatePhysics(dt);

    if (!paused && !gameOver) {
      sendTimer += dtMs;
      if (sendTimer >= STATE_INTERVAL) {
        sendTimer = 0;
        sendState();
      }
    }

    drawScene(now);
    rafId = requestAnimationFrame(frame);
  }

  function cleanup() {
    cancelAnimationFrame(rafId);
    stopWatchdogs();
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    clearTimeout(shareResetTimer);
    clearTimeout(coopRetryTimer);
    window.removeEventListener('ggshell:pause', onShellPause);
    window.removeEventListener('ggshell:resume', onShellResume);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('message', onShellMessage);
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  if (netHud) initNet();

  function pauseForShell() {
    if (gameOver) return;
    if (paused) { pausedByShell = false; return; }
    pausedByShell = true;
    togglePause(true, { source: 'shell', reason: 'shell' });
  }

  function resumeFromShell() {
    if (!pausedByShell || document.hidden) return;
    pausedByShell = false;
    if (paused && !gameOver) togglePause(false, { source: 'shell' });
  }

  const onShellPause = () => pauseForShell();
  const onShellResume = () => resumeFromShell();
  const onVisibilityChange = () => { if (document.hidden) pauseForShell(); else resumeFromShell(); };
  const onShellMessage = (event) => {
    const data = event && typeof event.data === 'object' ? event.data : null;
    const type = data?.type;
    if (type === 'GAME_PAUSE' || type === 'GG_PAUSE') pauseForShell();
    if (type === 'GAME_RESUME' || type === 'GG_RESUME') resumeFromShell();
  };

  window.addEventListener('ggshell:pause', onShellPause);
  window.addEventListener('ggshell:resume', onShellResume);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('message', onShellMessage, { passive: true });

  resetState({ autoStart: false });
  initializeScenes();
  lastFrame = performance.now();
  markPhase('boot:ready', { lastFrameAt: lastFrame });
  logBoot('info', 'Boot complete', { lastFrameAt: lastFrame });
  rafId = requestAnimationFrame(frame);
  window.addEventListener('beforeunload', cleanup, { once: true });
}

if (globalScope) {
  markPhase('module:evaluated');
  if (globalScope.document) {
    const runOnReady = () => {
      markPhase('dom:ready');
      if (!bootStarted) {
        boot();
      }
    };
    if (globalScope.document.readyState === 'loading') {
      globalScope.document.addEventListener('DOMContentLoaded', runOnReady, { once: true });
    } else if (typeof queueMicrotask === 'function') {
      queueMicrotask(runOnReady);
    } else if (typeof Promise !== 'undefined') {
      Promise.resolve().then(runOnReady);
    } else {
      setTimeout(runOnReady, 0);
    }
  }
}
