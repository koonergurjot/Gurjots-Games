import { Controls } from '../../src/runtime/controls.js';
import { pushEvent } from '/games/common/diag-adapter.js';
import { registerRunnerAdapter } from './adapter.js';
import { play as playSfx, setPaused as setAudioPaused } from '../../shared/juice/audio.js';
import { drawTileSprite, getTilePattern, preloadTileTextures } from '../../shared/render/tileTextures.js';

const VIRTUAL_WIDTH = 960;
const VIRTUAL_HEIGHT = 320;
const GROUND_HEIGHT = 60;
const PLAYER_X = 160;

const DIFFICULTY_SETTINGS = {
  easy: { speed: 5.5, spawnRange: [140, 220] },
  med: { speed: 6.8, spawnRange: [120, 200] },
  hard: { speed: 8.2, spawnRange: [90, 170] },
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

preloadTileTextures().catch(() => null);
let postedReady = false;

const globalScope = typeof window !== 'undefined' ? window : null;

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

    this.gravity = 0.9;
    this.jumpImpulse = 15.5;
    this.maxFallSpeed = 18;
    this.slideDuration = 22;
    this.coyoteFrames = 6;
    this.jumpBufferFrames = 6;

    this.player = this.createPlayer();
    this.obstacles = [];
    this.manualObstacles = [];
    this.manualIndex = 0;
    this.background = this.buildBackground(DEFAULT_LEVEL.background);
    this.distance = 0;
    this.spawnTimer = 160;
    this.score = 0;
    this.lastDrawnScore = -1;
    this.bestScore = 0;
    this.difficulty = 'med';
    this.speed = DIFFICULTY_SETTINGS.med.speed;
    this.spawnRange = [...DIFFICULTY_SETTINGS.med.spawnRange];
    this.levelName = '';

    this.input = {
      jumpHeld: false,
      jumpQueued: false,
      slideHeld: false,
    };

    this.hud = {
      score: document.getElementById('score'),
      mission: document.getElementById('mission'),
      pauseBtn: document.getElementById('pauseBtn'),
      restartBtn: document.getElementById('restartBtn'),
      shareBtn: document.getElementById('shareBtn'),
      diffSel: document.getElementById('diffSel'),
    };

    this.boundLoop = this.loop.bind(this);
    this.onResize = this.resize.bind(this);
    this.onKeyDown = this.handleKeyDown.bind(this);
    this.onKeyUp = this.handleKeyUp.bind(this);
    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);
    this.onVisibilityChange = this.handleVisibilityChange.bind(this);
    this.onShellPause = this.handleShellPause.bind(this);
    this.onShellResume = this.handleShellResume.bind(this);
    this.onShellMessage = this.handleShellMessage.bind(this);

    setAudioPaused(false);
    this.attachEvents();
    this.readPreferences(context);
    this.resize();
    this.restoreBestScore();
    this.setDifficulty(this.difficulty);
    this.loadLevel(DEFAULT_LEVEL, { resetScore: true, silent: true });
    this.updateMission();
    this.start();
  }

  attachEvents() {
    window.addEventListener('resize', this.onResize);
    document.addEventListener('keydown', this.onKeyDown, { passive: false });
    document.addEventListener('keyup', this.onKeyUp, { passive: false });
    this.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    this.canvas.addEventListener('pointerup', this.onPointerUp, { passive: false });
    this.canvas.addEventListener('pointercancel', this.onPointerUp, { passive: false });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('ggshell:pause', this.onShellPause);
    window.addEventListener('ggshell:resume', this.onShellResume);
    window.addEventListener('message', this.onShellMessage, { passive: true });

    this.hud.pauseBtn?.addEventListener('click', () => this.togglePause());
    this.hud.restartBtn?.addEventListener('click', () => this.restart());
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
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('ggshell:pause', this.onShellPause);
    window.removeEventListener('ggshell:resume', this.onShellResume);
    window.removeEventListener('message', this.onShellMessage);
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
      x: numberOr(cloud.x, Math.random() * VIRTUAL_WIDTH),
      y: numberOr(cloud.y, clamp(Math.random() * 140 + 20, 40, 160)),
      w: clamp(numberOr(cloud.w, 120), 60, 220),
      h: clamp(numberOr(cloud.h, 44), 28, 80),
    });
    const makeBuilding = building => ({
      x: numberOr(building.x, Math.random() * (VIRTUAL_WIDTH + 200)),
      w: clamp(numberOr(building.w, 120), 60, 240),
      h: clamp(numberOr(building.h, 180), 120, this.groundY() - 40),
    });
    const makeForeground = item => ({
      x: numberOr(item.x, Math.random() * (VIRTUAL_WIDTH + 200)),
      w: clamp(numberOr(item.w, 60), 40, 140),
      h: clamp(numberOr(item.h, 32), 20, 60),
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

  sanitizeLevel(level = {}) {
    const rawObstacles = Array.isArray(level.obstacles) ? level.obstacles : [];
    const ground = this.groundY();
    const sanitized = rawObstacles.map(ob => {
      const width = clamp(numberOr(ob.w, 36), 18, 120);
      const height = clamp(numberOr(ob.h, 32), 20, 180);
      const distance = Math.max(0, numberOr(ob.x, 0));
      const rawY = numberOr(ob.y, NaN);
      const top = rawY > 0 ? clamp(rawY, 0, ground - height) : ground - height;
      return { distance, y: top, w: width, h: height };
    });
    sanitized.sort((a, b) => a.distance - b.distance);
    return {
      obstacles: sanitized,
      background: level.background || {},
      name: typeof level.name === 'string' ? level.name : '',
    };
  }

  loadLevel(level, opts = {}) {
    const { resetScore = false, silent = false, name = '' } = opts;
    const prepared = this.sanitizeLevel(level);
    this.currentLevel = prepared;
    this.levelName = name || prepared.name || this.levelName || '';
    this.manualObstacles = prepared.obstacles;
    this.manualIndex = 0;
    this.obstacles = [];
    this.background = this.buildBackground(prepared.background);
    this.spawnTimer = 120;
    if (resetScore) {
      this.distance = 0;
      this.score = 0;
      this.lastDrawnScore = -1;
      this.player = this.createPlayer();
      this.input.jumpQueued = false;
      this.input.jumpHeld = false;
      this.input.slideHeld = false;
      this.gameOver = false;
      this.paused = false;
      if (this.hud.shareBtn) this.hud.shareBtn.hidden = true;
      this.updateScoreDisplay(true);
    }
    if (!silent) {
      this.updateMission();
    }
    this.resume();
    this.start();
  }

  restart() {
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
    const entry = DIFFICULTY_SETTINGS[difficulty];
    const key = entry ? difficulty : 'med';
    const settings = entry || DIFFICULTY_SETTINGS.med;
    this.difficulty = key;
    this.speed = settings.speed;
    this.spawnRange = [...settings.spawnRange];
    if (this.hud.diffSel) this.hud.diffSel.value = key;
    try {
      localStorage.setItem('runner:difficulty', key);
    } catch (err) {
      // ignore storage
    }
    this.updateMission();
  }

  updateMission(customText) {
    if (!this.hud.mission) return;
    if (customText) {
      this.hud.mission.textContent = customText;
      return;
    }
    const difficultyLabel = this.difficulty.charAt(0).toUpperCase() + this.difficulty.slice(1);
    const levelLabel = this.levelName ? `${this.levelName} • ` : '';
    if (this.gameOver) {
      this.hud.mission.textContent = `${levelLabel}Game Over • Best ${this.bestScore} m`;
    } else if (this.paused) {
      this.hud.mission.textContent = `${levelLabel}Paused`;
    } else {
      this.hud.mission.textContent = `${levelLabel}Difficulty: ${difficultyLabel} • Best ${this.bestScore} m`;
    }
  }

  togglePause() {
    if (this.gameOver) return;
    if (this.paused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  pause() {
    if (this.gameOver) return;
    this.paused = true;
    setAudioPaused(true);
    if (this.hud.pauseBtn) this.hud.pauseBtn.textContent = '▶️';
    this.updateMission();
    emitStateEvent(this, 'paused');
  }

  resume() {
    this.paused = false;
    this.lastTime = performance.now();
    setAudioPaused(false);
    if (this.hud.pauseBtn) this.hud.pauseBtn.textContent = '⏸️';
    this.updateMission();
    emitStateEvent(this, 'running');
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

  advanceStep(step) {
    const travel = this.speed * step;
    this.distance += travel;
    this.spawnTimer -= travel;
    this.spawnManualObstacles();
    if (this.spawnTimer <= 0) {
      this.spawnRandomObstacle();
    }
    this.updateObstacles(travel);
    this.updatePlayer(step);
    this.updateBackground(travel);
    this.updateScoreDisplay();
    this.checkCollisions();
  }

  spawnManualObstacles() {
    const windowAhead = VIRTUAL_WIDTH * 1.4;
    while (this.manualIndex < this.manualObstacles.length) {
      const next = this.manualObstacles[this.manualIndex];
      const distanceAhead = Math.max(0, next.distance - this.distance);
      if (distanceAhead <= windowAhead) {
        this.obstacles.push({
          x: PLAYER_X + distanceAhead,
          y: next.y,
          w: next.w,
          h: next.h,
          fromLevel: true,
        });
        this.manualIndex++;
      } else {
        break;
      }
    }
  }

  spawnRandomObstacle() {
    const [minGap, maxGap] = this.spawnRange;
    this.spawnTimer = minGap + Math.random() * (maxGap - minGap);
    const roll = Math.random();
    const baseX = VIRTUAL_WIDTH + 80 + Math.random() * 60;
    if (roll < 0.28) {
      const width = 70 + Math.random() * 40;
      const height = 20 + Math.random() * 12;
      const clearance = this.player.baseHeight - this.player.slideHeight + 12;
      const top = clamp(this.groundY() - this.player.baseHeight - clearance, 60, this.groundY() - height - 10);
      this.obstacles.push({ x: baseX, y: top, w: width, h: height, type: 'bar' });
    } else {
      const width = 26 + Math.random() * 26;
      const height = 34 + Math.random() * 36;
      const top = this.groundY() - height;
      this.obstacles.push({ x: baseX, y: top, w: width, h: height, type: 'block' });
    }
  }

  updateObstacles(travel) {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      obs.x -= travel;
      if (obs.x + obs.w < -120) {
        this.obstacles.splice(i, 1);
      }
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
        cloud.x = VIRTUAL_WIDTH + Math.random() * 240;
        cloud.y = clamp(Math.random() * 140 + 20, 40, 160);
      }
    }
    for (const building of this.background.buildings) {
      building.x -= buildingSpeed;
      if (building.x + building.w < -220) {
        building.x = VIRTUAL_WIDTH + Math.random() * 320;
        building.w = clamp(80 + Math.random() * 140, 60, 240);
        building.h = clamp(120 + Math.random() * 140, 120, ground - 40);
      }
    }
    for (const fg of this.background.foreground) {
      fg.x -= foregroundSpeed;
      if (fg.x + fg.w < -140) {
        fg.x = VIRTUAL_WIDTH + Math.random() * 200;
        fg.w = clamp(40 + Math.random() * 80, 40, 140);
        fg.h = clamp(20 + Math.random() * 30, 20, 60);
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

    p.vy = clamp(p.vy + this.gravity * step, -this.jumpImpulse, this.maxFallSpeed);
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
      emitRunnerScore(this, newScore);
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
    this.paused = false;
    setAudioPaused(true);
    if (this.hud.shareBtn) this.hud.shareBtn.hidden = false;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.persistBestScore();
    }
    this.updateMission();
    emitStateEvent(this, 'game-over');
    emitRunnerScore(this, this.score, {
      bestScore: this.bestScore,
      status: 'game-over',
    });
  }

  handleKeyDown(e) {
    const key = e.key;
    if (key === ' ' || key === 'Spacebar' || key === 'ArrowUp' || key === 'w' || key === 'W') {
      if (!this.input.jumpHeld) this.queueJump();
      this.input.jumpHeld = true;
      e.preventDefault();
    } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
      this.input.slideHeld = true;
      e.preventDefault();
    } else if (key === 'p' || key === 'P') {
      e.preventDefault();
      this.togglePause();
    } else if ((key === 'r' || key === 'R') && this.gameOver) {
      e.preventDefault();
      this.restart();
    }
  }

  handleKeyUp(e) {
    const key = e.key;
    if (key === ' ' || key === 'Spacebar' || key === 'ArrowUp' || key === 'w' || key === 'W') {
      this.input.jumpHeld = false;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
      this.input.slideHeld = false;
    }
  }

  handlePointerDown(e) {
    if (typeof this.canvas.setPointerCapture === 'function') {
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    }
    const rect = this.canvas.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    if (relX < rect.width / 2) {
      this.input.slideHeld = true;
    } else {
      this.queueJump();
      this.input.jumpHeld = true;
    }
    e.preventDefault();
  }

  handlePointerUp(e) {
    if (typeof this.canvas.releasePointerCapture === 'function') {
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    this.input.slideHeld = false;
    this.input.jumpHeld = false;
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
    if (this.gameOver || this.paused) return;
    this.wasPausedByVisibility = true;
    this.pause();
  }

  handleShellResume() {
    if (document.hidden) return;
    if (!this.wasPausedByVisibility) return;
    this.wasPausedByVisibility = false;
    if (!this.gameOver) this.resume();
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

    this.drawBackground(ctx);
    this.drawGround(ctx);
    this.drawObstacles(ctx);
    this.drawPlayer(ctx);
    if (this.gameOver) {
      this.drawGameOver(ctx);
    }
    if (canSave && typeof ctx.restore === 'function') ctx.restore();
  }

  drawBackground(ctx) {
    const ground = this.groundY();
    const buildingPattern = getTilePattern(ctx, 'brick') || getTilePattern(ctx, 'block');
    const stripePattern = getTilePattern(ctx, 'lava');
    const foregroundPattern = getTilePattern(ctx, 'block');

    for (const cloud of this.background.clouds) {
      const left = cloud.x - cloud.w / 2;
      const top = cloud.y - cloud.h / 2;
      ctx.save();
      ctx.globalAlpha = 0.8;
      const rendered = drawTileSprite(ctx, 'coin', left, top, cloud.w, cloud.h);
      ctx.restore();
      if (!rendered) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.ellipse(cloud.x, cloud.y, cloud.w / 2, cloud.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

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
    const basePattern = getTilePattern(ctx, 'block');
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
      highlightsDrawn = drawTileSprite(ctx, 'coin', x - 12, ground + 18, 24, 24) || highlightsDrawn;
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
    const barPattern = getTilePattern(ctx, 'brick') || getTilePattern(ctx, 'block');
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
        const topperRendered = drawTileSprite(ctx, 'goal', obs.x - 4, obs.y - 12, obs.w + 8, 12);
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
        const glowRendered = drawTileSprite(ctx, 'coin', obs.x - 6, obs.y - 18, obs.w + 12, 24);
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

  drawPlayer(ctx) {
    const p = this.player;
    const bodyHeight = Math.max(18, p.height - 12);
    const bodyTop = p.y + (p.height - bodyHeight);

    ctx.save();
    const bodyRendered = drawTileSprite(ctx, 'goal', p.x, bodyTop, p.width, bodyHeight);
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
      'coin',
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
    game.loadLevel(levelData, { resetScore: true, silent: false, name: first.name || levelData.name || '' });
  } catch (err) {
    // ignore fetch failures
  }
}

if (typeof window !== 'undefined') {
  window.loadRunnerLevel = level => {
    if (!instance) {
      boot();
    }
    instance?.loadLevel(level, { resetScore: true, silent: false });
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
