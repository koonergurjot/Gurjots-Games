import { GameEngine } from '../../shared/gameEngine.js';
import { preloadFirstFrameAssets } from '../../shared/game-asset-preloader.js';
import { play as playSfx } from '../../shared/juice/audio.js';
import getThemeTokens from '../../shared/skins/index.js';
import '../../shared/ui/hud.js';
import { pushEvent } from '/games/common/diag-adapter.js';
import '../common/diagnostics/adapter.js';

window.fitCanvasToParent = window.fitCanvasToParent || function(){ /* no-op fallback */ };

const bootStatus = (() => {
  const status = window.__bootStatus = window.__bootStatus || {};
  status.game = status.game || 'snake';
  status.started = typeof status.started === 'number' ? status.started : performance.now();
  status.logs = Array.isArray(status.logs) ? status.logs : [];
  status.watchdogs = status.watchdogs || {};

  function resolveLevel(event) {
    const name = String(event || '').toLowerCase();
    if (/error|fail|crash/.test(name)) return 'error';
    if (/stall|missing|pending|timeout|watchdog/.test(name)) return 'warn';
    return 'info';
  }

  function log(event, detail) {
    const level = resolveLevel(event);
    const message = `[snake] ${event}`;
    const entry = {
      at: performance.now(),
      event,
      detail: detail || null,
      level,
      message
    };
    status.last = entry;
    status.logs.push(entry);
    if (status.logs.length > 200) status.logs.splice(0, status.logs.length - 200);
    try {
      if (!status.silent) console.debug('[boot]', event, detail || '');
    } catch (_) {}
    pushEvent('boot', {
      level,
      message,
      details: detail || undefined
    });
    return entry;
  }

  status.log = status.log || log;

  if (!status.watchdogs.raf) {
    const nativeRAF = window.requestAnimationFrame;
    if (typeof nativeRAF !== 'function') {
      log('raf:missing');
    } else {
      let firstTick = 0;
      let lastTick = 0;
      let idleLogged = false;
      let stallLogged = false;
      status.watchdogs.raf = { firstTick: 0, lastTick: 0 };
      window.requestAnimationFrame = function wrapped(cb) {
        return nativeRAF.call(this, function(ts) {
          if (!firstTick) {
            firstTick = performance.now();
            status.watchdogs.raf.firstTick = firstTick;
            log('raf:first-tick', { elapsed: Math.round(firstTick - status.started) });
          }
          lastTick = performance.now();
          status.watchdogs.raf.lastTick = lastTick;
          return cb(ts);
        });
      };
      status.watchdogs.raf.interval = window.setInterval(() => {
        const now = performance.now();
        if (!firstTick) {
          if (!idleLogged && now - status.started > 2000) {
            idleLogged = true;
            log('watchdog:raf-not-started', { waited: Math.round(now - status.started) });
          }
          return;
        }
        const gap = now - lastTick;
        if (!stallLogged && gap > 2000) {
          stallLogged = true;
          log('watchdog:raf-stall', { gap: Math.round(gap) });
        }
      }, 1200);
    }
  }

  return status;
})();

const bootLog = bootStatus.log || function(){};
bootLog('init:start', { readyState: document.readyState });

const SLUG = 'snake';

const SPRITE_SOURCES = {
  background: [
    '/assets/backgrounds/parallax/arcade_layer1.png',
    '/assets/backgrounds/parallax/arcade_layer2.png'
  ],
  snakeHead: '/assets/sprites/enemy2.png',
  snakeBody: '/assets/sprites/block.png',
  fruit: '/assets/sprites/collectibles/gem_red.png',
  fruitGemBlue: '/assets/sprites/collectibles/gem_blue.png',
  fruitGemGreen: '/assets/sprites/collectibles/gem_green.png',
  obstacle: '/assets/tilesets/industrial.png',
  spark: '/assets/effects/spark.png',
  explosion: '/assets/effects/explosion.png'
};

const spriteCache = {};

const BACKGROUND_SCROLL_SPEEDS = [0.004, 0.008];
let backgroundScrollOffsets = [];
let lastBackgroundTime = performance.now();

function ensureSprite(name) {
  if (spriteCache[name]) return spriteCache[name];
  const source = SPRITE_SOURCES[name];
  if (Array.isArray(source)) {
    const images = source.map(src => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      return img;
    });
    spriteCache[name] = images;
    return images;
  }
  const img = new Image();
  img.decoding = 'async';
  img.src = source;
  spriteCache[name] = img;
  return img;
}

Object.keys(SPRITE_SOURCES).forEach(ensureSprite);

preloadFirstFrameAssets(SLUG).catch(() => {});

function ensureGameCanvas(){
  let canvas = document.getElementById('game');
  if (!canvas) {
    bootLog('canvas:missing', { attempt: 'create' });
    canvas = document.createElement('canvas');
    canvas.id = 'game';
    canvas.width = 640;
    canvas.height = 480;
    const mount = document.querySelector('.wrap') || document.body || document.documentElement;
    mount.appendChild(canvas);
    bootLog('canvas:created', { mount: mount?.className || mount?.nodeName || 'unknown' });
  } else {
    bootLog('canvas:found', { width: canvas.width, height: canvas.height });
  }
  if (!bootStatus.watchdogs.canvas) {
    const start = performance.now();
    let missingLogged = false;
    bootStatus.watchdogs.canvas = {
      interval: window.setInterval(() => {
        const now = performance.now();
        const w = canvas?.width || 0;
        const h = canvas?.height || 0;
        if (w && h) {
          bootLog('watchdog:canvas-ok', {
            width: w,
            height: h,
            elapsed: Math.round(now - start)
          });
          window.clearInterval(bootStatus.watchdogs.canvas.interval);
          bootStatus.watchdogs.canvas.interval = null;
        } else if (!missingLogged && now - start > 800) {
          missingLogged = true;
          bootLog('watchdog:canvas-pending', { width: w, height: h });
        }
      }, 500)
    };
  }
  return canvas;
}

function resolveHudContainer() {
  let el = document.querySelector('.hud, #hud');
  if (el && el.id === 'hud' && !el.classList.contains('hud')) {
    el.classList.add('hud');
  }
  if (!el) {
    el = document.querySelector('.hud');
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'hud';
    document.body.appendChild(el);
  }
  return el;
}

const hud = resolveHudContainer();
const scoreNode = document.getElementById('score');
hud.innerHTML = `Arrows/WASD or swipe • R restart • P pause
  <label><input type="checkbox" id="dailyToggle"/> Daily</label>
  <ol id="dailyScores" style="margin:4px 0 0 0;padding-left:20px;font-size:14px"></ol>
  <label>Snake <select id="snakeSkin"></select></label>
  <label>Fruit <select id="fruitSkin"></select></label>
  <label>Board <select id="boardSkin"></select></label>
  <label>Size <select id="sizeSel">
      <option value="16">16×16</option>
      <option value="24">24×24</option>
      <option value="32">32×32</option>
    </select></label>
  <label>Boundary <select id="wrapSel">
      <option value="1">Wrap</option>
      <option value="0">No Wrap</option>
    </select></label>
  <div id="debugPanel" aria-live="polite" aria-label="Debug info" style="margin-left:8px;padding:4px 8px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;font-size:12px;line-height:1.4;min-width:140px;"></div>
`;

const storageState = {
  native: null,
  disabled: false,
  cache: new Map(),
  memory: new Map(),
  notice: null
};

function markStorageDisabled(err) {
  if (storageState.disabled) return;
  storageState.disabled = true;
  storageState.native = null;
  const detail = err && typeof err === 'object' ? { error: err?.message || String(err), name: err?.name || undefined } : { error: String(err) };
  bootLog('storage:disabled', detail);
  if (!storageState.notice) {
    storageState.notice = document.createElement('div');
    storageState.notice.className = 'hud-notice';
    storageState.notice.textContent = 'Persistent storage unavailable — progress will reset when you reload.';
    storageState.notice.style.cssText = 'margin-top:6px;font-size:12px;color:#fbbf24;';
    try {
      hud?.appendChild(storageState.notice);
    } catch (_) {}
  }
}

try {
  storageState.native = window.localStorage;
} catch (err) {
  markStorageDisabled(err);
}
if (!storageState.native) markStorageDisabled('unavailable');

function safeStorageGetItem(key) {
  if (storageState.cache.has(key)) {
    return storageState.cache.get(key);
  }
  if (storageState.disabled || !storageState.native) {
    const fallback = storageState.memory.has(key) ? storageState.memory.get(key) : null;
    storageState.cache.set(key, fallback);
    return fallback;
  }
  try {
    const value = storageState.native.getItem(key);
    storageState.cache.set(key, value);
    return value;
  } catch (err) {
    markStorageDisabled(err);
    const fallback = storageState.memory.has(key) ? storageState.memory.get(key) : null;
    storageState.cache.set(key, fallback);
    return fallback;
  }
}

function safeStorageSetItem(key, value) {
  storageState.cache.set(key, value);
  storageState.memory.set(key, value);
  if (storageState.disabled || !storageState.native) return false;
  try {
    storageState.native.setItem(key, value);
    return true;
  } catch (err) {
    markStorageDisabled(err);
    return false;
  }
}

function parseJSONSafe(raw, fallback) {
  if (typeof raw !== 'string' || !raw.length) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

const params = new URLSearchParams(location.search);
const DAILY_SEED = new Date().toISOString().slice(0, 10);
const DAILY_MODE = params.get('daily') === '1';
const toggle = document.getElementById('dailyToggle');
toggle.checked = DAILY_MODE;
function renderScores(){
  const box = document.getElementById('dailyScores');
  if(!box) return;
  if(!DAILY_MODE){
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  const lb = window.LB;
  if(!lb || typeof lb.getTopScores !== 'function'){
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = '';
  const scores = lb.getTopScores('snake', DAILY_SEED, 5) || [];
  box.innerHTML = scores.map(s=>`<li>${s.score}</li>`).join('');
}
window.renderScores = renderScores;
renderScores();
toggle.onchange = ()=>{ params.set('daily', toggle.checked ? '1':'0'); location.search = params.toString(); };
const sizeSel = document.getElementById('sizeSel');
const wrapSel = document.getElementById('wrapSel');
const N = parseInt(params.get('size') || '32');
const WRAP = params.get('wrap') !== '0';
sizeSel.value = String(N);
wrapSel.value = WRAP ? '1' : '0';
sizeSel.onchange = ()=>{ params.set('size', sizeSel.value); location.search = params.toString(); };
wrapSel.onchange = ()=>{ params.set('wrap', wrapSel.value); location.search = params.toString(); };

const c = ensureGameCanvas();
bootLog('canvas:resolved', { width: c.width, height: c.height });
if (typeof fitCanvasToParent === 'function') {
  fitCanvasToParent(c, 900, 900, 24);
  bootLog('canvas:fitted', { width: c.width, height: c.height });
  addEventListener('resize', () => {
    fitCanvasToParent(c, 900, 900, 24);
    bootLog('canvas:resized', { width: c.width, height: c.height });
  });
} else {
  bootLog('canvas:fit-helper-missing');
}
const ctx = c.getContext('2d');
if (ctx) {
  ctx.imageSmoothingEnabled = false;
  if ('mozImageSmoothingEnabled' in ctx) ctx.mozImageSmoothingEnabled = false;
  if ('webkitImageSmoothingEnabled' in ctx) ctx.webkitImageSmoothingEnabled = false;
  if ('msImageSmoothingEnabled' in ctx) ctx.msImageSmoothingEnabled = false;
}
// The playfield is always rendered as a square grid inside the canvas.
let CELL = Math.min(c.width, c.height) / N;
// Track the rendered square's offset for pointer-to-grid conversions.
let boardOffsetX = 0;
let boardOffsetY = 0;
let dir = { x: 1, y: 0 };
let lastDir = { x: 1, y: 0 };
let snake = [
  { x: 5, y: 16 },
  { x: 4, y: 16 },
  { x: 3, y: 16 }
];
let lastSnake = snake.map(s => ({ ...s }));
const SPEED_BASE_MS = 120;
const SPEED_MIN_MS = 60;
const SPEEDUP_INTERVAL = 4;
const SPEED_STEP_MS = 6;
let speedMs = SPEED_BASE_MS;
let score = 0;
const storedBest = safeStorageGetItem('snake:best');
let bestScore = storedBest != null ? Number(storedBest) : 0;
if (!Number.isFinite(bestScore)) bestScore = 0;
let dead = false;
let deadHandled = false;
const GAME_ID = 'snake';
GG.incPlays();
const tokens = getThemeTokens('snake');
let postedReady=false;
const SNAKE_SKINS = [
  { id: 'default', name: 'Purple', color: tokens['snake-purple'] || '#8b5cf6', unlock: p => true },
  { id: 'gold', name: 'Gold', color: tokens['snake-gold'] || '#fcd34d', unlock: p => p.best >= 10 },
  { id: 'emerald', name: 'Emerald', color: tokens['snake-emerald'] || '#10b981', unlock: p => p.plays >= 5 }
];
const FRUIT_SKINS = [
  {
    id: 'classic',
    name: 'Classic',
    icons: ['🍎','🍌','🍇','🍒','🍊','🍉'],
    color: tokens['fruit-classic'] || '#22d3ee',
    unlock: p => true
  },
  {
    id: 'gems',
    name: 'Gems',
    icons: ['💎','🔶','🔷'],
    sprites: ['fruit', 'fruitGemBlue', 'fruitGemGreen'],
    color: tokens['fruit-gems'] || '#eab308',
    unlock: p => p.best >= 15
  }
];
const BOARD_THEMES = [
  { id: 'dark', name: 'Dark', colors: [tokens['board-dark1'] || '#111623', tokens['board-dark2'] || '#0f1320'], unlock: p => true },
  { id: 'light', name: 'Light', colors: [tokens['board-light1'] || '#f3f4f6', tokens['board-light2'] || '#e5e7eb'], unlock: p => p.plays >= 3 }
];
let FRUITS = ['🍎', '🍌', '🍇', '🍒', '🍊', '🍉'];
let FRUIT_ART = FRUITS.map(icon => ({ icon, label: icon, spriteKey: 'fruit' }));
let gemSpriteIndex = 0;
const PROGRESS_KEY = 'snake:progress';
const SKIN_KEY = 'snake:skin';
const defaultProgress = { plays: 0, best: 0 };
const progressData = parseJSONSafe(safeStorageGetItem(PROGRESS_KEY), defaultProgress) || defaultProgress;
let progress = {
  plays: Number(progressData.plays) || 0,
  best: Number(progressData.best) || 0
};
function saveProgress() {
  safeStorageSetItem(PROGRESS_KEY, JSON.stringify({ plays: progress.plays, best: progress.best }));
}
progress.plays++;
saveProgress();
const selectedData = parseJSONSafe(safeStorageGetItem(SKIN_KEY), {}) || {};
const selected = (selectedData && typeof selectedData === 'object') ? selectedData : {};
let snakeSkinId = typeof selected.snake === 'string' ? selected.snake : 'default';
let fruitSkinId = typeof selected.fruit === 'string' ? selected.fruit : 'classic';
let boardSkinId = typeof selected.board === 'string' ? selected.board : 'dark';
function ensureUnlocked(id, arr) {
  const s = arr.find(t => t.id === id);
  return s && s.unlock(progress) ? id : arr[0].id;
}
snakeSkinId = ensureUnlocked(snakeSkinId, SNAKE_SKINS);
fruitSkinId = ensureUnlocked(fruitSkinId, FRUIT_SKINS);
boardSkinId = ensureUnlocked(boardSkinId, BOARD_THEMES);
function saveSkinSelection() {
  safeStorageSetItem(SKIN_KEY, JSON.stringify({ snake: snakeSkinId, fruit: fruitSkinId, board: boardSkinId }));
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
let boardColors = ['#111623', '#0f1320'];
let snakeColorHead = '#8b5cf6';
let snakeColorRGB = { r: 139, g: 92, b: 246 };
let fruitColor = '#22d3ee';
let obstacles = [];
let won = false;
let winHandled = false;
const spriteEffects = [];

const CellType = {
  Empty: 0,
  Snake: 1,
  Obstacle: 2,
  Food: 3,
  Portal: 4,
  Shrink: 5
};

let boardState = new Uint8Array(N * N);
let lastFoodCandidateCount = 0;

function toIndex(x, y) {
  return y * N + x;
}

function fromIndex(idx) {
  return { x: idx % N, y: Math.floor(idx / N) };
}

function cellTypeFromPickup(pickup) {
  if (!pickup) return CellType.Empty;
  if (pickup.effect === 'portal') return CellType.Portal;
  if (pickup.effect === 'shrink') return CellType.Shrink;
  return CellType.Food;
}

function buildBoard(nextFood = null) {
  const next = new Uint8Array(N * N);
  for (const obstacle of obstacles) {
    next[toIndex(obstacle.x, obstacle.y)] = CellType.Obstacle;
  }
  for (const segment of snake) {
    next[toIndex(segment.x, segment.y)] = CellType.Snake;
  }
  if (nextFood) {
    next[toIndex(nextFood.x, nextFood.y)] = cellTypeFromPickup(nextFood);
  }
  boardState = next;
  return boardState;
}

function spawnSpriteEffect(type, gridX, gridY, options = {}) {
  spriteEffects.push({
    type,
    x: gridX,
    y: gridY,
    offsetX: options.offsetX ?? 0.5,
    offsetY: options.offsetY ?? 0.5,
    duration: options.duration ?? 400,
    scale: options.scale ?? 1,
    start: performance.now()
  });
}

function drawSpriteEffects(ctx, time) {
  for (let i = spriteEffects.length - 1; i >= 0; i--) {
    const fx = spriteEffects[i];
    const progress = (time - fx.start) / fx.duration;
    if (progress >= 1) {
      spriteEffects.splice(i, 1);
      continue;
    }
    const img = ensureSprite(fx.type);
    if (!img || !img.complete || !img.naturalWidth) continue;
    const alpha = 1 - Math.min(1, Math.max(0, progress));
    const size = CELL * (fx.scale || 1);
    const drawX = (fx.x + (fx.offsetX ?? 0.5)) * CELL - size / 2;
    const drawY = (fx.y + (fx.offsetY ?? 0.5)) * CELL - size / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, drawX, drawY, size, size);
    ctx.restore();
  }
}

function triggerDeathEffect(head) {
  const clampedX = Math.min(Math.max(head.x, 0), N - 1);
  const clampedY = Math.min(Math.max(head.y, 0), N - 1);
  spawnSpriteEffect('explosion', clampedX, clampedY, { duration: 600, scale: 1.6 });
}
const SPECIAL_FOOD = [
  { icon: '⭐', color: '#fbbf24', points: 5, chance: 0.08, effect: 'score' },
  { icon: '💎', color: '#60a5fa', points: 10, chance: 0.02, effect: 'score' },
  { icon: '🌀', color: '#38bdf8', points: 0, chance: 0.04, effect: 'portal' },
  { icon: '🪄', color: '#c084fc', points: 0, chance: 0.04, effect: 'shrink' }
];
function applySkin() {
  const s = SNAKE_SKINS.find(t => t.id === snakeSkinId);
  const f = FRUIT_SKINS.find(t => t.id === fruitSkinId);
  const b = BOARD_THEMES.find(t => t.id === boardSkinId);
  boardColors = b.colors;
  snakeColorHead = s.color;
  snakeColorRGB = hexToRgb(s.color);
  const fallbackIcons = Array.isArray(f.icons) && f.icons.length ? f.icons : ['🍎'];
  if (Array.isArray(f.sprites) && f.sprites.length) {
    FRUIT_ART = f.sprites.map((spriteKey, idx) => ({
      icon: SPRITE_SOURCES[spriteKey] || SPRITE_SOURCES.fruit,
      label: fallbackIcons[idx % fallbackIcons.length] || '',
      spriteKey
    }));
  } else {
    FRUIT_ART = fallbackIcons.map(icon => ({ icon, label: icon, spriteKey: 'fruit' }));
  }
  FRUITS = FRUIT_ART.map(art => art.icon);
  gemSpriteIndex = 0;
  fruitColor = f.color;
  saveSkinSelection();
}
function populateSkinSelects() {
  const ss = document.getElementById('snakeSkin');
  const fs = document.getElementById('fruitSkin');
  const bs = document.getElementById('boardSkin');
  function fill(sel, arr, cur, set) {
    if (!sel) return;
    sel.innerHTML = '';
    arr.forEach(t => {
      const opt = document.createElement('option');
      const unlocked = t.unlock(progress);
      opt.value = t.id;
      opt.textContent = t.name + (unlocked ? '' : ' (locked)');
      opt.disabled = !unlocked;
      if (t.id === cur) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => { set(sel.value); applySkin(); populateSkinSelects(); };
  }
  fill(ss, SNAKE_SKINS, snakeSkinId, v => snakeSkinId = v);
  fill(fs, FRUIT_SKINS, fruitSkinId, v => fruitSkinId = v);
  fill(bs, BOARD_THEMES, boardSkinId, v => boardSkinId = v);
}
let paused = false;
let level = 1;

let engine = null;

function hashSeedString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function createSeededRng(seed) {
  let s = seed >>> 0;
  return function seededRandom() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    return arr[0] >>> 0;
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function resolveSeed(seedOverride) {
  if (typeof seedOverride === 'number' && Number.isFinite(seedOverride)) return seedOverride >>> 0;
  if (typeof seedOverride === 'string' && seedOverride) return hashSeedString(seedOverride);
  const base = randomSeed();
  if (DAILY_MODE) return base ^ hashSeedString(DAILY_SEED);
  return base;
}

function startRng(seedOverride) {
  const seed = resolveSeed(seedOverride);
  currentSeed = seed >>> 0;
  rand = createSeededRng(currentSeed);
  window.SNAKE_SEED = DAILY_MODE ? `${DAILY_SEED}:${currentSeed.toString(16)}` : currentSeed.toString(16);
  return currentSeed;
}

const REPLAY_STORAGE_KEY = 'snake:lastReplay';
let currentSeed = 0;
let rand = Math.random;
let replayState = null;
let activeReplay = null;
let capturingReplay = true;
let tickCounter = 0;
let foodsEaten = 0;
let lastReplayRecord = parseJSONSafe(safeStorageGetItem(REPLAY_STORAGE_KEY), null);

const debugPanel = document.getElementById('debugPanel');

function updateDebugPanel() {
  if (!debugPanel) return;
  debugPanel.innerHTML = `Tick <strong>${tickCounter}</strong><br/>Length <strong>${snake.length}</strong><br/>Food slots <strong>${lastFoodCandidateCount}</strong>`;
}

function saveReplayRecord(record) {
  if (record) {
    lastReplayRecord = JSON.parse(JSON.stringify(record));
    safeStorageSetItem(REPLAY_STORAGE_KEY, JSON.stringify(record));
  } else {
    lastReplayRecord = null;
    safeStorageSetItem(REPLAY_STORAGE_KEY, '');
  }
}

function recordReplayInput(dir) {
  if (!capturingReplay || !replayState) return;
  replayState.inputs.push({ tick: tickCounter, dir: { x: dir.x, y: dir.y } });
}

function finalizeReplay(reason) {
  if (!capturingReplay || !replayState) return;
  if (replayState.reason) return;
  replayState.reason = reason;
  replayState.seed = currentSeed;
  replayState.finalTick = tickCounter;
  replayState.daily = DAILY_MODE ? DAILY_SEED : null;
  saveReplayRecord(replayState);
}

function startReplay(recording) {
  if (!recording || typeof recording.seed !== 'number' || !Array.isArray(recording.inputs)) return false;
  const mapped = recording.inputs.map((entry, idx) => ({
    tick: Number(entry.tick) || 0,
    dir: { x: Number(entry.dir?.x) || 0, y: Number(entry.dir?.y) || 0 },
    order: idx
  }));
  mapped.sort((a, b) => a.tick === b.tick ? a.order - b.order : a.tick - b.tick);
  activeReplay = {
    inputs: mapped,
    index: 0
  };
  capturingReplay = false;
  replayState = null;
  resetGame('replay', { seed: recording.seed, captureReplay: false, skipProgress: true });
  return true;
}

applySkin();
populateSkinSelects();

let food = null;
let fruitSpawnTime = performance.now();
let turnBuffer = [];
const MAX_TURN_BUFFER = 2;

function enqueueTurn(nd, source = 'player') {
  if (!nd) return;
  const lastQueued = turnBuffer.length ? turnBuffer[turnBuffer.length - 1] : dir;
  if (nd.x === -lastQueued.x && nd.y === -lastQueued.y) return;
  if (turnBuffer.length < MAX_TURN_BUFFER) {
    turnBuffer.push(nd);
    if (source === 'player') recordReplayInput(nd);
  }
}

function pauseGame(reason = 'manual') {
  if (paused) return;
  paused = true;
  bootLog('game:paused', { reason });
}

function resumeGame(reason = 'manual') {
  if (!paused) return;
  paused = false;
  bootLog('game:resumed', { reason });
}

function togglePause(reason = 'toggle') {
  if (paused) resumeGame(reason);
  else pauseGame(reason);
}

function resetGame(reason = 'manual', options = {}) {
  const opts = (options && typeof options === 'object') ? options : {};
  const captureReplay = opts.captureReplay !== false;
  const skipProgress = opts.skipProgress === true;
  dir = { x: 1, y: 0 };
  lastDir = { x: 1, y: 0 };
  turnBuffer = [];
  snake = [{ x: 5, y: 16 }, { x: 4, y: 16 }, { x: 3, y: 16 }];
  lastSnake = snake.map(s => ({ ...s }));
  won = false;
  winHandled = false;
  obstacles = [];
  dead = false;
  deadHandled = false;
  paused = false;
  moveAcc = 0;
  level = 1;
  tickCounter = 0;
  foodsEaten = 0;
  spriteEffects.length = 0;
  speedMs = SPEED_BASE_MS;
  score = 0;
  const now = performance.now();
  lastTickTime = now;
  fruitSpawnTime = now;
  capturingReplay = captureReplay;
  if (captureReplay) {
    replayState = { seed: null, inputs: [], startedAt: Date.now(), daily: DAILY_MODE ? DAILY_SEED : null };
    activeReplay = null;
  } else if (activeReplay) {
    activeReplay.index = 0;
  }
  const seed = startRng(opts.seed);
  if (captureReplay && replayState) replayState.seed = seed;
  if (!skipProgress) {
    progress.plays++;
    saveProgress();
  }
  populateSkinSelects();
  buildBoard(null);
  food = spawnFood();
  fruitSpawnTime = performance.now();
  bootLog('game:reset', { reason, seed });
  if (engine && !engine.running) engine.start();
  updateDebugPanel();
}

resetGame('boot');

document.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'p') togglePause('keyboard'); });

(function () {
  let start = null;
  c.addEventListener('touchstart', e => { start = e.touches[0]; });
  c.addEventListener('touchmove', e => {
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.clientX, dy = t.clientY - start.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 24) {
      let nd;
      if (Math.abs(dx) > Math.abs(dy)) nd = { x: Math.sign(dx), y: 0 };
      else nd = { x: 0, y: Math.sign(dy) };
      enqueueTurn(nd);
      start = t;
    }
    e.preventDefault();
  }, { passive: false });
  c.addEventListener('touchend', () => start = null);
})();

function pickBaseFruit() {
  let art = FRUIT_ART.length ? FRUIT_ART[Math.floor(rand() * FRUIT_ART.length)] : { icon: '🍎', label: '🍎', spriteKey: 'fruit' };
  if (fruitSkinId === 'gems' && FRUIT_ART.length) {
    art = FRUIT_ART[gemSpriteIndex % FRUIT_ART.length];
    gemSpriteIndex = (gemSpriteIndex + 1) % FRUIT_ART.length;
  }
  return {
    icon: art.icon,
    label: art.label ?? art.icon,
    spriteKey: art.spriteKey || 'fruit',
    color: fruitColor,
    points: 1,
    effect: 'score'
  };
}

function spawnFood() {
  const boardForSpawn = buildBoard(null);
  const freeCells = [];
  for (let i = 0; i < boardForSpawn.length; i++) {
    if (boardForSpawn[i] === CellType.Empty) freeCells.push(i);
  }
  lastFoodCandidateCount = freeCells.length;
  if (!freeCells.length) {
    if (!won) {
      won = true;
      winHandled = false;
      bootLog('game:won', { score, length: snake.length, obstacles: obstacles.length });
      if (engine && typeof engine.stop === 'function') {
        try { engine.stop(); } catch (err) { bootLog('game:win-stop-error', { message: err?.message || String(err) }); }
      }
    }
    updateDebugPanel();
    return null;
  }

  const r = rand();
  let type = null;
  let acc = 0;
  for (const t of SPECIAL_FOOD) {
    acc += t.chance;
    if (r < acc) { type = t; break; }
  }
  if (!type) type = pickBaseFruit();
  const idx = freeCells[(rand() * freeCells.length) | 0];
  const coords = fromIndex(idx);
  const fruit = { ...type, x: coords.x, y: coords.y, index: idx };
  playSfx('click');
  buildBoard(fruit);
  updateDebugPanel();
  return fruit;
}

function addObstacleRow() {
  const y = Math.floor(rand() * N);
  for (let x = 4; x < N - 4; x++) obstacles.push({ x, y });
  buildBoard(food);
  updateDebugPanel();
}

function maybeLevelUp() {
  level = 1 + Math.floor(score / 5);
  const bestList = parseJSONSafe(safeStorageGetItem('gg:lb:' + GAME_ID), []);
  const bestEntry = Array.isArray(bestList) ? bestList[0] : null;
  const best = Number(bestEntry?.score) || score;
  GG.setMeta(GAME_ID, 'Best: ' + best + ' • Lv ' + level);
}

let lastTickTime = performance.now();
let moveAcc = 0;

function pumpReplayInputs() {
  if (!activeReplay) return;
  while (activeReplay.index < activeReplay.inputs.length) {
    const entry = activeReplay.inputs[activeReplay.index];
    if (!entry || typeof entry.tick !== 'number') {
      activeReplay.index++;
      continue;
    }
    if (entry.tick > tickCounter) break;
    activeReplay.index++;
    if (entry.dir && typeof entry.dir.x === 'number' && typeof entry.dir.y === 'number') {
      enqueueTurn({ x: entry.dir.x, y: entry.dir.y }, 'replay');
    }
  }
}

function applySpeedCurve() {
  if (foodsEaten > 0 && foodsEaten % SPEEDUP_INTERVAL === 0) {
    speedMs = Math.max(SPEED_MIN_MS, speedMs - SPEED_STEP_MS);
  }
}

function applyPickupEffect(pickup, head) {
  const result = { grow: true, extraTailRemoval: 0 };
  foodsEaten++;
  const points = Number(pickup.points) || 0;
  if (points > 0) {
    score += points;
    GG.addXP(points);
  }
  playSfx('power');
  spawnSpriteEffect('spark', head.x, head.y, { duration: 500, scale: pickup.effect === 'shrink' ? 1 : 1.25 });
  applySpeedCurve();
  switch (pickup.effect) {
    case 'portal': {
      result.grow = false;
      const snapshot = buildBoard(null);
      const empties = [];
      for (let i = 0; i < snapshot.length; i++) {
        if (snapshot[i] === CellType.Empty) empties.push(i);
      }
      if (empties.length) {
        const idx = empties[(rand() * empties.length) | 0];
        const dest = fromIndex(idx);
        head.x = dest.x;
        head.y = dest.y;
        snake[0].x = dest.x;
        snake[0].y = dest.y;
      }
      break;
    }
    case 'shrink': {
      result.grow = false;
      result.extraTailRemoval = Math.min(2, Math.max(0, snake.length - 1));
      break;
    }
    default:
      break;
  }
  maybeLevelUp();
  return result;
}

function step() {
  pumpReplayInputs();
  if (turnBuffer.length) {
    const next = turnBuffer.shift();
    if (!(next.x === -lastDir.x && next.y === -lastDir.y)) dir = next;
  }
  lastSnake = snake.map(s => ({ ...s }));
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  lastDir = { ...dir };
  if (WRAP) {
    if (head.x < 0) head.x = N - 1;
    if (head.x >= N) head.x = 0;
    if (head.y < 0) head.y = N - 1;
    if (head.y >= N) head.y = 0;
  } else {
    if (head.x < 0 || head.x >= N || head.y < 0 || head.y >= N) {
      dead = true;
      deadHandled = false;
      triggerDeathEffect(head);
    }
  }
  if (!dead) {
    const idx = toIndex(head.x, head.y);
    const occupant = boardState[idx];
    if (occupant === CellType.Snake || occupant === CellType.Obstacle) {
      dead = true;
      deadHandled = false;
      triggerDeathEffect(head);
    }
  }
  if (dead || won) {
    if (dead) finalizeReplay('death');
    activeReplay = null;
    return;
  }
  snake.unshift(head);
  let consumed = null;
  let effectResult = { grow: false, extraTailRemoval: 0 };
  if (food && head.x === food.x && head.y === food.y) {
    consumed = food;
    effectResult = applyPickupEffect(consumed, head);
    food = null;
  }
  if (!effectResult.grow) {
    snake.pop();
  }
  let extra = effectResult.extraTailRemoval || 0;
  while (extra-- > 0 && snake.length > 1) {
    snake.pop();
  }
  if (consumed) {
    food = spawnFood();
    fruitSpawnTime = performance.now();
  }
  buildBoard(food);
  tickCounter++;
  lastTickTime = performance.now();
  updateDebugPanel();
}

function draw() {
  if(!postedReady){
    postedReady=true;
    try { window.parent?.postMessage({ type:'GAME_READY', slug:'snake' }, '*'); } catch {}
  }
  const time = performance.now();
  const side = Math.min(c.width, c.height);
  const offsetX = (c.width - side) / 2;
  const offsetY = (c.height - side) / 2;
  const backgroundDelta = Math.min(Math.max(time - lastBackgroundTime, 0), 1000);
  lastBackgroundTime = time;
  // CELL is derived from the square side length so that N cells always fit exactly.
  CELL = side / N;
  // Store offsets so any canvas-space interaction can subtract them before using CELL.
  boardOffsetX = offsetX;
  boardOffsetY = offsetY;

  ctx.clearRect(0, 0, c.width, c.height);

  let backgroundDrawn = false;
  const bg = ensureSprite('background');
  if (Array.isArray(bg)) {
    if (backgroundScrollOffsets.length !== bg.length) backgroundScrollOffsets = new Array(bg.length).fill(0);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    bg.forEach((layer, idx) => {
      if (!layer || !layer.complete || !layer.naturalWidth || !layer.naturalHeight) return;
      const speed = BACKGROUND_SCROLL_SPEEDS[idx] ?? BACKGROUND_SCROLL_SPEEDS[BACKGROUND_SCROLL_SPEEDS.length - 1] ?? 0.004;
      const width = layer.naturalWidth;
      const height = layer.naturalHeight;
      if (!width || !height) return;
      backgroundScrollOffsets[idx] = (backgroundScrollOffsets[idx] + backgroundDelta * speed) % width;
      const scrollX = backgroundScrollOffsets[idx];
      ctx.save();
      ctx.globalAlpha = idx === 0 ? 0.9 : 0.7;
      for (let x = -width; x < side + width; x += width) {
        for (let y = -height; y < side + height; y += height) {
          ctx.drawImage(layer, x - scrollX, y, width, height);
        }
      }
      ctx.restore();
      backgroundDrawn = true;
    });
    ctx.restore();
  } else if (bg && bg.complete && bg.naturalWidth) {
    ctx.save();
    ctx.translate(offsetX, offsetY);
    const pattern = ctx.createPattern(bg, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, side, side);
    } else {
      ctx.drawImage(bg, 0, 0, side, side);
    }
    ctx.restore();
    backgroundDrawn = true;
  }
  if (!backgroundDrawn) {
    ctx.fillStyle = boardColors[0];
    ctx.fillRect(offsetX, offsetY, side, side);
  }

  if (scoreNode) {
    scoreNode.textContent = String(score);
    scoreNode.dataset.gameScore = String(score);
  }

  ctx.save();
  ctx.translate(offsetX, offsetY);

  // fruit with spawn animation
  if (food) {
    const ft = Math.min((time - fruitSpawnTime) / 300, 1);
    const fruitSpriteKey = food.spriteKey || null;
    const fruitImg = fruitSpriteKey ? ensureSprite(fruitSpriteKey) : null;
    const size = CELL * (0.6 + 0.4 * ft);
    const drawX = (food.x + 0.5) * CELL - size / 2;
    const drawY = (food.y + 0.5) * CELL - size / 2;
    ctx.save();
    ctx.globalAlpha = ft;
    if (fruitImg && !Array.isArray(fruitImg) && fruitImg.complete && fruitImg.naturalWidth) {
      ctx.drawImage(fruitImg, drawX, drawY, size, size);
    } else if (typeof food.icon === 'string') {
      ctx.fillStyle = food.color || '#f87171';
      ctx.font = `${Math.floor(size * 0.8)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(food.icon, drawX + size / 2, drawY + size / 2);
    } else {
      ctx.fillStyle = food.color || '#f87171';
      ctx.fillRect(drawX, drawY, size, size);
    }
    ctx.restore();
  }

  // snake interpolation
  const t = Math.min((time - lastTickTime) / speedMs, 1);
  snake.forEach((s, idx) => {
    const prev = lastSnake[idx] || lastSnake[lastSnake.length - 1];
    const x = (prev.x + (s.x - prev.x) * t) * CELL;
    const y = (prev.y + (s.y - prev.y) * t) * CELL;
    const sprite = idx === 0 ? ensureSprite('snakeHead') : ensureSprite('snakeBody');
    if (sprite && sprite.complete && sprite.naturalWidth) {
      ctx.drawImage(sprite, x, y, CELL, CELL);
    } else {
      const fade = 0.8 - (idx / snake.length) * 0.5;
      ctx.fillStyle = idx === 0 ? snakeColorHead : `rgba(${snakeColorRGB.r},${snakeColorRGB.g},${snakeColorRGB.b},${fade})`;
      ctx.fillRect(x, y, CELL, CELL);
    }
  });

  // obstacles
  const obstacleSprite = ensureSprite('obstacle');
  if (obstacleSprite && !Array.isArray(obstacleSprite) && obstacleSprite.complete && obstacleSprite.naturalWidth && obstacleSprite.naturalHeight) {
    const tileSize = Math.min(obstacleSprite.naturalWidth, obstacleSprite.naturalHeight);
    const columns = Math.max(1, Math.floor(obstacleSprite.naturalWidth / tileSize));
    const rows = Math.max(1, Math.floor(obstacleSprite.naturalHeight / tileSize));
    const totalTiles = columns * rows;
    obstacles.forEach((o, idx) => {
      const tileIndex = totalTiles > 0 ? idx % totalTiles : 0;
      const sx = (tileIndex % columns) * tileSize;
      const sy = Math.floor(tileIndex / columns) * tileSize;
      ctx.drawImage(obstacleSprite, sx, sy, tileSize, tileSize, o.x * CELL, o.y * CELL, CELL, CELL);
    });
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    obstacles.forEach(o => ctx.fillRect(o.x * CELL, o.y * CELL, CELL, CELL));
  }

  drawSpriteEffects(ctx, time);

  ctx.restore();

  // HUD
  ctx.fillStyle = '#e6e7ea';
  ctx.font = 'bold 20px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Score: ${score} (Best: ${bestScore}) • Lv ${level}`, offsetX + 16, offsetY + 28);

  if (score > 0 && score % 10 === 0 && obstacles.length < Math.floor(score / 10) * (N / 2)) addObstacleRow();

  if (paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#e6e7ea';
    ctx.font = 'bold 32px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Paused — P to resume', c.width / 2, c.height / 2);
  } else if (won) {
    if (!winHandled) {
      playSfx('power');
      if (snake[0]) {
        spawnSpriteEffect('spark', snake[0].x, snake[0].y, { duration: 600, scale: 1.6 });
      }
      saveScore(score);
      winHandled = true;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#e6e7ea';
    ctx.font = 'bold 42px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('You win! Press R', c.width / 2, c.height / 2);
  } else if (dead) {
    if (!deadHandled) {
      playSfx('hit');
      saveScore(score);
      deadHandled = true;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#e6e7ea';
    ctx.font = 'bold 42px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('You crashed! Press R', c.width / 2, c.height / 2);
  }

  updateDebugPanel();
}

function saveScore(s) {
  const key = 'gg:lb:' + GAME_ID;
  const storedScores = parseJSONSafe(safeStorageGetItem(key), []);
  const lb = Array.isArray(storedScores) ? storedScores.slice() : [];
  lb.push({ score: s, at: Date.now() });
  lb.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const top = lb.slice(0, 5);
  safeStorageSetItem(key, JSON.stringify(top));
  const best = Number(top[0]?.score) || 0;
  GG.setMeta(GAME_ID, 'Best: ' + best);
  if (s > bestScore) {
    bestScore = s;
    safeStorageSetItem('snake:best', String(bestScore));
  }
  progress.best = Math.max(progress.best, s);
  saveProgress();
  populateSkinSelects();
  if (window.LB) {
    LB.submitScore(GAME_ID, s, DAILY_MODE ? DAILY_SEED : null);
    try { renderScores(); } catch { }
  }
  if (s >= 20) GG.addAch(GAME_ID, 'Fruit Feast');
}

document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'r' && dead) {
    resetGame('keyboard');
    return;
  }
  const map = {
    'arrowup': { x: 0, y: -1 }, 'w': { x: 0, y: -1 },
    'arrowdown': { x: 0, y: 1 }, 's': { x: 0, y: 1 },
    'arrowleft': { x: -1, y: 0 }, 'a': { x: -1, y: 0 },
    'arrowright': { x: 1, y: 0 }, 'd': { x: 1, y: 0 }
  };
  if (map[k]) enqueueTurn(map[k]);
});

engine = new GameEngine();
engine.update = dt => {
  if (dead || paused || won) return;
  moveAcc += dt * 1000;
  while (moveAcc >= speedMs) {
    moveAcc -= speedMs;
    step();
  }
};
engine.render = draw;
engine.start();
if (typeof reportReady === 'function') reportReady('snake');

const snakeApi = {
  engine,
  get snake() { return snake; },
  get food() { return food; },
  get score() { return score; },
  get turnBuffer() { return turnBuffer; },
  get cellSize() { return CELL; },
  get boardOffset() { return { x: boardOffsetX, y: boardOffsetY }; },
  get seed() { return currentSeed; },
  get tick() { return tickCounter; },
  get lastReplay() { return lastReplayRecord ? JSON.parse(JSON.stringify(lastReplayRecord)) : null; },
  pause: (reason = 'external') => pauseGame(reason),
  resume: (reason = 'external') => resumeGame(reason),
  reset: (reason = 'external', options) => resetGame(reason, options),
  playReplay(recording) { return startReplay(recording || lastReplayRecord || undefined); },
  clearLastReplay() { saveReplayRecord(null); },
  onReady: []
};

window.Snake = snakeApi;

function flushSnakeReadyHandlers(context) {
  const api = window.Snake;
  if (!api) return;
  const queue = Array.isArray(api.onReady) ? api.onReady.splice(0) : [];
  if (!queue.length) return;
  for (const handler of queue) {
    if (typeof handler !== 'function') continue;
    try {
      handler(api, context);
    } catch (err) {
      pushEvent('boot', {
        level: 'warn',
        message: '[snake] onReady handler failed',
        details: { error: err?.message || String(err), stack: err?.stack || null }
      });
    }
  }
}

if (typeof queueMicrotask === 'function') {
  queueMicrotask(() => flushSnakeReadyHandlers());
} else {
  setTimeout(() => flushSnakeReadyHandlers(), 0);
}

const registerGameDiagnostics = window.GGDiagAdapters?.registerGameDiagnostics;
if (typeof registerGameDiagnostics === 'function') {
  try {
    registerGameDiagnostics('snake', {
      hooks: {
        onReady(context) {
          flushSnakeReadyHandlers(context);
        }
      },
      api: {
        pause: () => pauseGame('diagnostics'),
        resume: () => resumeGame('diagnostics'),
        reset: () => resetGame('diagnostics'),
        getScore: () => score,
        getEntities: () => ({
          snake: snake.map(segment => ({ ...segment })),
          food: food ? { ...food } : null,
          obstacles: obstacles.map(obstacle => ({ ...obstacle })),
          level,
          speedMs,
          dead,
          paused,
          won,
          score
        })
      }
    });
    pushEvent('boot', { level: 'info', message: '[snake] diagnostics adapter registered' });
  } catch (err) {
    pushEvent('boot', {
      level: 'error',
      message: '[snake] diagnostics adapter registration failed',
      details: { error: err?.message || String(err), stack: err?.stack || null }
    });
  }
} else {
  pushEvent('boot', {
    level: 'warn',
    message: '[snake] diagnostics registry unavailable'
  });
}
