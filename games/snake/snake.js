import { GameEngine } from '../../shared/gameEngine.js';
import { preloadFirstFrameAssets } from '../../shared/game-asset-preloader.js';
import { play as playSfx } from '../../shared/juice/audio.js';
import getThemeTokens from '../../shared/skins/index.js';
import '../../shared/ui/hud.js';
import { pushEvent } from '/games/common/diag-adapter.js';
import '../common/diagnostics/adapter.js';
import { gameEvent } from '../../shared/telemetry.js';
import { initSnakeUI } from './ui.js';

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

const nativeBootLog = typeof bootStatus.log === 'function' ? bootStatus.log.bind(bootStatus) : null;
const bootLogEntries = [];
const MAX_DIAGNOSTIC_LOGS = 40;
const DIAGNOSTICS_KEY = 'snake:diagnostics';
let diagnosticsEnabled = false;
let pendingDiagnosticsFrame = false;

function resolveBootLogLevel(event, fallbackLevel) {
  const name = String(event || '').toLowerCase();
  if (/error|fail|crash/.test(name)) return 'error';
  if (/stall|missing|pending|timeout|watchdog|warn/.test(name)) return 'warn';
  return fallbackLevel || 'info';
}

function bootLog(event, detail) {
  let entry = null;
  if (nativeBootLog) {
    try {
      entry = nativeBootLog(event, detail);
    } catch (err) {
      entry = {
        at: performance.now(),
        event: `${event}:log-error`,
        detail: { error: err?.message || String(err), original: detail || null },
        level: 'error',
        message: `[snake] ${event} (log failed)`
      };
    }
  }
  const record = entry && typeof entry === 'object'
    ? { ...entry }
    : {
        at: performance.now(),
        event,
        detail: detail || null,
        level: resolveBootLogLevel(event, entry?.level),
        message: `[snake] ${event}`
      };
  bootLogEntries.push(record);
  if (bootLogEntries.length > MAX_DIAGNOSTIC_LOGS) {
    bootLogEntries.splice(0, bootLogEntries.length - MAX_DIAGNOSTIC_LOGS);
  }
  scheduleDiagnosticsRender();
  return entry ?? record;
}

bootStatus.log = bootLog;
bootLog('init:start', { readyState: document.readyState });

const SLUG = 'snake';

const SPRITE_SOURCES = {
  fruit: '/assets/snake/apple.svg',
  fruitGemRed: '/assets/sprites/collectibles/gem_red.png',
  fruitGemBlue: '/assets/sprites/collectibles/gem_blue.png',
  fruitGemGreen: '/assets/sprites/collectibles/gem_green.png',
  obstacle: '/assets/tilesets/industrial.png',
  spark: '/assets/effects/spark.png',
  explosion: '/assets/effects/explosion.png'
};

const spriteCache = {};
const backgroundImageCache = new Map();
let backgroundLayers = [];
let backgroundScrollSpeeds = [0.004, 0.008];
let backgroundScrollOffsets = [];
let backgroundOverlayColor = null;
let lastBackgroundTime = performance.now();

function ensureSprite(name) {
  if (Object.prototype.hasOwnProperty.call(spriteCache, name)) return spriteCache[name];
  const source = SPRITE_SOURCES[name];
  if (!source) {
    spriteCache[name] = null;
    return null;
  }
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

function loadBackgroundImage(src) {
  if (!src) return null;
  if (backgroundImageCache.has(src)) return backgroundImageCache.get(src);
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  backgroundImageCache.set(src, img);
  return img;
}

function setBackgroundTheme(themeId) {
  const theme = BACKGROUND_THEMES.find(t => t.id === themeId) || BACKGROUND_THEMES[0];
  backgroundThemeId = theme.id;
  backgroundScrollSpeeds = Array.isArray(theme.speeds) && theme.speeds.length ? theme.speeds.slice() : [0.004, 0.008];
  backgroundOverlayColor = theme.overlay || null;
  backgroundLayers = theme.layers.map((layer, idx) => ({
    image: loadBackgroundImage(layer.src),
    alpha: typeof layer.alpha === 'number' ? layer.alpha : (idx === 0 ? 0.9 : 0.7)
  }));
  backgroundScrollOffsets = new Array(backgroundLayers.length).fill(0);
  bootLog('theme:background', {
    id: backgroundThemeId,
    speeds: backgroundScrollSpeeds.map(v => Number(v.toFixed(4)))
  });
}

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
hud.innerHTML = `
  <div class="hud-panel hud-panel--controls">
    <div class="hud-panel__header">
      <h2 class="hud-panel__title">Run Controls</h2>
      <p class="hud-panel__subtitle">Arrows/WASD or swipe • R restart • P pause</p>
    </div>
    <div class="hud-panel__body">
      <label class="hud-field hud-field--toggle"><input type="checkbox" id="dailyToggle"/> Daily seed</label>
      <label class="hud-field">Board size
        <select id="sizeSel">
          <option value="16">16×16</option>
          <option value="24">24×24</option>
          <option value="32">32×32</option>
        </select>
      </label>
      <label class="hud-field hud-field--toggle"><input type="checkbox" id="wallsToggle"/> Walls enabled</label>
      <label class="hud-field hud-field--toggle"><input type="checkbox" id="wrapToggle"/> Wrap edges</label>
      <div class="hud-field hud-field--actions" role="group" aria-label="Quick actions">
        <button type="button" class="hud-button" id="howToBtn">How to play</button>
        <button type="button" class="hud-button" id="pauseBtn" aria-pressed="false">Pause</button>
        <button type="button" class="hud-button" id="restartBtn">Restart</button>
        <a href="../../index.html" class="hud-link" id="backLink">← Back to library</a>
      </div>
      <label class="hud-field hud-field--toggle"><input type="checkbox" id="contrastToggle"/> High contrast mode</label>
    </div>
  </div>
  <div class="hud-panel hud-panel--skins">
    <div class="hud-panel__header">
      <h2 class="hud-panel__title">Style Lab</h2>
    </div>
    <div class="hud-panel__body">
      <label class="hud-field">Snake <select id="snakeSkin"></select></label>
      <label class="hud-field">Fruit <select id="fruitSkin"></select></label>
      <label class="hud-field">Board <select id="boardSkin"></select></label>
      <label class="hud-field">Backdrop <select id="backgroundSkin"></select></label>
    </div>
  </div>
  <div class="hud-panel hud-panel--missions">
    <div class="hud-panel__header">
      <h2 class="hud-panel__title">Missions</h2>
    </div>
    <div class="hud-panel__body">
      <ul id="missionList" class="hud-missionList" aria-live="polite"></ul>
    </div>
  </div>
  <div class="hud-panel hud-panel--combo">
    <div class="hud-panel__header">
      <h2 class="hud-panel__title">Combo Meter</h2>
    </div>
    <div class="hud-panel__body">
      <div id="comboMeter" class="hud-meter" role="meter" aria-valuemin="0" aria-valuemax="10" aria-valuenow="0" aria-label="Combo streak">x0</div>
      <div id="comboTimer" class="hud-meter__timer" aria-live="polite"></div>
    </div>
  </div>
  <div class="hud-panel hud-panel--diagnostics">
    <div class="hud-panel__header">
      <h2 class="hud-panel__title">Diagnostics</h2>
    </div>
    <div class="hud-panel__body">
      <label class="hud-field hud-field--toggle"><input type="checkbox" id="diagnosticsToggle"/> Live watchdog feed</label>
      <div id="debugPanel" aria-live="polite" aria-label="Debug info" class="hud-diagnostics"></div>
      <div id="watchdogLog" class="hud-logList" aria-live="polite"></div>
    </div>
  </div>
  <div class="hud-panel hud-panel--daily">
    <div class="hud-panel__header">
      <h2 class="hud-panel__title">Daily Leaderboard</h2>
    </div>
    <div class="hud-panel__body">
      <ol id="dailyScores" class="hud-dailyList"></ol>
    </div>
  </div>
`;
const missionListNode = document.getElementById('missionList');
const comboMeterNode = document.getElementById('comboMeter');
const comboTimerNode = document.getElementById('comboTimer');
const diagnosticsToggle = document.getElementById('diagnosticsToggle');
const watchdogLogNode = document.getElementById('watchdogLog');
const pauseButtonEl = document.getElementById('pauseBtn');
const howToButton = document.getElementById('howToBtn');
const restartButton = document.getElementById('restartBtn');
const contrastToggle = document.getElementById('contrastToggle');
const howToOverlay = document.querySelector('.snake-howto');
const howToCard = howToOverlay ? howToOverlay.querySelector('.snake-howto__card') : null;
const howToCloseButton = howToOverlay ? howToOverlay.querySelector('[data-action="close"]') : null;
const howToBackLink = howToOverlay ? howToOverlay.querySelector('[data-action="back"]') : null;

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

function getProfileId() {
  try {
    const id = window.localStorage?.getItem('profile');
    return typeof id === 'string' && id.length ? id : 'default';
  } catch (_) {
    return 'default';
  }
}

const OPTIONS_STORAGE_KEY = `snake:options:${getProfileId()}`;

function loadOptionState() {
  const raw = parseJSONSafe(safeStorageGetItem(OPTIONS_STORAGE_KEY), null);
  if (!raw || typeof raw !== 'object') {
    return { wrap: true, walls: true };
  }
  return {
    wrap: raw.wrap !== false,
    walls: raw.walls !== false
  };
}

function saveOptionState(options) {
  const payload = {
    wrap: options.wrap !== false,
    walls: options.walls !== false
  };
  safeStorageSetItem(OPTIONS_STORAGE_KEY, JSON.stringify(payload));
}

diagnosticsEnabled = safeStorageGetItem(DIAGNOSTICS_KEY) === '1';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
renderMissions();
renderComboPanel();
const sizeSel = document.getElementById('sizeSel');
const wallsToggle = document.getElementById('wallsToggle');
const wrapToggle = document.getElementById('wrapToggle');
const optionState = loadOptionState();
const N = parseInt(params.get('size') || '32');
let wrapEnabled = params.has('wrap') ? params.get('wrap') !== '0' : optionState.wrap;
let wallsEnabled = optionState.walls;
let uiController = null;
let hudDirty = true;
sizeSel.value = String(N);
sizeSel.onchange = ()=>{ params.set('size', sizeSel.value); location.search = params.toString(); };
if (wrapToggle) {
  wrapToggle.checked = wrapEnabled;
  wrapToggle.addEventListener('change', () => {
    wrapEnabled = !!wrapToggle.checked;
    saveOptionState({ wrap: wrapEnabled, walls: wallsEnabled });
    requestHudSync();
  });
}
if (wallsToggle) {
  wallsToggle.checked = wallsEnabled;
  wallsToggle.addEventListener('change', () => {
    wallsEnabled = !!wallsToggle.checked;
    if (!wallsEnabled) {
      obstacles = [];
      buildBoard(food);
    }
    saveOptionState({ wrap: wrapEnabled, walls: wallsEnabled });
    renderMissions();
    requestHudSync();
  });
}

if (pauseButtonEl) {
  pauseButtonEl.addEventListener('click', () => {
    if (paused) resumeGame('ui');
    else pauseGame('ui');
  });
  updatePauseButtonUI();
}

if (restartButton) {
  restartButton.addEventListener('click', () => resetGame('ui'));
}

if (contrastToggle) {
  contrastToggle.checked = highContrastEnabled;
  contrastToggle.addEventListener('change', () => {
    highContrastEnabled = !!contrastToggle.checked;
    safeStorageSetItem('snake:contrast', highContrastEnabled ? '1' : '0');
    applySkin();
    buildBoard(food);
    requestHudSync();
  });
} else {
  syncHighContrastClass();
}

function openHowTo() {
  if (!howToOverlay) return;
  howToOverlay.hidden = false;
  howToOverlay.dataset.active = 'true';
  howToOverlay.setAttribute('aria-hidden', 'false');
  if (howToCard) howToCard.setAttribute('tabindex', '-1');
  howToReturnFocus = document.activeElement && typeof document.activeElement.focus === 'function' ? document.activeElement : null;
  resumeAfterHowTo = !paused && !dead && !won;
  if (resumeAfterHowTo) {
    pauseGame('howto');
    setPauseOverlayActive(false);
  }
  const focusTarget = howToCloseButton || howToCard || howToOverlay;
  if (focusTarget && typeof focusTarget.focus === 'function') {
    setTimeout(() => focusTarget.focus(), 0);
  }
}

function closeHowTo(reason = 'manual') {
  if (!howToOverlay) return;
  howToOverlay.dataset.active = 'false';
  howToOverlay.setAttribute('aria-hidden', 'true');
  howToOverlay.hidden = true;
  if (resumeAfterHowTo && reason !== 'back') {
    resumeGame('howto');
  }
  resumeAfterHowTo = false;
  if (howToReturnFocus && typeof howToReturnFocus.focus === 'function') {
    setTimeout(() => {
      try { howToReturnFocus.focus(); } catch (_) {}
    }, 0);
  }
  howToReturnFocus = null;
}

if (howToButton) {
  howToButton.addEventListener('click', () => openHowTo());
}
if (howToCloseButton) {
  howToCloseButton.addEventListener('click', () => closeHowTo('close'));
}
if (howToBackLink) {
  howToBackLink.addEventListener('click', () => closeHowTo('back'));
}
if (howToOverlay) {
  howToOverlay.hidden = true;
  howToOverlay.setAttribute('aria-hidden', 'true');
  howToOverlay.addEventListener('click', (event) => {
    if (event.target === howToOverlay) closeHowTo('backdrop');
  });
}

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
const pauseOverlay = document.querySelector('.snake-pause-overlay');
let howToReturnFocus = null;
let resumeAfterHowTo = false;
function setPauseOverlayActive(active) {
  if (!pauseOverlay) return;
  pauseOverlay.dataset.active = active ? 'true' : 'false';
  pauseOverlay.setAttribute('aria-hidden', active ? 'false' : 'true');
}
setPauseOverlayActive(false);
// The playfield is always rendered as a square grid inside the canvas.
let CELL = Math.max(1, Math.floor(Math.min(c.width, c.height) / N));
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
const SPEED_TIER_MAX = Math.max(1, Math.floor((SPEED_BASE_MS - SPEED_MIN_MS) / SPEED_STEP_MS) + 1);
const SPEED_BURST_MULTIPLIER = 0.6;
const SPEED_BURST_MIN_MS = 5000;
const SPEED_BURST_RANGE_MS = 3000;
let speedTier = 1;
let lastSpeedTierEmitted = 1;
let speedMs = SPEED_BASE_MS;
let score = 0;
let runStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
let gameOverReported = false;
const storedBest = safeStorageGetItem('snake:best');
let bestScore = storedBest != null ? Number(storedBest) : 0;
if (!Number.isFinite(bestScore)) bestScore = 0;
const storedContrast = safeStorageGetItem('snake:contrast');
let highContrastEnabled = storedContrast === '1';
const HIGH_CONTRAST_COLORS = {
  boardBase: '#020617',
  boardAccent: '#1f2937',
  snakeHead: '#fde047',
  snakeBody: '#facc15',
  fruit: '#f97316'
};
const LONG_SNAKE_LENGTH = 25;
let dead = false;
let deadHandled = false;
let speedBoostActive = false;
let speedBoostUntil = 0;
const GAME_ID = 'snake';
GG.incPlays();
const tokens = getThemeTokens('snake');
const CSS_PALETTE = (() => {
  if (typeof window === 'undefined' || !window.getComputedStyle) return {};
  const root = document.documentElement;
  if (!root) return {};
  try {
    const styles = window.getComputedStyle(root);
    const read = (name, fallback) => {
      const value = styles.getPropertyValue(name);
      return value && value.trim() ? value.trim() : fallback;
    };
    return {
      boardBase: read('--snake-board-base', ''),
      boardAccent: read('--snake-board-accent', ''),
      snakeHead: read('--snake-head', ''),
      snakeBody: read('--snake-body', ''),
      fruit: read('--snake-fruit', ''),
      fruitLeaf: read('--snake-fruit-leaf', ''),
      foreground: read('--fg', ''),
      muted: read('--muted', '')
    };
  } catch (_) {
    return {};
  }
})();
const DEFAULT_COLORS = {
  boardBase: CSS_PALETTE.boardBase || '#111623',
  boardAccent: CSS_PALETTE.boardAccent || '#0f1320',
  snakeHead: CSS_PALETTE.snakeHead || '#38bdf8',
  snakeBody: CSS_PALETTE.snakeBody || '#22d3ee',
  fruit: CSS_PALETTE.fruit || '#ff6b6b'
};
const HUD_TEXT_COLOR = CSS_PALETTE.foreground || '#e6e7ea';
uiController = initSnakeUI({
  score,
  bestScore,
  speedTier,
  wallsEnabled,
  wrapEnabled
});
requestHudSync();

function requestHudSync() {
  hudDirty = true;
}

function syncHud() {
  if (!hudDirty || !uiController) return;
  hudDirty = false;
  try {
    uiController.updateTopBar({
      score,
      bestScore,
      speedTier,
      wallsEnabled,
      wrapEnabled,
      boostActive: speedBoostActive,
      boostRemainingMs: speedBoostActive ? Math.max(0, speedBoostUntil - performance.now()) : 0
    });
  } catch (_) {}
  if (window.GG && typeof window.GG.setMeta === 'function') {
    window.GG.setMeta(GAME_ID, `Best: ${bestScore} • Speed T${speedTier}`);
  }
}
let postedReady=false;
const SNAKE_SKINS = [
  {
    id: 'default',
    name: 'Aurora',
    color: tokens['snake-purple'] || DEFAULT_COLORS.snakeBody,
    head: tokens['snake-purple-head'] || DEFAULT_COLORS.snakeHead,
    body: tokens['snake-purple-body'] || DEFAULT_COLORS.snakeBody,
    unlock: p => true
  },
  {
    id: 'gold',
    name: 'Solaris',
    color: tokens['snake-gold'] || '#facc15',
    head: tokens['snake-gold-head'] || '#f59e0b',
    body: tokens['snake-gold'] || '#facc15',
    unlock: p => p.best >= 10
  },
  {
    id: 'emerald',
    name: 'Verdant',
    color: tokens['snake-emerald'] || '#10b981',
    head: tokens['snake-emerald-head'] || '#34d399',
    body: tokens['snake-emerald'] || '#10b981',
    unlock: p => p.plays >= 5
  }
];
const FRUIT_SKINS = [
  {
    id: 'classic',
    name: 'Classic',
    icons: ['🍎','🍌','🍇','🍒','🍊','🍉'],
    color: tokens['fruit-classic'] || DEFAULT_COLORS.fruit,
    unlock: p => true
  },
  {
    id: 'gems',
    name: 'Gems',
    icons: ['💎','🔶','🔷'],
    sprites: ['fruitGemRed', 'fruitGemBlue', 'fruitGemGreen'],
    color: tokens['fruit-gems'] || '#eab308',
    unlock: p => p.best >= 15
  }
];
const BOARD_THEMES = [
  { id: 'dark', name: 'Dark', colors: [tokens['board-dark1'] || DEFAULT_COLORS.boardBase, tokens['board-dark2'] || DEFAULT_COLORS.boardAccent], unlock: p => true },
  { id: 'light', name: 'Light', colors: [tokens['board-light1'] || '#f3f4f6', tokens['board-light2'] || '#e5e7eb'], unlock: p => p.plays >= 3 }
];
const BACKGROUND_THEMES = [
  {
    id: 'arcade',
    name: 'Arcade Neon',
    layers: [
      { src: '/assets/backgrounds/parallax/arcade_layer1.png', alpha: 0.9 },
      { src: '/assets/backgrounds/parallax/arcade_layer2.png', alpha: 0.7 }
    ],
    speeds: [0.004, 0.008],
    overlay: 'rgba(126, 58, 242, 0.14)',
    unlock: () => true
  },
  {
    id: 'city',
    name: 'Metro Mirage',
    layers: [
      { src: '/assets/backgrounds/parallax/city_layer1.png', alpha: 0.85 },
      { src: '/assets/backgrounds/parallax/city_layer2.png', alpha: 0.65 }
    ],
    speeds: [0.003, 0.006],
    overlay: 'rgba(56, 189, 248, 0.16)',
    unlock: p => p.plays >= 3
  },
  {
    id: 'forest',
    name: 'Verdant Drift',
    layers: [
      { src: '/assets/backgrounds/parallax/forest_layer1.png', alpha: 0.9 },
      { src: '/assets/backgrounds/parallax/forest_layer2.png', alpha: 0.7 }
    ],
    speeds: [0.0025, 0.0045],
    overlay: 'rgba(74, 222, 128, 0.15)',
    unlock: p => p.plays >= 6
  },
  {
    id: 'space',
    name: 'Star Drifter',
    layers: [
      { src: '/assets/backgrounds/parallax/space_layer1.png', alpha: 0.85 },
      { src: '/assets/backgrounds/parallax/space_layer2.png', alpha: 0.7 }
    ],
    speeds: [0.006, 0.012],
    overlay: 'rgba(129, 140, 248, 0.18)',
    unlock: p => p.best >= 20
  }
];
let FRUITS = ['🍎', '🍌', '🍇', '🍒', '🍊', '🍉'];
let FRUIT_ART = FRUITS.map(icon => ({ icon, label: icon, spriteKey: 'fruit' }));
let gemSpriteIndex = 0;
const PROGRESS_KEY = 'snake:progress';
const SKIN_KEY = 'snake:skin';
const MISSIONS = [
  {
    id: 'score-walls-off',
    name: 'Walls? Nah.',
    goal: 200,
    type: 'walls-score',
    description: 'Score 200 points in a single run with walls disabled.'
  },
  {
    id: 'top-speed-90',
    name: 'Blazing Focus',
    goal: 90000,
    type: 'top-speed',
    description: 'Survive 90 seconds while at top speed.'
  },
  {
    id: 'poison-gourmet',
    name: 'Toxic Gourmet',
    goal: 5,
    type: 'poison',
    description: 'Eat 5 poison snacks in one run.'
  }
];
const defaultProgress = {
  plays: 0,
  best: 0,
  missions: {
    wallsOffScore: 0,
    topSpeedMs: 0,
    poisonCount: 0
  }
};
const progressData = parseJSONSafe(safeStorageGetItem(PROGRESS_KEY), defaultProgress) || defaultProgress;
let progress = {
  plays: Number(progressData.plays) || 0,
  best: Number(progressData.best) || 0,
  missions: {
    wallsOffScore: Number(progressData.missions?.wallsOffScore) || 0,
    topSpeedMs: Number(progressData.missions?.topSpeedMs) || 0,
    poisonCount: Number(progressData.missions?.poisonCount) || 0
  }
};
function saveProgress() {
  safeStorageSetItem(PROGRESS_KEY, JSON.stringify({
    plays: progress.plays,
    best: progress.best,
    missions: progress.missions
  }));
}
progress.plays++;
saveProgress();
renderMissions();
const selectedData = parseJSONSafe(safeStorageGetItem(SKIN_KEY), {}) || {};
const selected = (selectedData && typeof selectedData === 'object') ? selectedData : {};
let snakeSkinId = typeof selected.snake === 'string' ? selected.snake : 'default';
let fruitSkinId = typeof selected.fruit === 'string' ? selected.fruit : 'classic';
let boardSkinId = typeof selected.board === 'string' ? selected.board : 'dark';
let backgroundThemeId = typeof selected.background === 'string' ? selected.background : BACKGROUND_THEMES[0].id;
function ensureUnlocked(id, arr) {
  const s = arr.find(t => t.id === id);
  return s && s.unlock(progress) ? id : arr[0].id;
}
snakeSkinId = ensureUnlocked(snakeSkinId, SNAKE_SKINS);
fruitSkinId = ensureUnlocked(fruitSkinId, FRUIT_SKINS);
boardSkinId = ensureUnlocked(boardSkinId, BOARD_THEMES);
backgroundThemeId = ensureUnlocked(backgroundThemeId, BACKGROUND_THEMES);
function saveSkinSelection() {
  safeStorageSetItem(SKIN_KEY, JSON.stringify({
    snake: snakeSkinId,
    fruit: fruitSkinId,
    board: boardSkinId,
    background: backgroundThemeId
  }));
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
let boardColors = [DEFAULT_COLORS.boardBase, DEFAULT_COLORS.boardAccent];
let snakeColorHead = DEFAULT_COLORS.snakeHead;
let snakeBodyColor = DEFAULT_COLORS.snakeBody;
let fruitColor = DEFAULT_COLORS.fruit;
let obstacles = [];
let runMissionState = { wallsOffScore: 0, topSpeedMs: 0, poisonCount: 0 };
let poisonStreak = 0;
let poisonFlashUntil = 0;
let lastTopSpeedSecondsShown = 0;
const FoodType = Object.freeze({
  Apple: 'apple',
  Banana: 'banana',
  Chili: 'chili',
  Poison: 'poison'
});
const FOOD_WEIGHTS = [
  { type: FoodType.Apple, weight: 0.55 },
  { type: FoodType.Banana, weight: 0.25 },
  { type: FoodType.Chili, weight: 0.1 },
  { type: FoodType.Poison, weight: 0.1 }
];
let won = false;
let winHandled = false;
const spriteEffects = [];
const COMBO_WINDOW_MS = 3500;
let comboCount = 0;
let comboBest = 0;
let comboExpiry = 0;

const gridTextureState = {
  canvas: null,
  baseCanvas: null,
  size: 0,
  cellSize: 0,
  colorsKey: '',
  cells: 0,
  needsBaseRedraw: true,
  needsComposite: true,
  bandCenter: 0.5
};

function invalidateGridTexture() {
  gridTextureState.needsBaseRedraw = true;
  gridTextureState.needsComposite = true;
}

function ensureGridCanvases() {
  if (!gridTextureState.baseCanvas) {
    gridTextureState.baseCanvas = document.createElement('canvas');
  }
  if (!gridTextureState.canvas) {
    gridTextureState.canvas = document.createElement('canvas');
  }
}

function drawGridBase(size, cellSize, cells, colors) {
  ensureGridCanvases();
  const base = gridTextureState.baseCanvas;
  if (!base) return;
  if (base.width !== size || base.height !== size) {
    base.width = size;
    base.height = size;
  }
  const bctx = base.getContext('2d');
  if (!bctx) return;
  bctx.clearRect(0, 0, size, size);
  const baseColor = colors[0] || '#111623';
  bctx.fillStyle = baseColor;
  bctx.fillRect(0, 0, size, size);
  const accentColor = colors[1] || baseColor;
  const accentHex = (typeof accentColor === 'string' && accentColor.startsWith('#'))
    ? accentColor
    : ((typeof baseColor === 'string' && baseColor.startsWith('#')) ? baseColor : null);
  const accentRgb = accentHex ? hexToRgb(accentHex) : null;
  if (accentRgb) {
    const grad = bctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0.26)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, size, size);
  }
  const lineAlpha = 0.08;
  bctx.save();
  bctx.strokeStyle = `rgba(255,255,255,${lineAlpha})`;
  bctx.lineWidth = 1;
  bctx.beginPath();
  for (let i = 1; i < cells; i++) {
    const x = i * cellSize + 0.5;
    bctx.moveTo(x, 0);
    bctx.lineTo(x, size);
  }
  for (let j = 1; j < cells; j++) {
    const y = j * cellSize + 0.5;
    bctx.moveTo(0, y);
    bctx.lineTo(size, y);
  }
  bctx.stroke();
  bctx.restore();
}

function ensureGridTexture(size, cellSize, cells, colors, time) {
  ensureGridCanvases();
  const base = gridTextureState.baseCanvas;
  const composite = gridTextureState.canvas;
  if (!base || !composite) return null;
  const roundedSize = Math.max(1, Math.round(size));
  const colorsKey = Array.isArray(colors) ? colors.join('|') : String(colors);
  const changedSize = gridTextureState.size !== roundedSize;
  const changedCell = Math.abs(gridTextureState.cellSize - cellSize) > 0.001;
  const changedColors = gridTextureState.colorsKey !== colorsKey;
  const changedCells = gridTextureState.cells !== cells;
  if (changedSize) {
    base.width = roundedSize;
    base.height = roundedSize;
    composite.width = roundedSize;
    composite.height = roundedSize;
  }
  if (gridTextureState.needsBaseRedraw || changedSize || changedCell || changedColors || changedCells) {
    drawGridBase(roundedSize, roundedSize / cells, cells, colors);
    gridTextureState.needsBaseRedraw = false;
    gridTextureState.needsComposite = true;
    gridTextureState.size = roundedSize;
    gridTextureState.cellSize = roundedSize / cells;
    gridTextureState.colorsKey = colorsKey;
    gridTextureState.cells = cells;
  }
  const ctx = composite.getContext('2d');
  if (!ctx) return null;
  const drift = 0.08;
  const bandCenter = 0.5 + drift * Math.sin(time / 6000);
  const needsBandUpdate = gridTextureState.needsComposite || Math.abs(bandCenter - gridTextureState.bandCenter) > 0.002;
  if (needsBandUpdate) {
    ctx.clearRect(0, 0, composite.width, composite.height);
    ctx.drawImage(base, 0, 0);
    const sigma = roundedSize / 3;
    const centerPx = bandCenter * roundedSize;
    const highlightColor = colors[1] || colors[0] || '#ffffff';
    const rgb = hexToRgb(typeof highlightColor === 'string' && highlightColor.startsWith('#') ? highlightColor : '#ffffff') || { r: 255, g: 255, b: 255 };
    const gradient = ctx.createLinearGradient(0, 0, roundedSize, 0);
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const pos = i / steps;
      const x = pos * roundedSize;
      const alpha = 0.12 * Math.exp(-Math.pow(x - centerPx, 2) / (2 * sigma * sigma));
      gradient.addColorStop(pos, `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, roundedSize, roundedSize);
    ctx.restore();
    gridTextureState.bandCenter = bandCenter;
    gridTextureState.needsComposite = false;
  }
  return composite;
}

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
    color: options.color || null,
    start: performance.now()
  });
}

function drawBurstEffect(ctx, fx, progress) {
  const alpha = 1 - Math.min(1, Math.max(0, progress));
  const centerX = (fx.x + (fx.offsetX ?? 0.5)) * CELL;
  const centerY = (fx.y + (fx.offsetY ?? 0.5)) * CELL;
  const radius = CELL * (0.45 + (fx.scale || 1) * 0.35 * progress);
  const spikes = 10;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(1, Math.round(CELL * 0.08));
  ctx.lineCap = 'round';
  ctx.strokeStyle = fx.color || '#facc15';
  for (let i = 0; i < spikes; i++) {
    const angle = (i / spikes) * Math.PI * 2;
    const inner = radius * 0.3;
    const outer = radius;
    ctx.beginPath();
    ctx.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
    ctx.lineTo(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.45, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSpriteEffects(ctx, time) {
  for (let i = spriteEffects.length - 1; i >= 0; i--) {
    const fx = spriteEffects[i];
    const progressRaw = (time - fx.start) / fx.duration;
    if (progressRaw >= 1) {
      spriteEffects.splice(i, 1);
      continue;
    }
    const progress = Math.max(0, progressRaw);
    if (fx.type === 'burst') {
      drawBurstEffect(ctx, fx, progress);
      continue;
    }
    const img = ensureSprite(fx.type);
    if (!img || !img.complete || !img.naturalWidth) continue;
    const alpha = 1 - Math.min(1, Math.max(0, progress));
    const size = Math.max(1, Math.round(CELL * (fx.scale || 1)));
    const drawX = Math.round((fx.x + (fx.offsetX ?? 0.5)) * CELL - size / 2);
    const drawY = Math.round((fx.y + (fx.offsetY ?? 0.5)) * CELL - size / 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, drawX, drawY, size, size);
    ctx.restore();
  }
}

function spawnAppleBurst(gridX, gridY) {
  spawnSpriteEffect('burst', gridX, gridY, { duration: 420, scale: 1.3, color: fruitColor });
}

function triggerDeathEffect(head) {
  const clampedX = Math.min(Math.max(head.x, 0), N - 1);
  const clampedY = Math.min(Math.max(head.y, 0), N - 1);
  spawnSpriteEffect('explosion', clampedX, clampedY, { duration: 600, scale: 1.6 });
  deathBlinkUntil = performance.now() + 1200;
}
function syncHighContrastClass() {
  if (typeof document === 'undefined') return;
  const body = document.body;
  if (!body) return;
  body.classList.toggle('snake-high-contrast', !!highContrastEnabled);
}

function applySkin() {
  const s = SNAKE_SKINS.find(t => t.id === snakeSkinId);
  const f = FRUIT_SKINS.find(t => t.id === fruitSkinId);
  const b = BOARD_THEMES.find(t => t.id === boardSkinId);
  boardColors = Array.isArray(b.colors) ? b.colors.slice() : [DEFAULT_COLORS.boardBase, DEFAULT_COLORS.boardAccent];
  const headHex = (s && (s.head || s.color)) || DEFAULT_COLORS.snakeHead;
  const bodyHex = (s && (s.body || s.color)) || DEFAULT_COLORS.snakeBody;
  snakeColorHead = headHex;
  snakeBodyColor = bodyHex;
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
  fruitColor = f.color || DEFAULT_COLORS.fruit;
  if (highContrastEnabled) {
    boardColors = [HIGH_CONTRAST_COLORS.boardBase, HIGH_CONTRAST_COLORS.boardAccent];
    snakeColorHead = HIGH_CONTRAST_COLORS.snakeHead;
    snakeBodyColor = HIGH_CONTRAST_COLORS.snakeBody;
    fruitColor = HIGH_CONTRAST_COLORS.fruit;
  }
  setBackgroundTheme(backgroundThemeId);
  saveSkinSelection();
  syncHighContrastClass();
  invalidateGridTexture();
}
function populateSkinSelects() {
  const ss = document.getElementById('snakeSkin');
  const fs = document.getElementById('fruitSkin');
  const bs = document.getElementById('boardSkin');
  const bg = document.getElementById('backgroundSkin');
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
  fill(bg, BACKGROUND_THEMES, backgroundThemeId, v => backgroundThemeId = v);
}

function getMissionStats(mission) {
  const goal = Number(mission.goal) || 0;
  let value = 0;
  let statusText = '';
  let disabled = false;
  switch (mission.type) {
    case 'walls-score': {
      const tracked = Math.max(progress.missions.wallsOffScore || 0, runMissionState.wallsOffScore || 0);
      value = tracked;
      statusText = `${Math.min(tracked, goal)} / ${goal} pts`;
      break;
    }
    case 'top-speed': {
      const tracked = Math.max(progress.missions.topSpeedMs || 0, runMissionState.topSpeedMs || 0);
      value = tracked;
      const seconds = Math.floor(tracked / 1000);
      const goalSeconds = Math.floor(goal / 1000);
      statusText = `${Math.min(seconds, goalSeconds)} / ${goalSeconds} s`;
      break;
    }
    case 'poison': {
      const tracked = Math.max(progress.missions.poisonCount || 0, runMissionState.poisonCount || 0);
      value = tracked;
      statusText = `${Math.min(tracked, goal)} / ${goal} snacks`;
      break;
    }
    default:
      value = 0;
      statusText = `${value}/${goal}`;
  }
  const percent = goal > 0 ? Math.min(1, value / goal) : 0;
  const complete = percent >= 1;
  if (complete) statusText = 'Complete!';
  return { value, goal, percent, complete, statusText, disabled };
}

function renderMissions() {
  if (!missionListNode) return;
  const items = MISSIONS.map(mission => {
    const stats = getMissionStats(mission);
    const percent = Math.round(stats.percent * 100);
    const name = escapeHtml(mission.name);
    const description = escapeHtml(mission.description);
    const status = escapeHtml(stats.statusText);
    return `
      <li class="hud-mission" data-complete="${stats.complete ? 'true' : 'false'}" data-disabled="${stats.disabled ? 'true' : 'false'}">
        <div class="hud-mission__name">${name}</div>
        <div class="hud-mission__desc">${description}</div>
        <div class="hud-mission__meter"><span style="width:${percent}%;"></span></div>
        <div class="hud-mission__status">${status}</div>
      </li>
    `;
  }).join('');
  missionListNode.innerHTML = items;
}

function renderComboPanel(now = performance.now()) {
  if (!comboMeterNode) return;
  const active = comboCount > 0 && now <= comboExpiry;
  const value = active ? comboCount : 0;
  const bestForMax = Math.max(comboBest, MISSIONS.find(m => m.type === 'combo')?.goal || 5, 5);
  comboMeterNode.textContent = active ? `x${comboCount}` : 'x0';
  comboMeterNode.dataset.active = active ? 'true' : 'false';
  comboMeterNode.setAttribute('aria-valuenow', String(value));
  comboMeterNode.setAttribute('aria-valuemax', String(bestForMax));
  comboMeterNode.setAttribute('aria-valuetext', active ? `Combo x${comboCount}` : 'No combo');
  if (comboTimerNode) {
    if (active) {
      const remaining = Math.max(0, comboExpiry - now);
      comboTimerNode.textContent = `${(remaining / 1000).toFixed(1)}s window • Best x${Math.max(comboBest, comboCount)}`;
    } else {
      comboTimerNode.textContent = comboBest > 0 ? `Best combo x${comboBest}` : 'Chain snacks quickly to start a combo!';
    }
  }
}

function registerComboHit(now = performance.now()) {
  if (now <= comboExpiry) comboCount += 1;
  else comboCount = 1;
  comboExpiry = now + COMBO_WINDOW_MS;
  if (comboCount > comboBest) comboBest = comboCount;
  renderComboPanel(now);
  renderMissions();
  scheduleDiagnosticsRender();
  if (comboCount > 1) {
    gameEvent('combo', {
      slug: SLUG,
      count: comboCount,
      meta: {
        best: comboBest,
      },
    });
  }
}

function decayCombo(now = performance.now()) {
  if (comboCount > 0 && now > comboExpiry) {
    comboCount = 0;
    renderComboPanel(now);
    renderMissions();
  }
}

function setDiagnosticsEnabled(enabled) {
  diagnosticsEnabled = !!enabled;
  if (diagnosticsToggle) diagnosticsToggle.checked = diagnosticsEnabled;
  if (diagnosticsEnabled) {
    if (debugPanel) debugPanel.style.display = 'block';
    if (watchdogLogNode) watchdogLogNode.style.display = 'block';
    updateDebugPanel();
  } else {
    if (debugPanel) {
      debugPanel.style.display = 'none';
      debugPanel.textContent = '';
    }
    if (watchdogLogNode) {
      watchdogLogNode.style.display = 'none';
      watchdogLogNode.textContent = '';
    }
  }
  safeStorageSetItem(DIAGNOSTICS_KEY, diagnosticsEnabled ? '1' : '0');
}

function scheduleDiagnosticsRender() {
  if (!diagnosticsEnabled) return;
  if (pendingDiagnosticsFrame) return;
  pendingDiagnosticsFrame = true;
  const cb = () => {
    pendingDiagnosticsFrame = false;
    updateDebugPanel();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cb);
  else setTimeout(cb, 32);
}
let paused = false;

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
let applesEaten = 0;
let lastReplayRecord = parseJSONSafe(safeStorageGetItem(REPLAY_STORAGE_KEY), null);
let maxSnakeLength = snake.length;
let deathBlinkUntil = 0;

const debugPanel = document.getElementById('debugPanel');
if (diagnosticsToggle) {
  diagnosticsToggle.checked = diagnosticsEnabled;
  diagnosticsToggle.addEventListener('change', () => setDiagnosticsEnabled(diagnosticsToggle.checked));
}
setDiagnosticsEnabled(diagnosticsEnabled);

function updateDebugPanel() {
  if (!debugPanel || !diagnosticsEnabled) return;
  const now = performance.now();
  const raf = bootStatus.watchdogs?.raf || null;
  const rafGap = raf?.lastTick ? Math.max(0, Math.round(now - raf.lastTick)) : null;
  const rafFirst = raf?.firstTick && bootStatus.started ? Math.max(0, Math.round(raf.firstTick - bootStatus.started)) : null;
  const lastLog = bootLogEntries.length ? bootLogEntries[bootLogEntries.length - 1] : null;
  const canvasWatch = bootStatus.watchdogs?.canvas;
  const canvasStatus = canvasWatch?.interval ? 'pending' : 'ready';
  debugPanel.style.display = 'block';
  debugPanel.dataset.level = lastLog?.level || 'info';
  const lastLogEvent = lastLog ? escapeHtml(lastLog.event) : '—';
  const canvasStatusHtml = escapeHtml(canvasStatus);
  debugPanel.innerHTML = `
    Tick <strong>${tickCounter}</strong><br/>
    Length <strong>${snake.length}</strong><br/>
    Combo best <strong>x${comboBest}</strong><br/>
    Food slots <strong>${lastFoodCandidateCount}</strong><br/>
    RAF gap <strong>${rafGap != null ? escapeHtml(String(rafGap)) + ' ms' : '—'}</strong>${rafFirst != null ? ` (start +${escapeHtml(String(rafFirst))} ms)` : ''}<br/>
    Canvas <strong>${canvasStatusHtml}</strong><br/>
    Last log <strong>${lastLogEvent}</strong>
  `;
  if (watchdogLogNode) {
    const entries = bootLogEntries.slice(-6).reverse();
    watchdogLogNode.style.display = 'block';
    if (!entries.length) {
      watchdogLogNode.innerHTML = '<div class="hud-log hud-log--info"><span class="hud-log__message">No watchdog activity recorded.</span></div>';
    } else {
      watchdogLogNode.innerHTML = entries.map(entry => {
        const rel = bootStatus.started ? Math.max(0, entry.at - bootStatus.started) : entry.at;
        const relText = `${(rel / 1000).toFixed(1)}s`;
        let detailText = '';
        if (entry.detail && typeof entry.detail === 'object') {
          const detailPairs = Object.entries(entry.detail).slice(0, 2)
            .map(([key, value]) => {
              const safeKey = escapeHtml(key);
              const snippet = escapeHtml(String(value).slice(0, 28));
              return `${safeKey}:${snippet}`;
            });
          if (detailPairs.length) detailText = detailPairs.join(' • ');
        }
        const safeTime = escapeHtml(relText);
        const safeMessage = escapeHtml(entry.event);
        const safeDetail = detailText ? `<span class="hud-log__detail">${detailText}</span>` : '';
        const level = entry.level || 'info';
        return `
          <div class="hud-log hud-log--${level}">
            <span class="hud-log__time">${safeTime}</span>
            <span class="hud-log__message">${safeMessage}</span>
            ${safeDetail}
          </div>
        `;
      }).join('');
    }
  }
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
let lastTurnTick = 0;

function normalizeDirection(nd) {
  if (!nd || typeof nd.x !== 'number' || typeof nd.y !== 'number') return null;
  const x = Math.sign(nd.x);
  const y = Math.sign(nd.y);
  if ((x !== 0 && y !== 0) || (x === 0 && y === 0)) return null;
  return { x, y };
}

function directionsEqual(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

function directionsOpposite(a, b) {
  return !!a && !!b && a.x === -b.x && a.y === -b.y;
}

function enqueueTurn(nd, source = 'player') {
  const normalized = normalizeDirection(nd);
  if (!normalized) return;
  const lastEntry = turnBuffer.length ? turnBuffer[turnBuffer.length - 1] : null;
  const referenceDir = lastEntry ? lastEntry.dir : dir;
  if (directionsEqual(normalized, referenceDir)) return;
  if (directionsOpposite(normalized, referenceDir)) return;
  if (lastEntry && lastEntry.tick === tickCounter) return;
  if (turnBuffer.length >= MAX_TURN_BUFFER) return;
  const entryTick = lastEntry ? Math.max(lastEntry.tick + 1, tickCounter) : tickCounter;
  turnBuffer.push({ dir: normalized, tick: entryTick });
  if (source === 'player') recordReplayInput(normalized);
}

function updatePauseButtonUI() {
  if (!pauseButtonEl) return;
  const state = paused ? 'resume' : 'pause';
  pauseButtonEl.dataset.state = state;
  pauseButtonEl.textContent = paused ? 'Resume' : 'Pause';
  pauseButtonEl.setAttribute('aria-pressed', paused ? 'true' : 'false');
}

function pauseGame(reason = 'manual') {
  if (paused) return;
  if (dead || won) return;
  paused = true;
  bootLog('game:paused', { reason });
  setPauseOverlayActive(true);
  updatePauseButtonUI();
}

function resumeGame(reason = 'manual') {
  if (!paused) return;
  paused = false;
  bootLog('game:resumed', { reason });
  setPauseOverlayActive(false);
  updatePauseButtonUI();
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
  setPauseOverlayActive(false);
  updatePauseButtonUI();
  resumeAfterHowTo = false;
  moveAcc = 0;
  speedTier = 1;
  lastSpeedTierEmitted = 1;
  speedBoostActive = false;
  speedBoostUntil = 0;
  tickCounter = 0;
  lastTurnTick = 0;
  foodsEaten = 0;
  applesEaten = 0;
  maxSnakeLength = snake.length;
  deathBlinkUntil = 0;
  spriteEffects.length = 0;
  runMissionState = { wallsOffScore: 0, topSpeedMs: 0, poisonCount: 0 };
  lastTopSpeedSecondsShown = 0;
  poisonStreak = 0;
  poisonFlashUntil = 0;
  recalcSpeedMs();
  score = 0;
  comboCount = 0;
  comboBest = 0;
  comboExpiry = 0;
  renderComboPanel();
  renderMissions();
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
    renderMissions();
  }
  populateSkinSelects();
  buildBoard(null);
  food = spawnFood();
  fruitSpawnTime = performance.now();
  requestHudSync();
  bootLog('game:reset', { reason, seed });
  runStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  gameOverReported = false;
  if (!skipProgress) {
    gameEvent('play', {
      slug: SLUG,
      meta: {
        reason,
        daily: !!DAILY_MODE,
      },
    });
  }
  if (engine && !engine.running) engine.start();
  updateDebugPanel();
}

function reportGameOutcome(result) {
  if (gameOverReported) return;
  gameOverReported = true;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const durationMs = Math.max(0, Math.round(now - (runStartTime || now)));
  const meta = {
    result,
    score,
    length: snake.length,
    speedTier,
    comboBest,
    wallsEnabled,
    wrapEnabled,
    poisonCount: runMissionState.poisonCount,
    topSpeedMs: Math.round(runMissionState.topSpeedMs),
    applesEaten,
    maxLength: Math.max(maxSnakeLength, snake.length)
  };
  gameEvent('game_over', {
    slug: SLUG,
    value: score,
    durationMs,
    meta,
  });
  gameEvent(result === 'win' ? 'win' : 'lose', {
    slug: SLUG,
    meta,
  });
}

resetGame('boot');

document.addEventListener('keydown', e => {
  if (howToOverlay && howToOverlay.dataset.active === 'true') return;
  if (e.key.toLowerCase() === 'p') togglePause('keyboard');
});

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

function pickFruitArt() {
  let art = FRUIT_ART.length ? FRUIT_ART[Math.floor(rand() * FRUIT_ART.length)] : { icon: '🍎', label: '🍎', spriteKey: 'fruit' };
  if (fruitSkinId === 'gems' && FRUIT_ART.length) {
    art = FRUIT_ART[gemSpriteIndex % FRUIT_ART.length];
    gemSpriteIndex = (gemSpriteIndex + 1) % FRUIT_ART.length;
  }
  return {
    icon: art.icon,
    label: art.label ?? art.icon,
    spriteKey: art.spriteKey || 'fruit'
  };
}

function createFoodOfType(type) {
  switch (type) {
    case FoodType.Apple: {
      const art = pickFruitArt();
      return {
        type,
        icon: art.icon,
        label: art.label,
        spriteKey: art.spriteKey,
        color: fruitColor,
        points: 1
      };
    }
    case FoodType.Banana:
      return {
        type,
        icon: '🍌',
        label: '🍌',
        spriteKey: null,
        color: '#facc15',
        points: 2
      };
    case FoodType.Chili:
      return {
        type,
        icon: '🌶️',
        label: '🌶️',
        spriteKey: null,
        color: '#f97316',
        points: 0
      };
    case FoodType.Poison:
      return {
        type,
        icon: '☠️',
        label: '☠️',
        spriteKey: null,
        color: '#a855f7',
        points: 5
      };
    default:
      return {
        type: FoodType.Apple,
        icon: '🍎',
        label: '🍎',
        spriteKey: 'fruit',
        color: fruitColor,
        points: 1
      };
  }
}

function pickFoodTypeWeighted() {
  let total = 0;
  for (const entry of FOOD_WEIGHTS) total += entry.weight;
  if (total <= 0) return FoodType.Apple;
  const target = rand() * total;
  let acc = 0;
  for (const entry of FOOD_WEIGHTS) {
    acc += entry.weight;
    if (target <= acc) return entry.type;
  }
  return FOOD_WEIGHTS.length ? FOOD_WEIGHTS[FOOD_WEIGHTS.length - 1].type : FoodType.Apple;
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
      reportGameOutcome('win');
      if (engine && typeof engine.stop === 'function') {
        try { engine.stop(); } catch (err) { bootLog('game:win-stop-error', { message: err?.message || String(err) }); }
      }
    }
    updateDebugPanel();
    return null;
  }

  const selectedType = pickFoodTypeWeighted();
  const base = createFoodOfType(selectedType);
  const idx = freeCells[(rand() * freeCells.length) | 0];
  const coords = fromIndex(idx);
  const fruit = { ...base, x: coords.x, y: coords.y, index: idx };
  playSfx('click');
  buildBoard(fruit);
  updateDebugPanel();
  return fruit;
}

function addObstacleRow() {
  if (!wallsEnabled) return;
  const y = Math.floor(rand() * N);
  for (let x = 4; x < N - 4; x++) obstacles.push({ x, y });
  buildBoard(food);
  updateDebugPanel();
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

function recalcSpeedMs() {
  const tierIndex = Math.max(0, speedTier - 1);
  const baseSpeed = Math.max(SPEED_MIN_MS, SPEED_BASE_MS - tierIndex * SPEED_STEP_MS);
  let next = baseSpeed;
  if (speedBoostActive) {
    next = Math.max(SPEED_MIN_MS * 0.5, Math.floor(baseSpeed * SPEED_BURST_MULTIPLIER));
  }
  speedMs = next;
}

function updateSpeedTierFromFoods() {
  const expectedTier = Math.min(SPEED_TIER_MAX, 1 + Math.floor(foodsEaten / SPEEDUP_INTERVAL));
  if (expectedTier > speedTier) {
    speedTier = expectedTier;
    if (speedTier > lastSpeedTierEmitted) {
      lastSpeedTierEmitted = speedTier;
      gameEvent('level_up', {
        slug: SLUG,
        level: speedTier
      });
    }
  }
  recalcSpeedMs();
  requestHudSync();
}

function activateSpeedBurst(durationMs) {
  const now = performance.now();
  speedBoostActive = true;
  speedBoostUntil = now + durationMs;
  recalcSpeedMs();
  if (uiController && typeof uiController.setBoostActive === 'function') {
    try { uiController.setBoostActive(true, durationMs); } catch (_) {}
  }
  requestHudSync();
}

function updateSpeedBurst(now = performance.now()) {
  if (!speedBoostActive) return;
  if (now >= speedBoostUntil) {
    speedBoostActive = false;
    speedBoostUntil = 0;
    recalcSpeedMs();
    if (uiController && typeof uiController.setBoostActive === 'function') {
      try { uiController.setBoostActive(false, 0); } catch (_) {}
    }
    requestHudSync();
  }
}

function applyPickupEffect(pickup, head) {
  const result = { grow: true, extraTailRemoval: 0 };
  foodsEaten++;
  if (pickup.type === FoodType.Apple) applesEaten++;
  const points = Number(pickup.points) || 0;
  if (points !== 0) {
    score += points;
    if (points > 0) GG.addXP(points);
    if (score > bestScore) {
      bestScore = score;
      safeStorageSetItem('snake:best', String(bestScore));
      requestHudSync();
    }
  }
  if (!wallsEnabled) {
    runMissionState.wallsOffScore = Math.max(runMissionState.wallsOffScore, score);
    if (runMissionState.wallsOffScore > progress.missions.wallsOffScore) {
      progress.missions.wallsOffScore = runMissionState.wallsOffScore;
      saveProgress();
    }
  }
  const now = performance.now();
  let hazardComboMeta = 0;
  switch (pickup.type) {
    case FoodType.Chili: {
      poisonStreak = 0;
      const duration = SPEED_BURST_MIN_MS + Math.floor(rand() * SPEED_BURST_RANGE_MS);
      activateSpeedBurst(duration);
      break;
    }
    case FoodType.Poison: {
      poisonStreak += 1;
      hazardComboMeta = poisonStreak;
      runMissionState.poisonCount += 1;
      if (runMissionState.poisonCount > progress.missions.poisonCount) {
        progress.missions.poisonCount = runMissionState.poisonCount;
        saveProgress();
      }
      result.grow = false;
      const lengthAfterBase = Math.max(0, snake.length - 1);
      const shrink = lengthAfterBase > 2 ? 1 : 0;
      result.extraTailRemoval = shrink;
      poisonFlashUntil = now + 800;
      if (uiController && typeof uiController.flashPoisonWarning === 'function') {
        try { uiController.flashPoisonWarning(); } catch (_) {}
      }
      break;
    }
    default:
      poisonStreak = 0;
      break;
  }
  playSfx('power');
  if (pickup.type === FoodType.Apple) spawnAppleBurst(head.x, head.y);
  else spawnSpriteEffect('spark', head.x, head.y, { duration: 500, scale: pickup.type === FoodType.Poison ? 0.9 : 1.25 });
  updateSpeedTierFromFoods();
  if (pickup.type === FoodType.Apple && applesEaten === 10) GG.addAch(GAME_ID, 'Apple Collector');
  const predictedLength = Math.max(1, snake.length + (result.grow ? 0 : -1) - (result.extraTailRemoval || 0));
  const predictedMax = Math.max(maxSnakeLength, predictedLength);
  const meta = {
    points,
    foodType: pickup.type,
    combo: comboCount,
    speedTier,
    hazardCombo: hazardComboMeta,
    walls: wallsEnabled,
    wrap: wrapEnabled,
    applesEaten,
    length: predictedLength,
    maxLength: predictedMax
  };
  gameEvent('score', { slug: SLUG, value: score, meta });
  requestHudSync();
  renderMissions();
  return result;
}

function step() {
  pumpReplayInputs();
  if (turnBuffer.length) {
    const nextEntry = turnBuffer.shift();
    if (nextEntry && nextEntry.dir && !directionsOpposite(nextEntry.dir, lastDir)) {
      dir = { x: nextEntry.dir.x, y: nextEntry.dir.y };
      lastTurnTick = nextEntry.tick;
    }
  }
  lastSnake = snake.map(s => ({ ...s }));
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  lastDir = { ...dir };
  const now = performance.now();
  const deltaSinceLast = Math.max(0, now - lastTickTime);
  if (speedTier >= SPEED_TIER_MAX && deltaSinceLast > 0) {
    runMissionState.topSpeedMs += deltaSinceLast;
    const seconds = Math.floor(runMissionState.topSpeedMs / 1000);
    let missionsUpdated = false;
    if (runMissionState.topSpeedMs > progress.missions.topSpeedMs) {
      progress.missions.topSpeedMs = runMissionState.topSpeedMs;
      saveProgress();
      missionsUpdated = true;
    }
    if (seconds !== lastTopSpeedSecondsShown) {
      lastTopSpeedSecondsShown = seconds;
      missionsUpdated = true;
    }
    if (missionsUpdated) renderMissions();
  }
  if (wrapEnabled) {
    if (head.x < 0) head.x = N - 1;
    if (head.x >= N) head.x = 0;
    if (head.y < 0) head.y = N - 1;
    if (head.y >= N) head.y = 0;
  } else {
    if (head.x < 0 || head.x >= N || head.y < 0 || head.y >= N) {
      dead = true;
      deadHandled = false;
      triggerDeathEffect(head);
      reportGameOutcome('lose');
    }
  }
  if (!dead) {
    const idx = toIndex(head.x, head.y);
    const occupant = boardState[idx];
    if (occupant === CellType.Snake || occupant === CellType.Obstacle) {
      dead = true;
      deadHandled = false;
      triggerDeathEffect(head);
      reportGameOutcome('lose');
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
  if (snake.length > maxSnakeLength) {
    maxSnakeLength = snake.length;
    if (maxSnakeLength >= LONG_SNAKE_LENGTH) GG.addAch(GAME_ID, 'Serpent Stretch');
  }
  if (consumed) {
    registerComboHit(performance.now());
    food = spawnFood();
    fruitSpawnTime = performance.now();
  }
  buildBoard(food);
  tickCounter++;
  lastTickTime = now;
  updateDebugPanel();
}

function draw() {
  if(!postedReady){
    postedReady=true;
    try { window.parent?.postMessage({ type:'GAME_READY', slug:'snake' }, '*'); } catch {}
  }
  const time = performance.now();
  syncHud();
  const maxSide = Math.min(c.width, c.height);
  const cellSize = Math.max(1, Math.floor(maxSide / N));
  const side = cellSize * N;
  const offsetX = Math.floor((c.width - side) / 2);
  const offsetY = Math.floor((c.height - side) / 2);
  const backgroundDelta = Math.min(Math.max(time - lastBackgroundTime, 0), 1000);
  lastBackgroundTime = time;
  decayCombo(time);
  renderComboPanel(time);
  // CELL is derived from the square side length so that N cells always fit exactly.
  CELL = cellSize;
  // Store offsets so any canvas-space interaction can subtract them before using CELL.
  boardOffsetX = offsetX;
  boardOffsetY = offsetY;

  ctx.clearRect(0, 0, c.width, c.height);

  let backgroundDrawn = false;
  const layers = Array.isArray(backgroundLayers) ? backgroundLayers : [];
  if (layers.length) {
    if (backgroundScrollOffsets.length !== layers.length) backgroundScrollOffsets = new Array(layers.length).fill(0);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    layers.forEach((layer, idx) => {
      const image = layer?.image;
      if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) return;
      const speed = backgroundScrollSpeeds[idx] ?? backgroundScrollSpeeds[backgroundScrollSpeeds.length - 1] ?? 0.004;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) return;
      backgroundScrollOffsets[idx] = (backgroundScrollOffsets[idx] + backgroundDelta * speed) % width;
      const scrollX = backgroundScrollOffsets[idx];
      ctx.save();
      ctx.globalAlpha = typeof layer.alpha === 'number' ? layer.alpha : (idx === 0 ? 0.9 : 0.7);
      for (let x = -width; x < side + width; x += width) {
        for (let y = -height; y < side + height; y += height) {
          ctx.drawImage(image, x - scrollX, y, width, height);
        }
      }
      ctx.restore();
      backgroundDrawn = true;
    });
    if (backgroundDrawn && backgroundOverlayColor) {
      ctx.save();
      ctx.fillStyle = backgroundOverlayColor;
      ctx.fillRect(0, 0, side, side);
      ctx.restore();
    }
    ctx.restore();
  }
  if (!backgroundDrawn) {
    ctx.fillStyle = boardColors[0];
    ctx.fillRect(offsetX, offsetY, side, side);
  }

  const gridTexture = ensureGridTexture(side, CELL, N, boardColors, time);
  if (gridTexture) {
    ctx.save();
    ctx.globalAlpha = backgroundDrawn ? 0.85 : 1;
    ctx.drawImage(gridTexture, offsetX, offsetY, side, side);
    ctx.restore();
  }

  if (scoreNode) {
    scoreNode.textContent = String(score);
    scoreNode.dataset.gameScore = String(score);
  }

  if (poisonFlashUntil > time) {
    const remaining = Math.max(0, poisonFlashUntil - time);
    const alpha = Math.min(1, remaining / 800);
    ctx.save();
    ctx.fillStyle = `rgba(239,68,68,${0.18 * alpha})`;
    ctx.fillRect(offsetX, offsetY, side, side);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(offsetX, offsetY);

  // fruit with spawn animation
  if (food) {
    const ft = Math.min((time - fruitSpawnTime) / 300, 1);
    const fruitSpriteKey = food.spriteKey || null;
    const fruitImg = fruitSpriteKey ? ensureSprite(fruitSpriteKey) : null;
    const size = Math.max(1, Math.round(CELL * (0.6 + 0.4 * ft)));
    const drawX = Math.round((food.x + 0.5) * CELL - size / 2);
    const drawY = Math.round((food.y + 0.5) * CELL - size / 2);
    ctx.save();
    ctx.globalAlpha = ft;
    if (fruitImg && !Array.isArray(fruitImg) && fruitImg.complete && fruitImg.naturalWidth) {
      ctx.drawImage(fruitImg, drawX, drawY, size, size);
    } else if (typeof food.icon === 'string') {
      ctx.fillStyle = food.color || fruitColor;
      ctx.font = `${Math.max(10, Math.floor(size * 0.8))}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(food.icon, drawX + size / 2, drawY + size / 2);
    } else {
      ctx.fillStyle = food.color || fruitColor;
      ctx.fillRect(drawX, drawY, size, size);
    }
    ctx.restore();
  }

  // snake interpolation
  const t = Math.min((time - lastTickTime) / speedMs, 1);
  const flameActive = speedBoostActive && speedBoostUntil > time;
  let headPixel = null;
  snake.forEach((s, idx) => {
    const prev = lastSnake[idx] || lastSnake[lastSnake.length - 1];
    const interpolatedX = (prev.x + (s.x - prev.x) * t) * CELL;
    const interpolatedY = (prev.y + (s.y - prev.y) * t) * CELL;
    const x = Math.round(interpolatedX);
    const y = Math.round(interpolatedY);
    if (idx === 0 && flameActive) {
      const centerX = x + CELL / 2;
      const centerY = y + CELL / 2;
      const backX = centerX - lastDir.x * CELL * 0.7;
      const backY = centerY - lastDir.y * CELL * 0.7;
      const leftX = centerX - lastDir.y * CELL * 0.35;
      const leftY = centerY + lastDir.x * CELL * 0.35;
      const rightX = centerX + lastDir.y * CELL * 0.35;
      const rightY = centerY - lastDir.x * CELL * 0.35;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(249,115,22,0.75)';
      ctx.beginPath();
      ctx.moveTo(backX, backY);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,221,89,0.7)';
      ctx.beginPath();
      ctx.moveTo(centerX - lastDir.x * CELL * 0.4, centerY - lastDir.y * CELL * 0.4);
      ctx.lineTo((leftX + centerX) / 2, (leftY + centerY) / 2);
      ctx.lineTo((rightX + centerX) / 2, (rightY + centerY) / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (idx === 0) {
      ctx.save();
      ctx.fillStyle = snakeColorHead;
      ctx.fillRect(x, y, CELL, CELL);
      const inset = Math.max(1, Math.round(CELL * 0.18));
      ctx.fillStyle = snakeBodyColor;
      ctx.fillRect(x + inset, y + inset, CELL - inset * 2, CELL - inset * 2);
      ctx.restore();
      headPixel = { x, y };
    } else {
      ctx.save();
      const fade = Math.max(0.35, 0.9 - (idx / Math.max(1, snake.length)) * 0.45);
      ctx.globalAlpha = fade;
      ctx.fillStyle = snakeBodyColor;
      ctx.fillRect(x, y, CELL, CELL);
      ctx.restore();
    }
  });
  if (dead && deathBlinkUntil > time && headPixel) {
    const blink = 0.35 + 0.4 * Math.abs(Math.sin(time / 80));
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.fillStyle = 'rgba(248,113,113,0.9)';
    ctx.fillRect(headPixel.x, headPixel.y, CELL, CELL);
    ctx.restore();
  }

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
      const drawX = Math.round(o.x * CELL);
      const drawY = Math.round(o.y * CELL);
      ctx.drawImage(obstacleSprite, sx, sy, tileSize, tileSize, drawX, drawY, CELL, CELL);
    });
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    obstacles.forEach(o => {
      const drawX = Math.round(o.x * CELL);
      const drawY = Math.round(o.y * CELL);
      ctx.fillRect(drawX, drawY, CELL, CELL);
    });
  }

  drawSpriteEffects(ctx, time);

  ctx.restore();

  // HUD
  ctx.fillStyle = HUD_TEXT_COLOR;
  ctx.font = 'bold 20px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const wallStatus = wallsEnabled ? 'Walls' : 'No Walls';
  const wrapStatus = wrapEnabled ? 'Wrap' : 'No Wrap';
  const hudTextX = Math.round(offsetX + 16);
  const hudTextY = Math.round(offsetY + 28);
  ctx.fillText(`Score: ${score} (Best: ${bestScore}) • Speed T${speedTier} • ${wallStatus} • ${wrapStatus}`, hudTextX, hudTextY);

  if (wallsEnabled && score > 0 && score % 10 === 0 && obstacles.length < Math.floor(score / 10) * (N / 2)) addObstacleRow();

  if (paused) {
    if (!pauseOverlay) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = HUD_TEXT_COLOR;
      ctx.font = 'bold 32px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Paused — P to resume', c.width / 2, c.height / 2);
    }
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
    ctx.fillStyle = HUD_TEXT_COLOR;
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
    ctx.fillStyle = HUD_TEXT_COLOR;
    ctx.font = 'bold 42px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('You crashed! Press R', c.width / 2, c.height / 2);
  }

  updateDebugPanel();
  markFirstFrame();
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
    requestHudSync();
  }
  progress.best = Math.max(progress.best, s);
  saveProgress();
  populateSkinSelects();
  renderMissions();
  if (window.LB) {
    LB.submitScore(GAME_ID, s, DAILY_MODE ? DAILY_SEED : null);
    try { renderScores(); } catch { }
  }
  if (s >= 20) GG.addAch(GAME_ID, 'Fruit Feast');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && howToOverlay && howToOverlay.dataset.active === 'true') {
    e.preventDefault();
    closeHowTo('escape');
    return;
  }
  if (howToOverlay && howToOverlay.dataset.active === 'true') {
    return;
  }
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

window.addEventListener('blur', () => pauseGame('window-blur'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame('visibility');
});

engine = new GameEngine();
engine.update = dt => {
  if (dead || paused || won) return;
  updateSpeedBurst(performance.now());
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
  get turnBuffer() { return turnBuffer.map(entry => ({ ...entry.dir })); },
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
