import * as net from './net.js';
import { pushEvent } from '../common/diag-adapter.js';

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
  return [
    { id: 'coin-0', x: 250, y: groundY - 172, w: 18, h: 18, collected: false },
    { id: 'coin-1', x: 570, y: groundY - 232, w: 18, h: 18, collected: false },
    { id: 'coin-2', x: 640, y: groundY - 62, w: 18, h: 18, collected: false },
    { id: 'coin-3', x: 790, y: groundY - 122, w: 18, h: 18, collected: false }
  ];
}

function createGoal(groundY, width) {
  return { x: width - 90, y: groundY - 120, w: 50, h: 120 };
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

  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('over-title');
  const overlayInfo = document.getElementById('over-info');
  const restartBtn = document.getElementById('restartBtn');
  const shareBtn = document.getElementById('shareBtn');
  const startCoopBtn = document.getElementById('startCoop');
  const connStatus = document.getElementById('connStatus');
  const netHud = document.getElementById('netHud');
  const hud = document.querySelector('.hud');
  const defaultShareLabel = shareBtn?.textContent?.trim() ?? 'Share';
  const defaultCoopLabel = startCoopBtn?.textContent?.trim() ?? 'Start Co-op';

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
    coins: 0,
    lastSeen: 0,
    active: false,
    gameOver: false,
  };

  if (platformerApi) {
    platformerApi.localPlayer = localPlayer;
    platformerApi.coins = coins;
    platformerApi.goal = goal;
  }

  let paused = false;
  let pausedByShell = false;
  let gameOver = false;
  let finalTime = null;
  let rafId = 0;
  let lastFrame = performance.now();
  let sendTimer = 0;
  let runStart = performance.now();
  let shareResetTimer = 0;
  let coopRetryTimer = 0;

  const keys = new Set();

  function resetState() {
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
    gameOver = false;
    paused = false;
    finalTime = null;
    runStart = performance.now();
    keys.clear();
    hideOverlay();
    if (connStatus) connStatus.textContent = net.isConnected() ? connectionLabel() : 'Offline';
  }

  function showOverlay(title, info, { showShare = true } = {}) {
    if (!overlay) return;
    overlay.classList.add('show');
    if (overlayTitle) overlayTitle.textContent = title;
    if (overlayInfo) overlayInfo.textContent = info;
    if (shareBtn) shareBtn.style.display = showShare ? 'inline-block' : 'none';
  }

  function hideOverlay() {
    overlay?.classList.remove('show');
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
    gameOver = true;
    paused = true;
    finalTime = performance.now();
    showOverlay(title, info, { showShare: true });
    if (net.isConnected()) sendState();
    emitState('gameover', { title, info });
    emitScore('final', { title, info });
  }

  function togglePause(forceState) {
    if (gameOver) return;
    const next = typeof forceState === 'boolean' ? forceState : !paused;
    if (next === paused) return;
    paused = next;
    if (paused) {
      showOverlay('Paused', 'Press P to resume or R to restart.', { showShare: false });
    } else {
      hideOverlay();
    }
    if (net.isConnected()) sendState();
  }

  function restartGame() {
    resetState();
    if (net.isConnected()) {
      net.sendAssist();
      sendState();
    }
    emitState('restart', { reason: 'restart' });
    emitScore('reset', { reason: 'restart' });
  }

  if (platformerApi) {
    platformerApi.start = () => {
      if (!bootStarted) {
        boot();
        return;
      }
      if (gameOver) {
        restartGame();
      } else if (paused) {
        togglePause(false);
      }
    };
    platformerApi.pause = () => {
      if (!gameOver) togglePause(true);
    };
    platformerApi.resume = () => {
      if (!gameOver) togglePause(false);
    };
    platformerApi.restartGame = () => {
      restartGame();
    };
    platformerApi.localPlayer = localPlayer;
    platformerApi.coins = coins;
    platformerApi.goal = goal;
  }

  function shareRun() {
    if (!shareBtn) return;
    const coinsInfo = `${localPlayer.collected}/${coins.length}`;
    const seconds = secondsElapsed().toFixed(1);
    const result = gameOver && overlayTitle?.textContent?.includes('Clear') ? 'cleared the stage' : 'took a spill';
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
    remotePlayer.x = typeof data.x === 'number' ? data.x : remotePlayer.x;
    remotePlayer.y = typeof data.y === 'number' ? data.y : remotePlayer.y;
    remotePlayer.facing = data.facing === -1 ? -1 : 1;
    remotePlayer.onGround = !!data.onGround;
    remotePlayer.vx = data.vx || 0;
    remotePlayer.vy = data.vy || 0;
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
      restartGame();
    } else if (paused) {
      togglePause(false);
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

    if (key === 'p') {
      event.preventDefault();
      togglePause();
      return;
    }
    if (key === 'r') {
      event.preventDefault();
      restartGame();
      return;
    }

    keys.add(key);
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

  function drawScene() {
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

    ctx.fillStyle = '#223757';
    ctx.fillRect(0, groundY + 30, W, H - groundY - 30);

    ctx.fillStyle = '#385a88';
    for (const platform of platforms) {
      ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
    }

    ctx.fillStyle = '#ffe066';
    for (const coin of coins) {
      if (coin.collected) continue;
      const cx = coin.x + coin.w / 2;
      const cy = coin.y + coin.h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, coin.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d4a514';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = '#98c1ff';
    ctx.fillRect(goal.x, goal.y, goal.w, goal.h);
    ctx.fillStyle = '#0e1422';
    ctx.fillRect(goal.x + 8, goal.y + 12, goal.w - 16, goal.h - 20);

    if (remotePlayer.active && performance.now() - remotePlayer.lastSeen < 1200) {
      ctx.fillStyle = '#ff9f1c';
      ctx.fillRect(remotePlayer.x, remotePlayer.y, remotePlayer.w, remotePlayer.h);
      ctx.fillStyle = '#ffd37a';
      ctx.font = '12px system-ui';
      ctx.fillText('Partner', remotePlayer.x - 6, remotePlayer.y - 8);
    }

    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(localPlayer.x, localPlayer.y, localPlayer.w, localPlayer.h);

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

    drawScene();
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
  restartBtn?.addEventListener('click', restartGame);
  shareBtn?.addEventListener('click', shareRun);
  if (netHud) initNet();

  function pauseForShell() {
    if (gameOver) return;
    if (paused) { pausedByShell = false; return; }
    pausedByShell = true;
    togglePause(true);
  }

  function resumeFromShell() {
    if (!pausedByShell || document.hidden) return;
    pausedByShell = false;
    if (paused && !gameOver) togglePause(false);
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

  resetState();
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
