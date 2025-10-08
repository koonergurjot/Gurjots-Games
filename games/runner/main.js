import { Controls } from '../../src/runtime/controls.js';
import { pushEvent } from '/games/common/diag-adapter.js';
import { registerRunnerAdapter } from './adapter.js';
import { play as playSfx, setPaused as setAudioPaused } from '../../shared/juice/audio.js';
import { createSceneManager } from '../../src/engine/scenes.js';
import { drawTileSprite, getTilePattern, preloadTileTextures } from '../../shared/render/tileTextures.js';

const VIRTUAL_WIDTH = 960;
const VIRTUAL_HEIGHT = 320;
const GROUND_HEIGHT = 60;
const PLAYER_X = 160;

const DIFFICULTY_SETTINGS = {
  relax: {
    label: 'Relaxed',
    speed: 5,
    spawnRange: [160, 240],
    ramp: {
      speed: 2.6,
      timeWindow: 110,
      distanceWindow: 3600,
      timeWeight: 0.5,
      maxProgress: 1.1,
      minTighten: 0.4,
      maxTighten: 0.25,
      minFloor: 0.6,
      maxFloor: 0.7,
    },
  },
  easy: {
    label: 'Easy',
    speed: 5.5,
    spawnRange: [140, 220],
    ramp: {
      speed: 3,
      minTighten: 0.5,
      maxTighten: 0.3,
      minFloor: 0.5,
      maxFloor: 0.65,
    },
  },
  med: {
    label: 'Medium',
    speed: 6.8,
    spawnRange: [120, 200],
    ramp: {
      speed: 3.4,
      minTighten: 0.55,
      maxTighten: 0.35,
      minFloor: 0.45,
      maxFloor: 0.55,
    },
  },
  hard: {
    label: 'Hard',
    speed: 8.2,
    spawnRange: [90, 170],
    ramp: {
      speed: 3.8,
      timeWindow: 70,
      distanceWindow: 2800,
      minTighten: 0.65,
      maxTighten: 0.45,
      minFloor: 0.4,
      maxFloor: 0.5,
      maxProgress: 1.3,
    },
  },
  extreme: {
    label: 'Extreme',
    speed: 9.4,
    spawnRange: [80, 150],
    ramp: {
      speed: 4.2,
      timeWindow: 60,
      distanceWindow: 2400,
      minTighten: 0.72,
      maxTighten: 0.5,
      minFloor: 0.35,
      maxFloor: 0.45,
      maxProgress: 1.45,
    },
  },
  endless: {
    label: 'Endless Ramp',
    speed: 6.2,
    spawnRange: [120, 190],
    ramp: {
      speed: 4,
      timeWindow: 75,
      distanceWindow: 3000,
      minTighten: 0.6,
      maxTighten: 0.4,
      minFloor: 0.38,
      maxFloor: 0.5,
      maxProgress: 2,
      speedLerp: 0.03,
    },
  },
};

const DEFAULT_LEVEL = {
  obstacles: [
    { x: 400, y: 260, w: 30, h: 30 },
    { x: 700, y: 260, w: 30, h: 30 },
  ],
  background: {
    clouds: [{ x: 120, y: 80, w: 100, h: 40 }],
    buildings: [{ x: 200, w: 80, h: 150 }],
    foreground: [{ x: 250, w: 40, h: 20 }],
  },
};

const SKY_GRADIENT = ['#1e293b', '#0f172a'];

function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

function hashSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >>> 0;
  }
  if (typeof value === 'string') {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  return (Math.random() * 0xffffffff) >>> 0;
}

function createSeededRng(seedValue = Math.random() * 0xffffffff) {
  let state = hashSeed(seedValue) || 0x6d2b79f5;
  return () => {
    state |= 0;
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function generateRandomSeed() {
  const now = Date.now();
  const perf = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? Math.floor(performance.now() * 1000)
    : 0;
  const entropy = Math.floor(Math.random() * 0xffffffff);
  return hashSeed(`${now}:${perf}:${entropy}`);
}

function normalizeSeedLabel(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, 48);
}

function labelForSeed(value, hashed) {
  const normalized = normalizeSeedLabel(value);
  if (normalized) return normalized;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (hashed !== undefined) {
    return `#${(hashed >>> 0).toString(16)}`;
  }
  return '';
}

function getDifficultyEntry(key) {
  return DIFFICULTY_SETTINGS[key] || DIFFICULTY_SETTINGS.med;
}

function getDifficultyLabel(key) {
  const entry = getDifficultyEntry(key);
  if (entry?.label) return entry.label;
  if (typeof key === 'string' && key.length) {
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
  return 'Medium';
}

preloadTileTextures().catch(() => null);
let postedReady = false;

const globalScope = typeof window !== 'undefined' ? window : null;

const SKYLINE_LAYER_SETTINGS = Object.freeze([
  Object.freeze({
    id: 'far',
    speed: 0.2,
    alpha: 0.65,
    color: '#475569',
    accentColor: '#64748b',
    widthRange: [120, 260],
    heightRange: [60, 140],
    baseOffsetRange: [56, 84],
    stackRange: [1, 2],
    windowLights: false,
  }),
  Object.freeze({
    id: 'mid',
    speed: 0.5,
    alpha: 0.82,
    color: '#334155',
    accentColor: '#475569',
    widthRange: [70, 180],
    heightRange: [80, 190],
    baseOffsetRange: [34, 60],
    stackRange: [2, 3],
    windowLights: true,
  }),
  Object.freeze({
    id: 'foreground',
    speed: 1.0,
    alpha: 1,
    color: '#1e293b',
    accentColor: '#2b3a56',
    widthRange: [40, 120],
    heightRange: [110, 220],
    baseOffsetRange: [18, 32],
    stackRange: [2, 4],
    windowLights: true,
  }),
]);

function randomRangeFrom(rng, min, max) {
  const random = typeof rng === 'function' ? rng : Math.random;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return random();
  }
  if (max <= min) {
    return min;
  }
  return min + (max - min) * random();
}

function createLayerCanvas(width, height) {
  if (!globalScope) return null;
  if (typeof globalScope.OffscreenCanvas === 'function') {
    try {
      return new globalScope.OffscreenCanvas(width, height);
    } catch (err) {
      /* ignore construction errors */
    }
  }
  if (globalScope.document && typeof globalScope.document.createElement === 'function') {
    const canvas = globalScope.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

function addWindowLights(target, ctx, building, rng, options = {}) {
  const { x, y, w, h } = building;
  if (h < 24 || w < 18) return;
  const chance = clamp(options.chance ?? 0.45, 0, 1);
  if (rng() > chance) return;
  const lightColor = options.color || 'rgba(253, 224, 71, 0.28)';
  const spacingX = clamp(Math.round(randomRangeFrom(rng, 6, 9)), 4, 12);
  const spacingY = clamp(Math.round(randomRangeFrom(rng, 9, 12)), 6, 16);
  const windowW = clamp(Math.round(randomRangeFrom(rng, 2, 3)), 2, 4);
  const windowH = clamp(Math.round(randomRangeFrom(rng, 4, 5)), 3, 6);
  const startX = x + 4;
  const endX = x + w - 4;
  const startY = y + 6;
  const endY = y + h - 6;
  for (let px = startX; px < endX - windowW; px += spacingX) {
    for (let py = startY; py < endY - windowH; py += spacingY) {
      if (rng() > 0.55) continue;
      if (ctx) {
        ctx.fillStyle = lightColor;
        ctx.fillRect(px, py, windowW, windowH);
      }
      target.push({ x: px, y: py, w: windowW, h: windowH, color: lightColor });
    }
  }
}

function drawStackedBuilding(ctx, target, config, base) {
  const {
    left,
    baseWidth,
    baseHeight,
    baseY,
    color,
    accentColor,
    rng,
    stackRange,
  } = base;
  const stacks = Math.max(1, Math.round(clamp(randomRangeFrom(rng, stackRange[0], stackRange[1]), stackRange[0], stackRange[1])));
  let currentWidth = baseWidth;
  let currentLeft = left;
  let currentBase = baseY;
  for (let level = 0; level < stacks; level++) {
    const shrink = level === 0 ? 1 : clamp(randomRangeFrom(rng, 0.45, 0.82), 0.35, 0.9);
    const segmentWidth = clamp(currentWidth * shrink, Math.max(12, baseWidth * 0.35), currentWidth);
    const minHeight = level === 0 ? baseHeight : baseHeight * clamp(randomRangeFrom(rng, 0.25, 0.45), 0.22, 0.6);
    const segmentHeight = clamp(minHeight, 12, currentBase);
    const segmentLeft = currentLeft + (currentWidth - segmentWidth) / 2;
    const segmentTop = Math.max(0, currentBase - segmentHeight);
    const fill = level === 0 ? color : accentColor;
    if (ctx) {
      ctx.fillStyle = fill;
      ctx.fillRect(segmentLeft, segmentTop, segmentWidth, segmentHeight);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.15)';
      ctx.fillRect(segmentLeft, segmentTop, Math.max(2, segmentWidth * 0.14), segmentHeight);
    }
    target.push({ x: segmentLeft, y: segmentTop, w: segmentWidth, h: segmentHeight, color: fill });
    target.push({
      x: segmentLeft,
      y: segmentTop,
      w: Math.max(2, segmentWidth * 0.14),
      h: segmentHeight,
      color: 'rgba(15, 23, 42, 0.15)',
    });
    if (level === 0 && config.windowLights) {
      addWindowLights(target, ctx, { x: segmentLeft, y: segmentTop, w: segmentWidth, h: segmentHeight }, rng, {
        chance: 0.55,
        color: config.id === 'foreground'
          ? 'rgba(250, 204, 21, 0.35)'
          : 'rgba(148, 163, 184, 0.25)',
      });
    }
    currentBase = segmentTop;
    currentLeft = segmentLeft;
    currentWidth = segmentWidth;
    if (currentBase <= 8) break;
  }
  if (ctx) {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.fillRect(left, baseY - baseHeight, baseWidth, 2);
  }
  target.push({ x: left, y: baseY - baseHeight, w: baseWidth, h: 2, color: 'rgba(148, 163, 184, 0.12)' });
}

function generateSkylineLayer(config, options = {}) {
  const width = Math.max(1, Math.floor(options.width ?? VIRTUAL_WIDTH));
  const ground = Math.max(1, Math.floor(options.ground ?? VIRTUAL_HEIGHT));
  const rng = typeof options.rng === 'function' ? options.rng : Math.random;
  const repeatScale = clamp(options.repeatScale ?? 2.4, 1.5, 3.5);
  const repeatWidth = Math.max(width * repeatScale, width + (config.widthRange?.[1] ?? 120));
  const canvasWidth = Math.ceil(repeatWidth);
  const canvasHeight = ground;
  const canvas = createLayerCanvas(canvasWidth, canvasHeight);
  if (canvas) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
  }
  const ctx = canvas ? canvas.getContext('2d') : null;
  if (ctx) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  }
  const shapes = [];
  const [minWidth, maxWidth] = config.widthRange || [80, 160];
  const [minHeight, maxHeight] = config.heightRange || [80, 180];
  const [minBaseOffset, maxBaseOffset] = config.baseOffsetRange || [20, 48];
  const stackRange = config.stackRange || [1, 3];
  const gapRange = config.gapRange || [12, 38];
  const baseJitter = config.baseJitter ?? 6;
  const baseOffset = clamp(randomRangeFrom(rng, minBaseOffset, maxBaseOffset), 0, ground - 12);
  const baseY = clamp(ground - baseOffset, 40, ground);
  let cursor = -randomRangeFrom(rng, 0, maxWidth);
  while (cursor < canvasWidth + maxWidth) {
    const baseWidth = clamp(randomRangeFrom(rng, minWidth, maxWidth), minWidth, maxWidth);
    const jitter = randomRangeFrom(rng, -baseJitter, baseJitter);
    const layerBase = clamp(baseY + jitter, 20, ground);
    const maxSegmentHeight = clamp(maxHeight, 16, layerBase - 4);
    const baseHeight = clamp(randomRangeFrom(rng, minHeight, maxSegmentHeight), 16, maxSegmentHeight);
    drawStackedBuilding(ctx, shapes, config, {
      left: cursor,
      baseWidth,
      baseHeight,
      baseY: layerBase,
      color: config.color,
      accentColor: config.accentColor || config.color,
      rng,
      stackRange,
    });
    cursor += baseWidth + clamp(randomRangeFrom(rng, gapRange[0], gapRange[1]), 6, 72);
  }
  return {
    id: config.id,
    canvas: ctx ? canvas : null,
    shapes,
    repeatWidth: canvasWidth,
    baseY,
    speed: config.speed,
    alpha: clamp(config.alpha ?? 1, 0, 1),
    offset: 0,
  };
}

function createProceduralSkyline(options = {}) {
  if (!Array.isArray(SKYLINE_LAYER_SETTINGS) || !SKYLINE_LAYER_SETTINGS.length) return [];
  const baseRng = typeof options.rng === 'function'
    ? options.rng
    : createSeededRng(options.seed ?? generateRandomSeed());
  return SKYLINE_LAYER_SETTINGS.map(config => generateSkylineLayer(config, { ...options, rng: baseRng }));
}

const runnerBridge = (() => {
  if (!globalScope) return null;
  const existing = globalScope.Runner && typeof globalScope.Runner === 'object'
    ? globalScope.Runner
    : {};
  const onReady = Array.isArray(existing.onReady) ? existing.onReady : [];
  const onScore = Array.isArray(existing.onScore) ? existing.onScore : [];
  const bridge = { ...existing, game: existing.game || null, onReady, onScore };
  globalScope.Runner = bridge;
  return bridge;
})();

function notifyRunnerReady(game) {
  if (!runnerBridge) return;
  runnerBridge.game = game;
  if (!Array.isArray(runnerBridge.onReady) || !runnerBridge.onReady.length) return;
  const callbacks = runnerBridge.onReady.splice(0, runnerBridge.onReady.length);
  for (const callback of callbacks) {
    if (typeof callback !== 'function') continue;
    try {
      callback(game);
    } catch (err) {
      console.warn('[runner] Runner.onReady callback failed', err);
    }
  }
}

function emitRunnerScore(game, score, details = {}) {
  if (!runnerBridge) return;
  const payload = {
    score,
    bestScore: details.bestScore ?? game?.bestScore ?? 0,
    distance: details.distance ?? Math.floor(game?.distance ?? 0),
    difficulty: details.difficulty ?? game?.difficulty ?? 'med',
    status: details.status
      || (game?.gameOver ? 'game-over' : game?.paused ? 'paused' : 'running'),
    timestamp: Date.now(),
    levelName: details.levelName ?? (game?.levelName || ''),
  };
  runnerBridge.lastScoreEvent = payload;
  if (!Array.isArray(runnerBridge.onScore) || !runnerBridge.onScore.length) return;
  const listeners = runnerBridge.onScore.slice();
  for (const listener of listeners) {
    if (typeof listener !== 'function') continue;
    try {
      listener(payload);
    } catch (err) {
      console.warn('[runner] Runner.onScore callback failed', err);
    }
  }
}

function emitStateEvent(game, status, extra = {}) {
  const base = {
    status,
    paused: !!game?.paused,
    gameOver: !!game?.gameOver,
    score: game?.score ?? 0,
    bestScore: game?.bestScore ?? 0,
    distance: Math.floor(game?.distance ?? 0),
    difficulty: game?.difficulty ?? 'med',
    levelName: game?.levelName || '',
  };
  const level = status === 'paused' ? 'warn' : 'info';
  pushEvent('state', {
    level,
    message: `[runner] ${status}`,
    details: { ...base, ...extra },
  });
}

const OVERLAY_FADE_MS = 220;

function buildRunnerOverlay() {
  if (typeof document === 'undefined') return null;
  const root = document.createElement('div');
  root.className = 'runner-overlay';
  root.dataset.scene = '';
  root.setAttribute('aria-hidden', 'true');

  const makeButton = (text, id) => {
    const btn = document.createElement('button');
    btn.className = 'runner-overlay__btn';
    btn.type = 'button';
    if (id) btn.id = id;
    btn.textContent = text;
    return btn;
  };

  const titlePanel = document.createElement('div');
  titlePanel.className = 'runner-overlay__panel';
  titlePanel.dataset.scene = 'title';
  const titleHeading = document.createElement('h2');
  titleHeading.className = 'runner-overlay__heading';
  titleHeading.textContent = 'City Runner';
  const titleMessage = document.createElement('p');
  titleMessage.className = 'runner-overlay__text';
  titleMessage.id = 'runner-overlay-title';
  const seedPanel = document.createElement('div');
  seedPanel.className = 'runner-overlay__seed';
  const seedLabel = document.createElement('label');
  seedLabel.className = 'runner-overlay__seed-label';
  seedLabel.setAttribute('for', 'runner-overlay-seed');
  seedLabel.textContent = 'Daily Run Seed';
  const seedInput = document.createElement('input');
  seedInput.className = 'runner-overlay__seed-input';
  seedInput.id = 'runner-overlay-seed';
  seedInput.type = 'text';
  seedInput.inputMode = 'text';
  seedInput.autocomplete = 'off';
  seedInput.placeholder = 'YYYY-MM-DD or custom';
  const seedActions = document.createElement('div');
  seedActions.className = 'runner-overlay__seed-actions';
  const useSeedBtn = makeButton('Use Seed', 'runner-overlay-use-seed');
  const clearSeedBtn = makeButton('Random Run', 'runner-overlay-clear-seed');
  seedActions.append(useSeedBtn, clearSeedBtn);
  const seedStatus = document.createElement('p');
  seedStatus.className = 'runner-overlay__seed-status';
  seedStatus.textContent = 'Leave blank to shuffle a new run each start.';
  seedPanel.append(seedLabel, seedInput, seedActions, seedStatus);
  const titleActions = document.createElement('div');
  titleActions.className = 'runner-overlay__actions';
  const startBtn = makeButton('Start Run', 'runner-overlay-start');
  titleActions.append(startBtn);
  titlePanel.append(titleHeading, titleMessage, seedPanel, titleActions);

  const pausePanel = document.createElement('div');
  pausePanel.className = 'runner-overlay__panel';
  pausePanel.dataset.scene = 'pause';
  const pauseHeading = document.createElement('h2');
  pauseHeading.className = 'runner-overlay__heading';
  pauseHeading.textContent = 'Paused';
  const pauseMessage = document.createElement('p');
  pauseMessage.className = 'runner-overlay__text';
  pauseMessage.id = 'runner-overlay-pause';
  const pauseActions = document.createElement('div');
  pauseActions.className = 'runner-overlay__actions';
  const resumeBtn = makeButton('Resume', 'runner-overlay-resume');
  const pauseRestartBtn = makeButton('Restart', 'runner-overlay-restart');
  const pauseMenuBtn = makeButton('Main Menu', 'runner-overlay-menu');
  pauseActions.append(resumeBtn, pauseRestartBtn, pauseMenuBtn);
  pausePanel.append(pauseHeading, pauseMessage, pauseActions);

  const gameOverPanel = document.createElement('div');
  gameOverPanel.className = 'runner-overlay__panel';
  gameOverPanel.dataset.scene = 'gameover';
  const gameOverHeading = document.createElement('h2');
  gameOverHeading.className = 'runner-overlay__heading';
  gameOverHeading.id = 'runner-overlay-gameover-heading';
  gameOverHeading.textContent = 'Run Complete';
  const gameOverDetail = document.createElement('p');
  gameOverDetail.className = 'runner-overlay__text';
  gameOverDetail.id = 'runner-overlay-gameover-detail';
  const gameOverScore = document.createElement('p');
  gameOverScore.className = 'runner-overlay__score';
  gameOverScore.id = 'runner-overlay-gameover-score';
  const gameOverActions = document.createElement('div');
  gameOverActions.className = 'runner-overlay__actions';
  const gameOverRestart = makeButton('Run Again', 'runner-overlay-gameover-restart');
  const gameOverMenu = makeButton('Main Menu', 'runner-overlay-gameover-menu');
  gameOverActions.append(gameOverRestart, gameOverMenu);
  gameOverPanel.append(gameOverHeading, gameOverDetail, gameOverScore, gameOverActions);

  root.append(titlePanel, pausePanel, gameOverPanel);
  document.body.appendChild(root);

  return {
    root,
    title: {
      panel: titlePanel,
      message: titleMessage,
      startBtn,
      seedInput,
      useSeedBtn,
      clearSeedBtn,
      seedStatus,
    },
    pause: { panel: pausePanel, message: pauseMessage, resumeBtn, restartBtn: pauseRestartBtn, menuBtn: pauseMenuBtn },
    gameover: {
      panel: gameOverPanel,
      heading: gameOverHeading,
      detail: gameOverDetail,
      score: gameOverScore,
      restartBtn: gameOverRestart,
      menuBtn: gameOverMenu,
    },
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveCanvas(context) {
  if (context && context.canvas instanceof HTMLCanvasElement) return context.canvas;
  if (context && typeof context.mount === 'string') {
    const mount = document.querySelector(context.mount);
    if (mount) {
      const nested = mount.querySelector('canvas#game');
      if (nested instanceof HTMLCanvasElement) return nested;
    }
  }
  const canvas = document.getElementById('game');
  return canvas instanceof HTMLCanvasElement ? canvas : null;
}

class RunnerGame {
  constructor(canvas, context = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) {
      throw new Error('[runner] Canvas 2D context unavailable');
    }

    this.scaleFactor = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.lastTime = 0;
    this.rafId = 0;
    this.running = false;
    this.gameOver = false;
    this.paused = false;
    this.wasPausedByVisibility = false;
    this.pauseReason = 'user';

    this.gravity = 0.9;
    this.jumpImpulse = 15.5;
    this.maxFallSpeed = 18;
    this.slideDuration = 22;
    this.coyoteFrames = 6;
    this.jumpBufferFrames = 6;

    this.player = this.createPlayer();
    this.obstacles = [];
    this.obstaclePool = [];
    this.coins = [];
    this.coinPool = [];
    this.particles = [];
    this.particlePool = [];
    this.manualObstacles = [];
    this.manualIndex = 0;

    const seedInfo = this.resolveSeedInfo(context);
    const metaAutoStart = context?.meta?.autoStart;
    this.seedMode = seedInfo.locked ? 'locked' : 'rolling';
    this.dailySeedLabel = seedInfo.label;
    this.seedBase = seedInfo.seed;
    this.runCounter = 0;
    this.skylineSeed = null;
    this.activeRunSeed = this.seedBase;
    this.pendingDailySeed = '';
    this.seed = this.seedBase;
    this.rng = createSeededRng(this.seedBase);
    this.autoStartOnBoot = metaAutoStart !== undefined ? !!metaAutoStart : !seedInfo.locked;

    this.background = { clouds: [], buildings: [], foreground: [] };
    this.parallaxLayers = [];
    this.distance = 0;
    this.elapsedSeconds = 0;
    this.spawnTimer = 160;
    this.coinTimer = 280;
    this.score = 0;
    this.lastDrawnScore = -1;
    this.bestScore = 0;
    this.difficulty = 'med';
    const defaultDifficulty = getDifficultyEntry(this.difficulty);
    this.baseSpeed = defaultDifficulty.speed;
    this.spawnRangeBase = [...defaultDifficulty.spawnRange];
    this.speed = this.baseSpeed;
    this.spawnRange = [...this.spawnRangeBase];
    this.difficultyProgress = 0;
    this.levelName = '';

    this.input = {
      jumpHeld: false,
      jumpQueued: false,
      slideHeld: false,
    };

    this.analytics = {
      nearMisses: 0,
      perfects: 0,
      coins: 0,
      lastNearMisses: -1,
      lastPerfects: -1,
      lastDistance: -1,
    };

    this.hud = {
      score: document.getElementById('score'),
      mission: document.getElementById('mission'),
      pauseBtn: document.getElementById('pauseBtn'),
      restartBtn: document.getElementById('restartBtn'),
      shareBtn: document.getElementById('shareBtn'),
      diffSel: document.getElementById('diffSel'),
      distance: document.getElementById('distanceStat'),
      nearMisses: document.getElementById('nearMisses'),
      perfects: document.getElementById('perfects'),
    };

    this.touchState = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      handled: false,
      intent: null,
      startTime: 0,
    };

    this.overlay = buildRunnerOverlay();

    this.boundLoop = this.loop.bind(this);
    this.onResize = this.resize.bind(this);
    this.onKeyDown = this.handleKeyDown.bind(this);
    this.onKeyUp = this.handleKeyUp.bind(this);
    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onVisibilityChange = this.handleVisibilityChange.bind(this);
    this.onShellPause = this.handleShellPause.bind(this);
    this.onShellResume = this.handleShellResume.bind(this);
    this.onShellMessage = this.handleShellMessage.bind(this);

    this.scenes = createSceneManager({ id: 'runner-scenes' });

    this.overlay?.title?.startBtn?.addEventListener('click', () => this.dispatchAction('start', { source: 'ui' }));
    this.overlay?.title?.useSeedBtn?.addEventListener('click', () => this.applyDailySeedFromOverlay());
    this.overlay?.title?.clearSeedBtn?.addEventListener('click', () => this.clearDailySeed());
    this.overlay?.title?.seedInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.applyDailySeedFromOverlay();
      }
    });
    this.overlay?.title?.seedInput?.addEventListener('input', event => {
      this.pendingDailySeed = normalizeSeedLabel(event.target?.value ?? '');
    });
    this.overlay?.pause?.resumeBtn?.addEventListener('click', () => this.dispatchAction('resume', { source: 'ui' }));
    this.overlay?.pause?.restartBtn?.addEventListener('click', () => this.dispatchAction('restart', { source: 'ui' }));
    this.overlay?.pause?.menuBtn?.addEventListener('click', () => this.dispatchAction('menu', { source: 'ui' }));
    this.overlay?.gameover?.restartBtn?.addEventListener('click', () => this.dispatchAction('restart', { source: 'ui' }));
    this.overlay?.gameover?.menuBtn?.addEventListener('click', () => this.dispatchAction('menu', { source: 'ui' }));

    setAudioPaused(true);
    this.attachEvents();
    this.updateDailySeedUi();
    this.readPreferences(context);
    this.resize();
    this.restoreBestScore();
    this.setDifficulty(this.difficulty);
    this.loadLevel(DEFAULT_LEVEL, { resetScore: true, silent: true, autoStart: this.autoStartOnBoot });
    if (this.autoStartOnBoot) {
      this.updateMission();
    } else {
      this.updateMission('Select a difficulty and press Start');
    }
    this.draw();
    const sceneReady = this.autoStartOnBoot
      ? this.scenes
        ?.clear({ transition: null })
        .catch(() => {})
        .then(() => this.scenes.push(() => this.createGameScene({ reset: false })))
        .catch(err => {
          console.error('[runner] failed to enter gameplay scene', err);
        })
      : this.initializeScenes();
  }

  attachEvents() {
    window.addEventListener('resize', this.onResize);
    document.addEventListener('keydown', this.onKeyDown, { passive: false });
    document.addEventListener('keyup', this.onKeyUp, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    this.canvas.addEventListener('pointermove', this.onPointerMove, { passive: false });
    this.canvas.addEventListener('pointerup', this.onPointerUp, { passive: false });
    this.canvas.addEventListener('pointercancel', this.onPointerUp, { passive: false });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('ggshell:pause', this.onShellPause);
    window.addEventListener('ggshell:resume', this.onShellResume);
    window.addEventListener('message', this.onShellMessage, { passive: true });

    this.hud.pauseBtn?.addEventListener('click', () => this.handlePauseButton());
    this.hud.restartBtn?.addEventListener('click', () => this.dispatchAction('restart', { source: 'hud' }));
    this.hud.shareBtn?.addEventListener('click', () => this.share());
    this.hud.diffSel?.addEventListener('change', e => {
      const value = e.target?.value;
      if (value) this.setDifficulty(value);
    });
  }

  detachEvents() {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('ggshell:pause', this.onShellPause);
    window.removeEventListener('ggshell:resume', this.onShellResume);
    window.removeEventListener('message', this.onShellMessage);
  }

  initializeScenes() {
    if (!this.scenes) return Promise.resolve();
    return this.scenes.clear({ transition: null })
      .catch(() => {})
      .then(() => this.scenes.push(() => this.createTitleScene()))
      .catch(err => {
        console.error('[runner] failed to enter title scene', err);
      });
  }

  dispatchAction(action, payload) {
    if (!this.scenes) return false;
    try {
      return this.scenes.handle(action, payload);
    } catch (err) {
      console.error('[runner] dispatch action failed', err);
      return false;
    }
  }

  setOverlayScene(kind) {
    const overlay = this.overlay;
    if (!overlay?.root) return;
    overlay.current = kind || null;
    overlay.root.dataset.scene = kind || '';
    overlay.root.setAttribute('aria-hidden', kind ? 'false' : 'true');
  }

  animateOverlayVisibility(kind, immediate = false) {
    const overlay = this.overlay?.root;
    if (!overlay) return Promise.resolve();
    if (immediate) {
      if (kind) overlay.classList.add('show');
      else overlay.classList.remove('show');
      return Promise.resolve();
    }
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        overlay.removeEventListener('transitionend', onEnd);
        resolve();
      };
      const onEnd = event => {
        if (event.target === overlay) finish();
      };
      overlay.addEventListener('transitionend', onEnd);
      requestAnimationFrame(() => {
        if (kind) overlay.classList.add('show');
        else overlay.classList.remove('show');
      });
      setTimeout(finish, OVERLAY_FADE_MS + 120);
    });
  }

  showOverlay(kind, data = {}, immediate = false) {
    if (kind === 'title') this.updateTitleOverlay();
    if (kind === 'pause') this.updatePauseOverlay(data.reason);
    if (kind === 'gameover') this.updateGameOverOverlay(data);
    this.setOverlayScene(kind);
    return this.animateOverlayVisibility(kind, immediate);
  }

  hideOverlay(immediate = false) {
    this.setOverlayScene(null);
    return this.animateOverlayVisibility(null, immediate);
  }

  updateTitleOverlay() {
    const overlay = this.overlay;
    if (!overlay?.title?.message) return;
    const parts = [];
    const best = Math.max(0, Math.floor(this.bestScore || 0));
    const diffLabel = getDifficultyLabel(this.difficulty);
    if (this.levelName) parts.push(this.levelName);
    parts.push(`Best ${best} m`);
    parts.push(`Difficulty ${diffLabel}`);
    if (this.isDailyRunActive()) {
      const label = this.dailySeedLabel || `#${(this.seedBase >>> 0).toString(16)}`;
      parts.push(`Daily Run ${label}`);
    }
    overlay.title.message.textContent = parts.join(' • ');
  }

  updatePauseOverlay(reason = 'user') {
    const overlay = this.overlay;
    if (!overlay?.pause?.message) return;
    const message = reason === 'shell'
      ? 'Paused by system overlay. Return to resume.'
      : 'Run paused';
    overlay.pause.message.textContent = message;
    if (overlay.pause.resumeBtn) {
      overlay.pause.resumeBtn.disabled = reason === 'shell';
    }
  }

  updateGameOverOverlay(data = {}) {
    const overlay = this.overlay;
    if (!overlay?.gameover) return;
    const score = Math.max(0, Number.isFinite(data.score) ? data.score : this.score || 0);
    const best = Math.max(0, Number.isFinite(data.bestScore) ? data.bestScore : this.bestScore || 0);
    const distance = Math.max(0, Number.isFinite(data.distance) ? data.distance : Math.floor(this.distance || 0));
    const diffLabel = getDifficultyLabel(this.difficulty);
    const levelLabel = this.levelName ? this.levelName : (data.levelName || 'Standard Course');
    if (overlay.gameover.heading) {
      overlay.gameover.heading.textContent = 'Run Complete';
    }
    if (overlay.gameover.detail) {
      const dailySuffix = this.isDailyRunActive() ? ' • Daily Run' : '';
      overlay.gameover.detail.textContent = `${levelLabel} • Difficulty ${diffLabel}${dailySuffix}`;
    }
    if (overlay.gameover.score) {
      const distanceLabel = Number.isFinite(distance) ? `${distance} m travelled` : '';
      const summary = distanceLabel ? ` • ${distanceLabel}` : '';
      overlay.gameover.score.textContent = `Distance ${score} m • Best ${best} m${summary}`;
    }
  }

  handlePauseButton() {
    const top = this.scenes?.currentId;
    if (top === 'pause') {
      this.dispatchAction('resume', { source: 'hud' });
    } else if (top === 'gameplay') {
      this.dispatchAction('pause', { source: 'hud', reason: 'user' });
    } else {
      this.dispatchAction('start', { source: 'hud' });
    }
  }

  ensureLoop() {
    if (!this.running) {
      this.start();
    }
  }

  applyPause(reason = 'user', opts = {}) {
    const { emitEvent = true } = opts || {};
    this.pauseReason = reason;
    this.paused = true;
    setAudioPaused(true);
    if (this.hud.pauseBtn) this.hud.pauseBtn.textContent = '▶️';
    this.updateMission();
    if (emitEvent) {
      emitStateEvent(this, 'paused', { reason });
    }
  }

  applyResume(opts = {}) {
    const { emitEvent = true } = opts || {};
    this.paused = false;
    this.pauseReason = 'user';
    this.lastTime = performance.now();
    setAudioPaused(false);
    if (this.hud.pauseBtn) this.hud.pauseBtn.textContent = '⏸️';
    this.updateMission();
    if (emitEvent) {
      emitStateEvent(this, 'running');
    }
  }

  createTitleScene() {
    const game = this;
    return {
      id: 'title',
      transition: {
        enter: () => this.showOverlay('title', {}, true),
        exit: () => this.hideOverlay(),
      },
      onEnter: ctx => {
        this.gameOver = false;
        this.pauseReason = 'menu';
        this.paused = true;
        setAudioPaused(true);
        this.updateTitleOverlay();
        this.updateMission('Select a difficulty and press Start');
        const startRun = async () => {
          try {
            game.applyDailySeedFromOverlay();
            await ctx.manager.replace(() => game.createGameScene({ reset: true }));
          } catch (err) {
            console.error('[runner] start run failed', err);
          }
        };
        ctx.setInputs({
          start: () => startRun(),
          pause() {},
          resume: () => startRun(),
          restart: () => startRun(),
          menu() {},
          gameover() {},
        });
      },
    };
  }

  createGameScene(options = {}) {
    const game = this;
    return {
      id: 'gameplay',
      transition: {
        enter: () => this.hideOverlay(),
        resume: () => this.hideOverlay(),
      },
      onEnter: ctx => {
        const shouldReset = options.reset !== false;
        if (shouldReset) {
          const level = this.currentLevel || this.sanitizeLevel(DEFAULT_LEVEL);
          this.loadLevel(level, { resetScore: true, silent: true, autoStart: false });
        }
        this.gameOver = false;
        this.pauseReason = 'user';
        this.wasPausedByVisibility = false;
        this.applyResume();
        this.ensureLoop();
        ctx.setInputs({
          async pause(currentCtx, info) {
            const reason = info?.reason === 'shell' ? 'shell' : 'user';
            try {
              await currentCtx.manager.push(() => game.createPauseScene({ reason }));
            } catch (err) {
              console.error('[runner] pause failed', err);
            }
          },
          resume() {},
          async start(currentCtx, info) {
            const reason = info?.reason === 'shell' ? 'shell' : 'user';
            try {
              await currentCtx.manager.push(() => game.createPauseScene({ reason }));
            } catch (err) {
              console.error('[runner] pause failed', err);
            }
          },
          async restart(currentCtx) {
            try {
              await currentCtx.manager.replace(() => game.createGameScene({ reset: true }));
            } catch (err) {
              console.error('[runner] restart failed', err);
            }
          },
          async menu(currentCtx) {
            try {
              await currentCtx.manager.replace(() => game.createTitleScene());
            } catch (err) {
              console.error('[runner] return to menu failed', err);
            }
          },
          async gameover(currentCtx, details) {
            try {
              await currentCtx.manager.push(() => game.createGameOverScene(details || {}));
            } catch (err) {
              console.error('[runner] game over scene failed', err);
            }
          },
        });
      },
      onResume: () => {
        this.applyResume();
      },
      onExit: () => {
        setAudioPaused(true);
      },
    };
  }

  createPauseScene({ reason = 'user' } = {}) {
    let currentReason = reason;
    const game = this;
    return {
      id: 'pause',
      transition: {
        enter: () => this.showOverlay('pause', { reason: currentReason }),
        exit: () => this.hideOverlay(),
      },
      onEnter: ctx => {
        this.applyPause(currentReason, { emitEvent: currentReason !== 'shell' });
        ctx.setInputs({
          async pause(currentCtx, info) {
            if (info?.reason === 'shell') {
              currentReason = 'shell';
              game.updatePauseOverlay(currentReason);
              game.pauseReason = currentReason;
              return;
            }
            try {
              await currentCtx.manager.pop();
            } catch (err) {
              console.error('[runner] resume from pause failed', err);
            }
          },
          async resume(currentCtx, info) {
            if (currentReason === 'shell' && info?.source !== 'shell') return;
            try {
              await currentCtx.manager.pop();
            } catch (err) {
              console.error('[runner] resume from pause failed', err);
            }
          },
          async start(currentCtx, info) {
            if (currentReason === 'shell' && info?.source !== 'shell') return;
            try {
              await currentCtx.manager.pop();
            } catch (err) {
              console.error('[runner] resume from pause failed', err);
            }
          },
          async restart(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => game.createGameScene({ reset: true }));
            } catch (err) {
              console.error('[runner] restart from pause failed', err);
            }
          },
          async menu(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => game.createTitleScene());
            } catch (err) {
              console.error('[runner] menu from pause failed', err);
            }
          },
          async gameover(currentCtx, details) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.push(() => game.createGameOverScene(details || {}));
            } catch (err) {
              console.error('[runner] pause to gameover failed', err);
            }
          },
        });
      },
      onExit: () => {
        this.pauseReason = 'user';
      },
    };
  }

  createGameOverScene(details = {}) {
    const payload = { ...details };
    const game = this;
    return {
      id: 'gameover',
      transition: {
        enter: () => this.showOverlay('gameover', payload),
        exit: () => this.hideOverlay(),
      },
      onEnter: ctx => {
        this.gameOver = true;
        this.pauseReason = 'gameover';
        this.paused = true;
        this.updateGameOverOverlay(payload);
        ctx.setInputs({
          async start(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => game.createGameScene({ reset: true }));
            } catch (err) {
              console.error('[runner] restart run failed', err);
            }
          },
          async restart(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => game.createGameScene({ reset: true }));
            } catch (err) {
              console.error('[runner] restart run failed', err);
            }
          },
          async pause(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => game.createGameScene({ reset: true }));
            } catch (err) {
              console.error('[runner] restart run failed', err);
            }
          },
          async resume(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
            } catch (err) {
              console.error('[runner] dismiss gameover failed', err);
            }
          },
          async menu(currentCtx) {
            try {
              await currentCtx.manager.pop({ resume: false });
              await currentCtx.manager.replace(() => game.createTitleScene());
            } catch (err) {
              console.error('[runner] return to menu failed', err);
            }
          },
          gameover() {},
        });
      },
      onExit: () => {
        this.pauseReason = 'user';
      },
    };
  }

  readPreferences(context) {
    let stored = null;
    try {
      stored = localStorage.getItem('runner:difficulty');
    } catch (err) {
      stored = null;
    }
    const viaContext = context?.meta?.difficulty;
    const initial = viaContext && DIFFICULTY_SETTINGS[viaContext]
      ? viaContext
      : stored && DIFFICULTY_SETTINGS[stored]
        ? stored
        : (this.hud.diffSel?.value || 'med');
    this.difficulty = initial;
    if (this.hud.diffSel) this.hud.diffSel.value = initial;
  }

  restoreBestScore() {
    try {
      const stored = localStorage.getItem('runner:best');
      const parsed = Number.parseInt(stored || '0', 10);
      if (Number.isFinite(parsed) && parsed > 0) this.bestScore = parsed;
    } catch (err) {
      this.bestScore = 0;
    }
  }

  persistBestScore() {
    try {
      localStorage.setItem('runner:best', String(this.bestScore));
    } catch (err) {
      // ignore storage errors
    }
  }

  groundY() {
    return VIRTUAL_HEIGHT - GROUND_HEIGHT;
  }

  resolveSeedInfo(context = {}) {
    const contextSeed = context?.meta?.seed ?? context?.seed;
    if (contextSeed !== undefined && contextSeed !== null && contextSeed !== '') {
      const hashed = hashSeed(contextSeed);
      return { seed: hashed, label: labelForSeed(contextSeed, hashed), locked: true };
    }
    const metaDaily = context?.meta?.dailySeed;
    if (metaDaily) {
      const hashed = hashSeed(metaDaily);
      return { seed: hashed, label: labelForSeed(metaDaily, hashed), locked: true };
    }
    if (typeof URLSearchParams === 'function' && typeof location === 'object') {
      try {
        const params = new URLSearchParams(location.search || '');
        const querySeed = params.get('seed') || params.get('dailySeed');
        if (querySeed) {
          const hashed = hashSeed(querySeed);
          return { seed: hashed, label: labelForSeed(querySeed, hashed), locked: true };
        }
      } catch (_) {
        /* ignore malformed URLs */
      }
    }
    let storedDaily = '';
    try {
      storedDaily = localStorage.getItem('runner:dailySeed') || '';
    } catch (err) {
      storedDaily = '';
    }
    if (storedDaily.trim()) {
      const hashed = hashSeed(storedDaily);
      return { seed: hashed, label: labelForSeed(storedDaily, hashed), locked: true };
    }
    const randomSeed = hashSeed(Date.now());
    return { seed: randomSeed, label: '', locked: false };
  }

  isDailyRunActive() {
    return this.seedMode === 'locked' && !!this.dailySeedLabel;
  }

  updateDailySeedUi() {
    const overlay = this.overlay?.title;
    if (!overlay) return;
    if (overlay.seedStatus) {
      overlay.seedStatus.textContent = this.isDailyRunActive()
        ? `Daily Run active — seed “${this.dailySeedLabel}”`
        : 'Randomized run — leave blank to shuffle each start.';
    }
    if (overlay.useSeedBtn) {
      overlay.useSeedBtn.textContent = this.isDailyRunActive() ? 'Update Seed' : 'Use Seed';
    }
    if (overlay.clearSeedBtn) {
      overlay.clearSeedBtn.textContent = this.isDailyRunActive() ? 'Clear Daily Run' : 'Random Run';
    }
    if (overlay.seedInput && document.activeElement !== overlay.seedInput) {
      overlay.seedInput.value = this.isDailyRunActive() ? this.dailySeedLabel : (this.pendingDailySeed || '');
    }
  }

  applyDailySeed(seedValue, opts = {}) {
    const normalized = normalizeSeedLabel(seedValue);
    if (!normalized) {
      this.clearDailySeed(opts);
      return;
    }
    const hashed = hashSeed(normalized);
    this.seedMode = 'locked';
    this.dailySeedLabel = labelForSeed(normalized, hashed);
    this.seedBase = hashed;
    this.seed = hashed;
    this.runCounter = 0;
    this.skylineSeed = null;
    this.pendingDailySeed = '';
    try {
      localStorage.setItem('runner:dailySeed', normalized);
    } catch (err) {
      /* ignore storage errors */
    }
    if (opts.updateInput !== false && this.overlay?.title?.seedInput && document.activeElement !== this.overlay.title.seedInput) {
      this.overlay.title.seedInput.value = normalized;
    }
    this.updateDailySeedUi();
    this.updateTitleOverlay();
    this.updateMission();
  }

  clearDailySeed(opts = {}) {
    this.seedMode = 'rolling';
    this.dailySeedLabel = '';
    this.runCounter = 0;
    this.skylineSeed = null;
    this.seedBase = generateRandomSeed();
    this.seed = this.seedBase;
    this.pendingDailySeed = '';
    try {
      localStorage.removeItem('runner:dailySeed');
    } catch (err) {
      /* ignore */
    }
    if (opts.updateInput !== false && this.overlay?.title?.seedInput && document.activeElement !== this.overlay.title.seedInput) {
      this.overlay.title.seedInput.value = '';
    }
    this.updateDailySeedUi();
    this.updateTitleOverlay();
    this.updateMission();
  }

  applyDailySeedFromOverlay() {
    const input = this.overlay?.title?.seedInput;
    if (!input) return;
    const value = normalizeSeedLabel(input.value);
    if (value) {
      if (!this.isDailyRunActive() || value !== this.dailySeedLabel) {
        this.applyDailySeed(value, { updateInput: false });
      }
      input.value = value;
    } else if (this.isDailyRunActive()) {
      this.clearDailySeed({ updateInput: false });
      input.value = '';
    } else {
      this.pendingDailySeed = '';
      this.updateDailySeedUi();
    }
  }

  prepareRunSeeds({ initial = false } = {}) {
    if (this.seedMode === 'locked') {
      this.runCounter = initial ? 1 : (this.runCounter || 0) + 1;
    } else {
      if (!initial || !this.seedBase) {
        this.seedBase = generateRandomSeed();
      }
      this.runCounter = 1;
    }
    this.setSeed(this.seedBase);
    this.activeRunSeed = this.seed;
    const skylineSalt = this.seedMode === 'locked'
      ? `run-${this.runCounter}`
      : `${Date.now()}:${Math.random()}`;
    this.skylineSeed = hashSeed(`${this.seedBase}:skyline:${skylineSalt}`);
    return { runSeed: this.activeRunSeed, skylineSeed: this.skylineSeed };
  }

  setSeed(seedValue) {
    this.seed = hashSeed(seedValue);
    this.rng = createSeededRng(this.seed);
    return this.seed;
  }

  rand() {
    if (!this.rng) {
      this.setSeed(this.seed ?? Date.now());
    }
    return this.rng();
  }

  randRange(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return this.rand();
    }
    return min + (max - min) * this.rand();
  }

  createPlayer() {
    const baseHeight = 50;
    return {
      x: PLAYER_X,
      y: this.groundY() - baseHeight,
      width: 34,
      height: baseHeight,
      baseHeight,
      slideHeight: 28,
      vy: 0,
      grounded: true,
      sliding: false,
      slideTimer: 0,
      coyote: this.coyoteFrames,
      jumpBuffer: 0,
    };
  }

  buildBackground(source = {}) {
    const clouds = Array.isArray(source.clouds) ? source.clouds : [];
    const buildings = Array.isArray(source.buildings) ? source.buildings : [];
    const foreground = Array.isArray(source.foreground) ? source.foreground : [];
    const makeCloud = cloud => ({
      x: numberOr(cloud.x, this.randRange(0, VIRTUAL_WIDTH)),
      y: numberOr(cloud.y, clamp(this.randRange(0, 1) * 140 + 20, 40, 160)),
      w: clamp(numberOr(cloud.w, this.randRange(60, 220)), 60, 220),
      h: clamp(numberOr(cloud.h, this.randRange(28, 80)), 28, 80),
    });
    const makeBuilding = building => ({
      x: numberOr(building.x, this.randRange(0, VIRTUAL_WIDTH + 200)),
      w: clamp(numberOr(building.w, this.randRange(60, 240)), 60, 240),
      h: clamp(numberOr(building.h, this.randRange(140, this.groundY() - 40)), 120, this.groundY() - 40),
    });
    const makeForeground = item => ({
      x: numberOr(item.x, this.randRange(0, VIRTUAL_WIDTH + 200)),
      w: clamp(numberOr(item.w, this.randRange(40, 140)), 40, 140),
      h: clamp(numberOr(item.h, this.randRange(20, 60)), 20, 60),
    });
    const ensureCount = (arr, maker, fallbackCount) => {
      if (arr.length > 0) return arr.map(maker);
      return Array.from({ length: fallbackCount }, () => maker({}));
    };
    return {
      clouds: ensureCount(clouds, makeCloud, 3),
      buildings: ensureCount(buildings, makeBuilding, 5),
      foreground: ensureCount(foreground, makeForeground, 4),
    };
  }

  createSkylineLayers() {
    const layers = createProceduralSkyline({
      width: VIRTUAL_WIDTH,
      ground: this.groundY(),
      seed: this.skylineSeed ?? this.seed,
    });
    if (!Array.isArray(layers)) return [];
    return layers.map(layer => ({ ...layer, offset: layer?.offset ?? 0 }));
  }

  sanitizeLevel(level = {}) {
    const rawObstacles = Array.isArray(level.obstacles) ? level.obstacles : [];
    const ground = this.groundY();
    const sanitized = rawObstacles.map(ob => {
      const width = clamp(numberOr(ob.w, 36), 18, 120);
      const height = clamp(numberOr(ob.h, 32), 20, 180);
      const distance = Math.max(0, numberOr(ob.x, 0));
      const rawY = numberOr(ob.y, NaN);
      const top = rawY > 0 ? clamp(rawY, 0, ground - height) : ground - height;
      const type = typeof ob.type === 'string' ? ob.type : 'block';
      return { distance, y: top, w: width, h: height, type };
    });
    sanitized.sort((a, b) => a.distance - b.distance);
    return {
      obstacles: sanitized,
      background: level.background || {},
      name: typeof level.name === 'string' ? level.name : '',
    };
  }

  loadLevel(level, opts = {}) {
    const { resetScore = false, silent = false, name = '', autoStart = true } = opts;
    const prepared = this.sanitizeLevel(level);
    this.currentLevel = prepared;
    this.levelName = name || prepared.name || this.levelName || '';
    this.manualObstacles = prepared.obstacles;
    this.manualIndex = 0;
    this.clearActiveEntities();
    if (resetScore) {
      this.prepareRunSeeds({ initial: this.runCounter === 0 });
    }
    this.background = this.buildBackground(prepared.background);
    this.parallaxLayers = this.createSkylineLayers();
    this.spawnTimer = 120;
    this.coinTimer = this.randRange(240, 420);
    this.elapsedSeconds = 0;
    this.difficultyProgress = 0;
    this.speed = this.baseSpeed;
    this.spawnRange = [...this.spawnRangeBase];
    if (resetScore) {
      this.distance = 0;
      this.score = 0;
      this.lastDrawnScore = -1;
      this.player = this.createPlayer();
      this.input.jumpQueued = false;
      this.input.jumpHeld = false;
      this.input.slideHeld = false;
      this.gameOver = false;
      this.pauseReason = autoStart ? 'user' : 'menu';
      this.paused = !autoStart;
      if (this.hud.shareBtn) this.hud.shareBtn.hidden = true;
      this.updateScoreDisplay(true);
      this.analytics.nearMisses = 0;
      this.analytics.perfects = 0;
      this.analytics.coins = 0;
      this.analytics.lastNearMisses = -1;
      this.analytics.lastPerfects = -1;
      this.analytics.lastDistance = -1;
      this.updateAnalyticsDisplay(true);
    }
    if (!silent) {
      this.updateMission();
    }
    if (autoStart) {
      this.applyResume();
      this.start();
    } else {
      setAudioPaused(true);
      this.updateMission();
    }
  }

  restart() {
    if (this.scenes) {
      this.dispatchAction('restart', { source: 'method' });
      return;
    }
    const level = this.currentLevel || this.sanitizeLevel(DEFAULT_LEVEL);
    this.loadLevel(level, { resetScore: true, silent: true });
    this.updateMission();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.boundLoop);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  attachCanvas(canvas) {
    if (canvas === this.canvas) return;
    this.detachEvents();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('[runner] Canvas 2D context unavailable');
    this.attachEvents();
    this.resize();
  }

  setDifficulty(difficulty) {
    const hasEntry = Object.prototype.hasOwnProperty.call(DIFFICULTY_SETTINGS, difficulty);
    const key = hasEntry ? difficulty : 'med';
    const settings = getDifficultyEntry(key);
    this.difficulty = key;
    this.baseSpeed = settings.speed;
    this.spawnRangeBase = [...settings.spawnRange];
    this.speed = this.baseSpeed;
    this.spawnRange = [...this.spawnRangeBase];
    this.elapsedSeconds = 0;
    this.difficultyProgress = 0;
    if (this.hud.diffSel) this.hud.diffSel.value = key;
    try {
      localStorage.setItem('runner:difficulty', key);
    } catch (err) {
      // ignore storage
    }
    if (this.scenes?.currentId === 'title') {
      this.updateTitleOverlay();
      this.updateMission('Select a difficulty and press Start');
    } else {
      this.updateMission();
    }
  }

  updateMission(customText) {
    if (!this.hud.mission) return;
    if (customText) {
      this.hud.mission.textContent = customText;
      return;
    }
    const difficultyLabel = getDifficultyLabel(this.difficulty);
    const levelLabel = this.levelName ? `${this.levelName} • ` : '';
    const dailySuffix = this.isDailyRunActive() ? ' • Daily Run' : '';
    if (this.gameOver) {
      this.hud.mission.textContent = `${levelLabel}Game Over • Best ${this.bestScore} m${dailySuffix}`;
    } else if (this.paused) {
      const reason = this.pauseReason;
      const label = reason === 'shell'
        ? 'Paused by system overlay'
        : reason === 'menu'
          ? 'Paused'
          : 'Paused';
      this.hud.mission.textContent = `${levelLabel}${label}${dailySuffix}`;
    } else {
      this.hud.mission.textContent = `${levelLabel}Difficulty: ${difficultyLabel} • Best ${this.bestScore} m${dailySuffix}`;
    }
  }

  togglePause() {
    if (this.gameOver) return;
    const top = this.scenes?.currentId;
    if (top === 'pause') {
      this.dispatchAction('resume', { source: 'toggle' });
    } else if (top === 'gameplay') {
      this.dispatchAction('pause', { source: 'toggle', reason: 'user' });
    } else {
      this.dispatchAction('start', { source: 'toggle' });
    }
  }

  pause(reason = 'user') {
    if (this.gameOver) return;
    if (this.scenes) {
      this.dispatchAction('pause', { source: 'method', reason });
      return;
    }
    this.applyPause(reason);
  }

  resume(source = 'method') {
    if (this.scenes) {
      this.dispatchAction('resume', { source });
      return;
    }
    this.applyResume();
  }

  share() {
    const score = this.score;
    const shareData = {
      title: 'City Runner',
      text: `I ran ${score}m in City Runner!`,
      url: typeof location !== 'undefined' ? location.href : '',
    };
    if (navigator?.share) {
      navigator.share(shareData).catch(() => {});
    } else if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(shareData.url || '').catch(() => {});
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor((rect.width || window.innerWidth || VIRTUAL_WIDTH) * dpr));
    const height = Math.max(1, Math.floor((rect.height || window.innerHeight || VIRTUAL_HEIGHT) * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const factor = Math.min(width / VIRTUAL_WIDTH, height / VIRTUAL_HEIGHT);
    const displayWidth = VIRTUAL_WIDTH * factor;
    const displayHeight = VIRTUAL_HEIGHT * factor;
    this.offsetX = (width - displayWidth) / 2;
    this.offsetY = (height - displayHeight) / 2;
    this.scaleFactor = factor;
  }

  loop(timestamp) {
    if (!this.running) return;
    const delta = this.lastTime ? (timestamp - this.lastTime) / 16.666 : 1;
    this.lastTime = timestamp;
    const step = clamp(delta, 0, 3);
    if (!this.paused && !this.gameOver) {
      let remaining = step;
      while (remaining > 0) {
        const slice = Math.min(1, remaining);
        this.advanceStep(slice);
        remaining -= slice;
      }
    }
    this.draw();
    this.rafId = requestAnimationFrame(this.boundLoop);
  }

  updateParallax(travel) {
    if (!Array.isArray(this.parallaxLayers) || !this.parallaxLayers.length) return;
    for (const layer of this.parallaxLayers) {
      if (!layer) continue;
      const scrollWidth = Math.max(1, Math.floor(layer.repeatWidth || layer.canvas?.width || VIRTUAL_WIDTH));
      const speed = Number.isFinite(layer.speed) ? layer.speed : 1;
      if (!Number.isFinite(scrollWidth) || scrollWidth <= 0) continue;
      const delta = travel * speed;
      if (!Number.isFinite(delta)) continue;
      let offset = (layer.offset ?? 0) + delta;
      offset %= scrollWidth;
      if (offset < 0) offset += scrollWidth;
      layer.offset = offset;
    }
  }

  advanceStep(step) {
    this.elapsedSeconds += step / 60;
    this.updateDifficultyCurve();
    const travel = this.speed * step;
    this.distance += travel;
    this.updateParallax(travel);
    this.spawnTimer -= travel;
    this.coinTimer -= travel;
    this.spawnManualObstacles();
    if (this.spawnTimer <= 0) {
      this.spawnRandomObstacle();
    }
    if (this.coinTimer <= 0) {
      this.spawnCoinPattern();
    }
    this.updatePlayer(step);
    this.updateObstacles(travel);
    this.updateCoins(travel, step);
    this.updateParticles(step);
    this.updateBackground(travel);
    this.updateScoreDisplay();
    this.updateAnalyticsDisplay();
    this.checkCollisions();
  }

  updateDifficultyCurve() {
    const settings = getDifficultyEntry(this.difficulty);
    const ramp = settings.ramp || {};
    const [baseMinGap, baseMaxGap] = this.spawnRangeBase;
    const timeWindow = Math.max(1, ramp.timeWindow ?? 90);
    const distanceWindow = Math.max(1, ramp.distanceWindow ?? 3200);
    const rawTimeWeight = clamp(ramp.timeWeight ?? 0.6, 0, 1);
    const rawDistanceWeight = clamp(ramp.distanceWeight ?? (1 - rawTimeWeight), 0, 1);
    const weightSum = rawTimeWeight + rawDistanceWeight || 1;
    const timeWeight = rawTimeWeight / weightSum;
    const distanceWeight = rawDistanceWeight / weightSum;
    const maxProgress = ramp.maxProgress ?? 1.25;
    const timeProgress = clamp(this.elapsedSeconds / timeWindow, 0, 1);
    const distanceProgress = clamp(this.distance / distanceWindow, 0, 1);
    const combined = clamp(timeProgress * timeWeight + distanceProgress * distanceWeight, 0, maxProgress);
    this.difficultyProgress = combined;
    const speedRamp = ramp.speed ?? 3.4;
    const lerpRate = clamp(ramp.speedLerp ?? 0.02, 0.005, 0.08);
    const targetSpeed = settings.speed + combined * speedRamp;
    this.speed = lerp(this.speed, targetSpeed, lerpRate);
    const minTighten = ramp.minTighten ?? 0.55;
    const maxTighten = ramp.maxTighten ?? 0.35;
    const minFloor = ramp.minFloor ?? 0.45;
    const maxFloor = ramp.maxFloor ?? 0.55;
    const minClamp = ramp.minClamp ?? 60;
    const separation = ramp.minSeparation ?? 20;
    const minScale = clamp(1 - combined * minTighten, minFloor, 1);
    const maxScale = clamp(1 - combined * maxTighten, maxFloor, 1);
    this.spawnRange[0] = Math.max(minClamp, baseMinGap * minScale);
    this.spawnRange[1] = Math.max(this.spawnRange[0] + separation, baseMaxGap * maxScale);
  }

  spawnManualObstacles() {
    const windowAhead = VIRTUAL_WIDTH * 1.4;
    while (this.manualIndex < this.manualObstacles.length) {
      const next = this.manualObstacles[this.manualIndex];
      const distanceAhead = Math.max(0, next.distance - this.distance);
      if (distanceAhead <= windowAhead) {
        const obstacle = this.acquireObstacle({
          x: PLAYER_X + distanceAhead,
          y: next.y,
          w: next.w,
          h: next.h,
          type: next.type || 'block',
          fromLevel: true,
        });
        this.obstacles.push(obstacle);
        this.manualIndex++;
      } else {
        break;
      }
    }
  }

  spawnRandomObstacle() {
    const [minGap, maxGap] = this.spawnRange;
    this.spawnTimer = this.randRange(minGap, maxGap);
    const difficulty = clamp(this.difficultyProgress, 0, 1.25);
    const baseX = VIRTUAL_WIDTH + this.randRange(80, 140);
    const roll = this.rand();
    if (roll < 0.25 + difficulty * 0.35) {
      this.spawnBarPattern(baseX, difficulty);
    } else if (roll > 0.72 && difficulty > 0.4) {
      this.spawnBlockCombo(baseX, difficulty);
    } else {
      this.spawnGroundBlock(baseX, difficulty);
    }
  }

  spawnGroundBlock(baseX, difficulty) {
    const width = clamp(this.randRange(26, 42 + difficulty * 26), 20, 120);
    const height = clamp(this.randRange(34, 60 + difficulty * 36), 24, 160);
    const top = this.groundY() - height;
    const block = this.acquireObstacle({ x: baseX, y: top, w: width, h: height, type: 'block' });
    this.obstacles.push(block);
    if (difficulty > 0.55 && this.rand() < 0.2 + difficulty * 0.2) {
      const offset = this.randRange(110, 180);
      const width2 = clamp(width * (0.7 + this.rand() * 0.5), 20, 110);
      const height2 = clamp(height + this.randRange(-18, 28), 24, 150);
      const top2 = this.groundY() - height2;
      const follow = this.acquireObstacle({
        x: baseX + offset,
        y: top2,
        w: width2,
        h: height2,
        type: 'block',
      });
      this.obstacles.push(follow);
    }
  }

  spawnBlockCombo(baseX, difficulty) {
    const width = clamp(this.randRange(22, 36 + difficulty * 22), 18, 110);
    const height = clamp(this.randRange(40, 62 + difficulty * 34), 24, 160);
    const top = this.groundY() - height;
    const first = this.acquireObstacle({ x: baseX, y: top, w: width, h: height, type: 'block' });
    this.obstacles.push(first);
    const gap = clamp(this.randRange(70, 120 - difficulty * 30), 48, 140);
    const width2 = clamp(width * (0.75 + this.rand() * 0.45), 18, 110);
    const height2 = clamp(height + this.randRange(-16, 32), 24, 160);
    const top2 = this.groundY() - height2;
    const second = this.acquireObstacle({
      x: baseX + width + gap,
      y: top2,
      w: width2,
      h: height2,
      type: 'block',
    });
    this.obstacles.push(second);
    if (difficulty > 0.75 && this.rand() < 0.35) {
      const width3 = clamp(this.randRange(60, 110), 40, 150);
      const height3 = clamp(this.randRange(18, 26 + difficulty * 16), 14, 60);
      const clearance = this.player.baseHeight - this.player.slideHeight + 12;
      const verticalOffset = clamp(clearance + this.randRange(10, 26 + difficulty * 8), clearance + 6, 120);
      const top3 = clamp(this.groundY() - this.player.baseHeight - verticalOffset, 48, this.groundY() - height3 - 12);
      const bar = this.acquireObstacle({
        x: second.x + this.randRange(-20, 30),
        y: top3,
        w: width3,
        h: height3,
        type: 'bar',
      });
      this.obstacles.push(bar);
    }
  }

  spawnBarPattern(baseX, difficulty) {
    const width = clamp(this.randRange(70, 110 + difficulty * 60), 60, 210);
    const height = clamp(this.randRange(18, 28 + difficulty * 10), 14, 60);
    const clearance = this.player.baseHeight - this.player.slideHeight + 12;
    const offset = clamp(clearance + this.randRange(8, 26 + difficulty * 18), clearance + 6, 140);
    const top = clamp(this.groundY() - this.player.baseHeight - offset, 48, this.groundY() - height - 12);
    const bar = this.acquireObstacle({ x: baseX, y: top, w: width, h: height, type: 'bar' });
    this.obstacles.push(bar);
    if (difficulty > 0.65 && this.rand() < 0.45) {
      const width2 = clamp(this.randRange(26, 42 + difficulty * 28), 20, 120);
      const height2 = clamp(this.randRange(32, 54 + difficulty * 30), 20, 130);
      const top2 = this.groundY() - height2;
      const block = this.acquireObstacle({
        x: baseX + this.randRange(-46, 30),
        y: top2,
        w: width2,
        h: height2,
        type: 'block',
      });
      this.obstacles.push(block);
    }
  }

  acquireObstacle(props = {}) {
    const obstacle = this.obstaclePool.pop() || {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      type: 'block',
      fromLevel: false,
      passed: false,
      justPassed: false,
      active: false,
    };
    obstacle.x = Number.isFinite(props.x) ? props.x : 0;
    obstacle.y = Number.isFinite(props.y) ? props.y : 0;
    obstacle.w = Number.isFinite(props.w) ? props.w : 20;
    obstacle.h = Number.isFinite(props.h) ? props.h : 20;
    obstacle.type = props.type || 'block';
    obstacle.fromLevel = !!props.fromLevel;
    obstacle.passed = false;
    obstacle.justPassed = false;
    obstacle.active = true;
    return obstacle;
  }

  recycleObstacle(obstacle) {
    if (!obstacle) return;
    obstacle.active = false;
    obstacle.fromLevel = false;
    obstacle.passed = false;
    obstacle.justPassed = false;
    this.obstaclePool.push(obstacle);
  }

  releaseObstacleAtIndex(index) {
    const obstacle = this.obstacles[index];
    if (!obstacle) return;
    this.obstacles.splice(index, 1);
    this.recycleObstacle(obstacle);
  }

  clearActiveEntities() {
    for (const obstacle of this.obstacles) {
      this.recycleObstacle(obstacle);
    }
    this.obstacles.length = 0;
    for (const coin of this.coins) {
      this.recycleCoin(coin);
    }
    this.coins.length = 0;
    for (const particle of this.particles) {
      this.recycleParticle(particle);
    }
    this.particles.length = 0;
  }

  acquireCoin() {
    const coin = this.coinPool.pop() || {
      x: 0,
      y: 0,
      baseY: 0,
      radius: 12,
      phase: 0,
      oscAmp: 10,
      oscSpeed: 0.12,
      collected: false,
      fade: 1,
      active: false,
    };
    coin.collected = false;
    coin.fade = 1;
    coin.active = true;
    return coin;
  }

  recycleCoin(coin) {
    if (!coin) return;
    coin.active = false;
    coin.collected = false;
    this.coinPool.push(coin);
  }

  acquireParticle() {
    const particle = this.particlePool.pop() || {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0,
      size: 2,
      color: 'rgba(255,255,255,1)',
      gravity: 0.4,
      active: false,
    };
    particle.active = true;
    return particle;
  }

  recycleParticle(particle) {
    if (!particle) return;
    particle.active = false;
    this.particlePool.push(particle);
  }

  spawnCoinPattern() {
    const count = 3 + Math.floor(this.randRange(0, 4));
    const baseX = VIRTUAL_WIDTH + this.randRange(80, 160);
    const baseHeight = clamp(this.groundY() - this.randRange(60, 180), 80, this.groundY() - 40);
    const spacing = this.randRange(42, 58);
    const amplitude = this.randRange(8, 18);
    const oscSpeed = this.randRange(0.08, 0.16);
    for (let i = 0; i < count; i++) {
      const coin = this.acquireCoin();
      coin.x = baseX + spacing * i;
      coin.baseY = baseHeight + Math.sin(i * 0.55) * amplitude;
      coin.y = coin.baseY;
      coin.radius = 12;
      coin.phase = this.randRange(0, Math.PI * 2);
      coin.oscAmp = amplitude;
      coin.oscSpeed = oscSpeed + this.randRange(-0.02, 0.02);
      coin.collected = false;
      this.coins.push(coin);
    }
    const nextDelay = clamp(this.randRange(260, 420 - this.difficultyProgress * 80), 200, 420);
    this.coinTimer = nextDelay;
  }

  updateCoins(travel, step) {
    const player = this.player;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      coin.x -= travel;
      coin.phase += step * coin.oscSpeed * 6;
      coin.y = coin.baseY + Math.sin(coin.phase) * coin.oscAmp;
      if (!coin.collected && this.checkCoinPickup(coin, player)) {
        this.collectCoin(coin);
      }
      if (coin.collected) {
        coin.fade -= step * 0.35;
      }
      if (coin.x + coin.radius < -160 || coin.fade <= 0) {
        this.releaseCoinAtIndex(i);
      }
    }
  }

  releaseCoinAtIndex(index) {
    const coin = this.coins[index];
    if (!coin) return;
    this.coins.splice(index, 1);
    this.recycleCoin(coin);
  }

  checkCoinPickup(coin, player) {
    const cx = coin.x;
    const cy = coin.y;
    const nearestX = clamp(cx, player.x, player.x + player.width);
    const nearestY = clamp(cy, player.y, player.y + player.height);
    const dx = cx - nearestX;
    const dy = cy - nearestY;
    return dx * dx + dy * dy <= (coin.radius * coin.radius);
  }

  collectCoin(coin) {
    coin.collected = true;
    playSfx('powerup');
    this.analytics.coins += 1;
    this.triggerHaptic();
    this.spawnCoinBurst(coin.x, coin.y);
  }

  triggerHaptic(duration = 14) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(duration);
      }
    } catch (_) {
      /* ignore haptic errors */
    }
  }

  spawnCoinBurst(x, y) {
    const particles = 6 + Math.floor(this.randRange(0, 4));
    for (let i = 0; i < particles; i++) {
      const particle = this.acquireParticle();
      const angle = this.randRange(0, Math.PI * 2);
      const speed = this.randRange(1.5, 2.8);
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed * 6;
      particle.vy = Math.sin(angle) * speed * 6;
      particle.life = this.randRange(10, 18);
      particle.maxLife = particle.life;
      particle.size = this.randRange(2, 4.2);
      particle.color = 'rgba(250,204,21,1)';
      particle.gravity = 0.45;
      this.particles.push(particle);
    }
  }

  updateParticles(step) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.life -= step;
      if (particle.life <= 0) {
        this.releaseParticleAtIndex(i);
        continue;
      }
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.vy += particle.gravity * step;
    }
  }

  releaseParticleAtIndex(index) {
    const particle = this.particles[index];
    if (!particle) return;
    this.particles.splice(index, 1);
    this.recycleParticle(particle);
  }

  updateObstacles(travel) {
    const playerFront = this.player.x;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      const prevX = obs.x;
      obs.x -= travel;
      if (!obs.passed && prevX + obs.w >= playerFront && obs.x + obs.w < playerFront) {
        this.handleObstaclePassed(obs, prevX);
      }
      if (obs.x + obs.w < -160) {
        this.releaseObstacleAtIndex(i);
      }
    }
  }

  handleObstaclePassed(obs, prevX) {
    if (!obs) return;
    obs.passed = true;
    obs.justPassed = false;
    const p = this.player;
    const prevRight = prevX + obs.w;
    const overlapped = prevX < p.x + p.width && prevRight > p.x;
    if (!overlapped) return;
    const playerBottom = p.y + p.height;
    let verticalGap = 0;
    if (playerBottom <= obs.y) {
      verticalGap = obs.y - playerBottom;
    } else if (p.y >= obs.y + obs.h) {
      verticalGap = p.y - (obs.y + obs.h);
    } else {
      verticalGap = 0;
    }
    if (verticalGap <= 18) {
      this.analytics.nearMisses += 1;
      if (verticalGap <= 8) {
        const perfectBar = obs.type === 'bar' && (p.sliding || p.height === p.slideHeight);
        const perfectJump = obs.type !== 'bar' && !p.grounded;
        if (perfectBar || perfectJump) {
          this.analytics.perfects += 1;
        }
      }
    }
  }

  updateAnalyticsDisplay(force = false) {
    const distanceStat = Math.max(0, Math.floor(this.distance));
    if ((force || distanceStat !== this.analytics.lastDistance) && this.hud.distance) {
      this.hud.distance.textContent = String(distanceStat);
      this.analytics.lastDistance = distanceStat;
    }
    if ((force || this.analytics.nearMisses !== this.analytics.lastNearMisses) && this.hud.nearMisses) {
      this.hud.nearMisses.textContent = String(this.analytics.nearMisses);
      this.analytics.lastNearMisses = this.analytics.nearMisses;
    }
    if ((force || this.analytics.perfects !== this.analytics.lastPerfects) && this.hud.perfects) {
      this.hud.perfects.textContent = String(this.analytics.perfects);
      this.analytics.lastPerfects = this.analytics.perfects;
    }
  }

  updateBackground(travel) {
    const ground = this.groundY();
    const cloudsSpeed = travel * 0.25;
    const buildingSpeed = travel * 0.5;
    const foregroundSpeed = travel * 0.8;

    for (const cloud of this.background.clouds) {
      cloud.x -= cloudsSpeed;
      if (cloud.x + cloud.w < -200) {
        cloud.x = VIRTUAL_WIDTH + this.randRange(0, 240);
        cloud.y = clamp(this.randRange(0, 1) * 140 + 20, 40, 160);
      }
    }
    for (const building of this.background.buildings) {
      building.x -= buildingSpeed;
      if (building.x + building.w < -220) {
        building.x = VIRTUAL_WIDTH + this.randRange(0, 320);
        building.w = clamp(80 + this.randRange(0, 140), 60, 240);
        building.h = clamp(120 + this.randRange(0, 140), 120, ground - 40);
      }
    }
    for (const fg of this.background.foreground) {
      fg.x -= foregroundSpeed;
      if (fg.x + fg.w < -140) {
        fg.x = VIRTUAL_WIDTH + this.randRange(0, 200);
        fg.w = clamp(40 + this.randRange(0, 80), 40, 140);
        fg.h = clamp(20 + this.randRange(0, 30), 20, 60);
      }
    }
  }

  queueJump() {
    this.input.jumpQueued = true;
    this.player.jumpBuffer = this.jumpBufferFrames;
  }

  updatePlayer(step) {
    const groundTop = this.groundY();
    const p = this.player;
    if (p.jumpBuffer > 0) {
      p.jumpBuffer = Math.max(0, p.jumpBuffer - step);
    } else {
      this.input.jumpQueued = false;
    }

    if (this.input.jumpQueued && (p.grounded || p.coyote > 0)) {
      playSfx('jump');
      p.vy = -this.jumpImpulse;
      p.grounded = false;
      p.coyote = 0;
      p.jumpBuffer = 0;
      this.input.jumpQueued = false;
    }

    if (p.grounded) {
      p.coyote = this.coyoteFrames;
    } else if (p.coyote > 0) {
      p.coyote = Math.max(0, p.coyote - step);
    }

    if (this.input.slideHeld && p.grounded && !p.sliding) {
      p.sliding = true;
      p.slideTimer = this.slideDuration;
      p.height = p.slideHeight;
      p.y = groundTop - p.height;
    }

    if (p.sliding) {
      p.slideTimer -= step;
      if ((!this.input.slideHeld && p.slideTimer <= 0) || !p.grounded) {
        p.sliding = false;
        p.height = p.baseHeight;
        p.y = Math.min(p.y, groundTop - p.height);
      }
    } else if (!this.input.slideHeld && p.height !== p.baseHeight && p.grounded) {
      p.height = p.baseHeight;
      p.y = groundTop - p.height;
    }

    const gliding = this.input.jumpHeld && !p.grounded && p.vy >= 0;
    const gravityScale = gliding ? 0.55 : 1;
    p.vy = clamp(p.vy + this.gravity * gravityScale * step, -this.jumpImpulse, this.maxFallSpeed);
    if (gliding) {
      p.vy = Math.min(p.vy, this.maxFallSpeed * 0.65);
    }
    p.y += p.vy * step;

    const maxY = groundTop - p.height;
    if (p.y >= maxY) {
      p.y = maxY;
      p.vy = 0;
      p.grounded = true;
    } else {
      p.grounded = false;
    }

    if (!this.input.jumpHeld && p.vy < -4) {
      p.vy += 0.8 * step;
    }
  }

  updateScoreDisplay(force = false) {
    const newScore = Math.max(0, Math.floor(this.distance / 10));
    if (force || newScore !== this.lastDrawnScore) {
      this.score = newScore;
      this.lastDrawnScore = newScore;
      if (this.hud.score) {
        this.hud.score.textContent = String(newScore);
        // Shell observer expects the score attribute to stay in sync.
        this.hud.score.dataset.gameScore = String(newScore);
      }
      emitRunnerScore(this, newScore, {
        distance: Math.floor(this.distance),
        nearMisses: this.analytics.nearMisses,
        perfects: this.analytics.perfects,
        coins: this.analytics.coins,
      });
    }
  }

  checkCollisions() {
    if (this.gameOver) return;
    const p = this.player;
    for (const obs of this.obstacles) {
      if (p.x < obs.x + obs.w && p.x + p.width > obs.x && p.y < obs.y + obs.h && p.y + p.height > obs.y) {
        this.triggerGameOver();
        return;
      }
    }
  }

  triggerGameOver() {
    if (this.gameOver) return;
    playSfx('powerdown', { allowWhilePaused: true });
    this.gameOver = true;
    this.paused = true;
    this.pauseReason = 'gameover';
    setAudioPaused(true);
    if (this.hud.shareBtn) this.hud.shareBtn.hidden = false;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.persistBestScore();
    }
    this.updateMission();
    emitStateEvent(this, 'game-over');
    this.updateAnalyticsDisplay(true);
    emitRunnerScore(this, this.score, {
      bestScore: this.bestScore,
      status: 'game-over',
      distance: Math.floor(this.distance),
      nearMisses: this.analytics.nearMisses,
      perfects: this.analytics.perfects,
      coins: this.analytics.coins,
    });
    if (this.scenes) {
      const payload = {
        score: this.score,
        bestScore: this.bestScore,
        distance: Math.floor(this.distance || 0),
        difficulty: this.difficulty,
        levelName: this.levelName,
      };
      this.dispatchAction('gameover', { source: 'engine', ...payload });
    }
  }

  handleKeyDown(e) {
    const key = e.key;
    const top = this.scenes?.currentId;
    if (key === 'p' || key === 'P') {
      e.preventDefault();
      this.togglePause();
      return;
    }
    if (key === 'Enter') {
      if (top === 'title' || top === 'gameover') {
        e.preventDefault();
        this.dispatchAction('start', { source: 'keyboard' });
        return;
      }
      if (top === 'pause') {
        e.preventDefault();
        this.dispatchAction('resume', { source: 'keyboard' });
        return;
      }
    }
    if (key === 'r' || key === 'R') {
      if (top === 'gameover' || this.gameOver) {
        e.preventDefault();
        this.dispatchAction('restart', { source: 'keyboard' });
        return;
      }
    }
    const isJumpKey = key === ' ' || key === 'Spacebar' || key === 'ArrowUp' || key === 'w' || key === 'W';
    if (isJumpKey) {
      if (top !== 'gameplay') {
        if (top === 'title') {
          e.preventDefault();
          this.dispatchAction('start', { source: 'keyboard' });
        } else if (top === 'pause' && this.pauseReason !== 'shell') {
          e.preventDefault();
          this.dispatchAction('resume', { source: 'keyboard' });
        }
        return;
      }
      if (!this.input.jumpHeld) this.queueJump();
      this.input.jumpHeld = true;
      e.preventDefault();
      return;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
      if (top !== 'gameplay') return;
      this.input.slideHeld = true;
      e.preventDefault();
    }
  }

  handleKeyUp(e) {
    const key = e.key;
    const top = this.scenes?.currentId;
    if (key === ' ' || key === 'Spacebar' || key === 'ArrowUp' || key === 'w' || key === 'W') {
      if (top !== 'gameplay') return;
      this.input.jumpHeld = false;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
      if (top !== 'gameplay') return;
      this.input.slideHeld = false;
    }
  }

  handlePointerDown(e) {
    if (this.scenes?.currentId !== 'gameplay') {
      e.preventDefault();
      return;
    }
    if (typeof this.canvas.setPointerCapture === 'function') {
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    }
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    this.touchState.active = true;
    this.touchState.pointerId = e.pointerId;
    this.touchState.startX = e.clientX;
    this.touchState.startY = e.clientY;
    this.touchState.lastX = e.clientX;
    this.touchState.lastY = e.clientY;
    this.touchState.handled = false;
    this.touchState.intent = null;
    this.touchState.startTime = now;
    this.input.slideHeld = false;
    this.input.jumpHeld = false;
    e.preventDefault();
  }

  handlePointerMove(e) {
    if (!this.touchState.active || (this.touchState.pointerId !== null && e.pointerId !== this.touchState.pointerId)) {
      return;
    }
    const dx = e.clientX - this.touchState.startX;
    const dy = e.clientY - this.touchState.startY;
    this.touchState.lastX = e.clientX;
    this.touchState.lastY = e.clientY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const threshold = 24;
    if (!this.touchState.handled) {
      if (absY > threshold && absY > absX) {
        this.touchState.handled = true;
        if (dy < 0) {
          this.queueJump();
          this.input.jumpHeld = true;
          this.touchState.intent = 'jump';
        } else {
          this.input.slideHeld = true;
          this.touchState.intent = 'slide';
        }
      }
    } else if (this.touchState.intent === 'jump') {
      this.input.jumpHeld = true;
    } else if (this.touchState.intent === 'slide') {
      this.input.slideHeld = dy > -threshold * 0.6;
    }
    e.preventDefault();
  }

  handlePointerUp(e) {
    if (this.scenes?.currentId !== 'gameplay') {
      e.preventDefault();
      return;
    }
    if (typeof this.canvas.releasePointerCapture === 'function') {
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    if (!this.touchState.active || (this.touchState.pointerId !== null && e.pointerId !== this.touchState.pointerId)) {
      return;
    }
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const duration = now - this.touchState.startTime;
    const totalDx = (this.touchState.lastX ?? e.clientX) - this.touchState.startX;
    const totalDy = (this.touchState.lastY ?? e.clientY) - this.touchState.startY;
    const absDx = Math.abs(totalDx);
    const absDy = Math.abs(totalDy);
    const threshold = 24;
    if (!this.touchState.handled) {
      if (absDy > threshold && absDy > absDx) {
        if (totalDy < 0) {
          this.queueJump();
          this.input.jumpHeld = true;
        } else {
          this.input.slideHeld = true;
        }
      } else if (absDx < threshold && absDy < threshold && duration < 220) {
        this.queueJump();
        this.input.jumpHeld = true;
      }
    }
    this.input.slideHeld = false;
    this.input.jumpHeld = false;
    this.touchState.active = false;
    this.touchState.pointerId = null;
    this.touchState.intent = null;
    this.touchState.handled = false;
    e.preventDefault();
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.handleShellPause();
    } else {
      this.handleShellResume();
    }
  }

  handleShellPause() {
    if (this.gameOver || this.scenes?.currentId === 'pause') return;
    this.wasPausedByVisibility = true;
    this.dispatchAction('pause', { source: 'shell', reason: 'shell' });
  }

  handleShellResume() {
    if (document.hidden) return;
    if (!this.wasPausedByVisibility) return;
    this.wasPausedByVisibility = false;
    if (!this.gameOver) this.dispatchAction('resume', { source: 'shell' });
  }

  handleShellMessage(event) {
    const data = event && typeof event.data === 'object' ? event.data : null;
    const type = data?.type;
    if (type === 'GAME_PAUSE' || type === 'GG_PAUSE') this.handleShellPause();
    if (type === 'GAME_RESUME' || type === 'GG_RESUME') this.handleShellResume();
  }

  draw() {
    if(!postedReady){
      postedReady = true;
      try { window.parent?.postMessage({ type:'GAME_READY', slug:'runner' }, '*'); } catch {}
    }
    const ctx = this.ctx;
    const canSave = typeof ctx.save === 'function';
    if (canSave) ctx.save();
    if (typeof ctx.setTransform === 'function') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scaleFactor, this.scaleFactor);
    // Apply a uniform scale with letterboxing so the virtual resolution keeps its aspect.

    const gradient = typeof ctx.createLinearGradient === 'function'
      ? ctx.createLinearGradient(0, 0, 0, VIRTUAL_HEIGHT)
      : null;
    if (gradient) {
      gradient.addColorStop(0, SKY_GRADIENT[0]);
      gradient.addColorStop(1, SKY_GRADIENT[1]);
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = SKY_GRADIENT[1];
    }
    ctx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

    this.drawParallax(ctx);
    this.drawBackground(ctx);
    this.drawGround(ctx);
    this.drawObstacles(ctx);
    this.drawCoins(ctx);
    this.drawPlayer(ctx);
    this.drawParticles(ctx);
    if (this.gameOver) {
      this.drawGameOver(ctx);
    }
    if (canSave && typeof ctx.restore === 'function') ctx.restore();
  }

  drawParallax(ctx) {
    if (!Array.isArray(this.parallaxLayers) || !this.parallaxLayers.length) return;
    for (const layer of this.parallaxLayers) {
      if (!layer) continue;
      const repeatWidth = Math.max(1, Math.floor(layer.repeatWidth || layer.canvas?.width || VIRTUAL_WIDTH));
      if (!Number.isFinite(repeatWidth) || repeatWidth <= 0) continue;
      let startX = -(layer.offset ?? 0);
      if (!Number.isFinite(startX)) startX = 0;
      while (startX > -repeatWidth) startX -= repeatWidth;
      ctx.save();
      ctx.globalAlpha = clamp(layer.alpha ?? 1, 0, 1);
      const canDrawImage = typeof ctx.drawImage === 'function';
      if (layer.canvas && layer.canvas.width > 0 && layer.canvas.height > 0 && canDrawImage) {
        const tileWidth = layer.canvas.width;
        const tileHeight = layer.canvas.height;
        for (let x = startX; x < VIRTUAL_WIDTH; x += repeatWidth) {
          ctx.drawImage(layer.canvas, x, 0, tileWidth, tileHeight);
        }
      } else if (Array.isArray(layer.shapes) && layer.shapes.length) {
        for (let x = startX; x < VIRTUAL_WIDTH; x += repeatWidth) {
          for (const shape of layer.shapes) {
            if (!shape) continue;
            ctx.fillStyle = shape.color || '#1e293b';
            ctx.fillRect(x + shape.x, shape.y, shape.w, shape.h);
          }
        }
      } else if (layer.canvas && layer.canvas.width > 0 && layer.canvas.height > 0) {
        // Fallback for environments without drawImage support
        const shapes = Array.isArray(layer.shapes) ? layer.shapes : [];
        for (let x = startX; x < VIRTUAL_WIDTH; x += repeatWidth) {
          for (const shape of shapes) {
            if (!shape) continue;
            ctx.fillStyle = shape.color || '#1e293b';
            ctx.fillRect(x + shape.x, shape.y, shape.w, shape.h);
          }
        }
      }
      ctx.restore();
    }
  }

  drawBackground(ctx) {
    const ground = this.groundY();
    const buildingPattern = getTilePattern(ctx, 'industrial')
      || getTilePattern(ctx, 'brick')
      || getTilePattern(ctx, 'block');
    const stripePattern = getTilePattern(ctx, 'lava');
    const foregroundPattern = getTilePattern(ctx, 'industrial') || getTilePattern(ctx, 'block');

    this.background.clouds.forEach((cloud, index) => {
      const left = cloud.x - cloud.w / 2;
      const top = cloud.y - cloud.h / 2;
      ctx.save();
      ctx.globalAlpha = 0.8;
      const spriteKey = index % 2 === 0 ? 'cloud1' : 'cloud2';
      const rendered = drawTileSprite(ctx, spriteKey, left, top, cloud.w, cloud.h);
      ctx.restore();
      if (!rendered) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.ellipse(cloud.x, cloud.y, cloud.w / 2, cloud.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    for (const building of this.background.buildings) {
      const top = ground - building.h;
      ctx.save();
      if (buildingPattern) {
        ctx.fillStyle = buildingPattern;
      } else {
        ctx.fillStyle = '#1f2937';
      }
      ctx.fillRect(building.x, top, building.w, building.h);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = 0.35;
    if (stripePattern) {
      ctx.fillStyle = stripePattern;
      for (let i = 0; i < 12; i++) {
        const x = (i / 12) * VIRTUAL_WIDTH;
        ctx.fillRect(x, 0, 10, VIRTUAL_HEIGHT);
      }
    } else {
      ctx.fillStyle = '#0f172a';
      for (let i = 0; i < 12; i++) {
        const x = (i / 12) * VIRTUAL_WIDTH;
        ctx.fillRect(x, 0, 2, VIRTUAL_HEIGHT);
      }
    }
    ctx.restore();

    for (const fg of this.background.foreground) {
      const top = ground - fg.h / 2;
      ctx.save();
      if (foregroundPattern) {
        ctx.fillStyle = foregroundPattern;
      } else {
        ctx.fillStyle = '#172554';
      }
      ctx.fillRect(fg.x, top, fg.w, fg.h / 2);
      ctx.restore();
    }
  }

  drawGround(ctx) {
    const ground = this.groundY();
    const basePattern = getTilePattern(ctx, 'industrial') || getTilePattern(ctx, 'block');
    const accentPattern = getTilePattern(ctx, 'lava');

    ctx.save();
    ctx.fillStyle = basePattern || '#0b1120';
    ctx.fillRect(0, ground, VIRTUAL_WIDTH, GROUND_HEIGHT);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = accentPattern || '#1e293b';
    ctx.fillRect(0, ground, VIRTUAL_WIDTH, 18);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, ground);
    ctx.lineTo(VIRTUAL_WIDTH, ground);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.55;
    let highlightsDrawn = false;
    for (let i = 0; i < 6; i++) {
      const start = (i / 6) * VIRTUAL_WIDTH;
      const x = start + (this.distance % 120);
      highlightsDrawn = drawTileSprite(ctx, 'portal', x - 12, ground + 18, 32, 18) || highlightsDrawn;
    }
    if (!highlightsDrawn) {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#38bdf8';
      for (let i = 0; i < 6; i++) {
        const start = (i / 6) * VIRTUAL_WIDTH;
        ctx.fillRect(start + (this.distance % 120), ground + 30, 40, 4);
      }
    }
    ctx.restore();
  }

  drawObstacles(ctx) {
    const hazardPattern = getTilePattern(ctx, 'lava');
    const barPattern = getTilePattern(ctx, 'industrial')
      || getTilePattern(ctx, 'brick')
      || getTilePattern(ctx, 'block');
    for (const obs of this.obstacles) {
      ctx.save();
      if (obs.type === 'bar') {
        if (barPattern) {
          ctx.fillStyle = barPattern;
        } else {
          ctx.fillStyle = '#facc15';
        }
        ctx.fillRect(obs.x, obs.y, obs.w, obs.h);

        ctx.save();
        ctx.globalAlpha = 0.85;
        const topperRendered = drawTileSprite(ctx, 'cloud2', obs.x - 6, obs.y - 16, obs.w + 12, 18);
        ctx.restore();
        if (!topperRendered) {
          ctx.fillStyle = 'rgba(250,204,21,0.45)';
          ctx.fillRect(obs.x, obs.y + obs.h, obs.w, 8);
        }
      } else {
        if (hazardPattern) {
          ctx.fillStyle = hazardPattern;
        } else {
          ctx.fillStyle = '#f87171';
        }
        ctx.fillRect(obs.x, obs.y, obs.w, obs.h);

        ctx.save();
        ctx.globalAlpha = 0.85;
        const glowRendered = drawTileSprite(ctx, 'portal', obs.x - 8, obs.y - 22, obs.w + 16, 26);
        ctx.restore();
        if (!glowRendered) {
          ctx.strokeStyle = 'rgba(248,113,113,0.4)';
          ctx.lineWidth = 2;
          ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
        }
      }
      ctx.restore();
    }
  }

  drawCoins(ctx) {
    if (!this.coins.length) return;
    ctx.save();
    for (const coin of this.coins) {
      const alpha = coin.collected ? clamp(coin.fade, 0, 1) : 1;
      if (alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      const radius = coin.radius;
      let gradient = null;
      if (typeof ctx.createRadialGradient === 'function') {
        gradient = ctx.createRadialGradient(coin.x, coin.y, radius * 0.15, coin.x, coin.y, radius);
        gradient.addColorStop(0, 'rgba(253,224,71,1)');
        gradient.addColorStop(1, 'rgba(234,179,8,0.9)');
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = 'rgba(253,224,71,0.95)';
      }
      ctx.beginPath();
      ctx.arc(coin.x, coin.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(251,191,36,0.85)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(coin.x - radius * 0.35, coin.y - radius * 0.3, radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  drawPlayer(ctx) {
    const p = this.player;
    const bodyHeight = Math.max(18, p.height - 12);
    const bodyTop = p.y + (p.height - bodyHeight);

    ctx.save();
    const bodyRendered = drawTileSprite(ctx, 'portal', p.x, bodyTop, p.width, bodyHeight);
    if (!bodyRendered) {
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(p.x, bodyTop, p.width, bodyHeight);
    }
    ctx.restore();

    const headSize = Math.min(p.width * 0.9, Math.max(18, bodyHeight * 0.45));
    const headY = bodyTop - headSize * 0.6;
    ctx.save();
    ctx.globalAlpha = 0.95;
    const headRendered = drawTileSprite(
      ctx,
      'cloud1',
      p.x + (p.width - headSize) / 2,
      headY,
      headSize,
      headSize,
    );
    ctx.restore();
    if (!headRendered) {
      ctx.save();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.ellipse(
        p.x + p.width / 2,
        headY + headSize / 2,
        headSize / 2,
        headSize / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }

    const boosterPattern = getTilePattern(ctx, 'lava');
    ctx.save();
    ctx.globalAlpha = 0.75;
    if (boosterPattern) {
      ctx.fillStyle = boosterPattern;
      ctx.fillRect(p.x - 6, p.y + p.height - 12, 6, 12);
    } else {
      ctx.fillStyle = 'rgba(34,211,238,0.6)';
      ctx.fillRect(p.x - 8, p.y + p.height * 0.65, 6, 10);
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(p.x + p.width * 0.65, p.y + p.height * 0.2, 6, 6);
    ctx.fillRect(p.x + p.width * 0.65, p.y + p.height * 0.45, 6, 6);
    ctx.restore();
  }

  drawParticles(ctx) {
    if (!this.particles.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of this.particles) {
      const lifeRatio = particle.maxLife ? clamp(particle.life / particle.maxLife, 0, 1) : 0;
      const alpha = lifeRatio * 0.85;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color || 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(1.2, particle.size || 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawGameOver(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    if (typeof ctx.fillText === 'function') {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Game Over', VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2 - 18);
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(`Distance: ${this.score} m`, VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2 + 12);
      ctx.fillText('Press Restart to try again', VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2 + 40);
    }
  }
}

let instance = null;
let autoBootScheduled = false;
let communityLevelLoaded = false;

export function boot(context = {}) {
  const canvas = resolveCanvas(context);
  if (!canvas) {
    console.error('[runner] missing #game canvas');
    return null;
  }
  if (instance) {
    instance.attachCanvas(canvas);
    const diff = context?.meta?.difficulty;
    if (diff && DIFFICULTY_SETTINGS[diff]) instance.setDifficulty(diff);
    instance.start();
    notifyRunnerReady(instance);
    registerRunnerAdapter(instance);
    return instance;
  }
  Controls?.init?.();
  instance = new RunnerGame(canvas, context);
  registerRunnerAdapter(instance);
  notifyRunnerReady(instance);
  maybeLoadExternalLevel(instance);
  return instance;
}

async function maybeLoadExternalLevel(game) {
  if (!game || communityLevelLoaded) return;
  if (typeof fetch !== 'function') return;
  try {
    const res = await fetch('./levels.json');
    const list = await res.json();
    const entries = Array.isArray(list) ? list : Array.isArray(list.levels) ? list.levels : [];
    const first = entries.find(item => item && item.url);
    if (!first) return;
    const levelRes = await fetch(first.url);
    const levelData = await levelRes.json();
    if (!levelData || typeof levelData !== 'object' || !Array.isArray(levelData.obstacles)) return;
    communityLevelLoaded = true;
    const autoStart = game?.scenes?.currentId === 'gameplay';
    game.loadLevel(levelData, {
      resetScore: true,
      silent: false,
      name: first.name || levelData.name || '',
      autoStart,
    });
  } catch (err) {
    // ignore fetch failures
  }
}

if (typeof window !== 'undefined') {
  window.loadRunnerLevel = level => {
    if (!instance) {
      boot();
    }
    const autoStart = !!instance && !instance.paused && !instance.gameOver;
    instance?.loadLevel(level, { resetScore: true, silent: false, autoStart });
  };

  window.addEventListener('beforeunload', () => instance?.stop());

  if (!autoBootScheduled) {
    autoBootScheduled = true;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => boot());
    } else {
      boot();
    }
  }
}
