import { pushEvent } from '../common/diag-adapter.js';

const globalScope = typeof window !== 'undefined' ? window : undefined;
const SLUG = 'asteroids';
const SNAPSHOT_INTERVAL = 5000;
const POLL_INTERVAL = 1000;
const attachedApis = new WeakSet();
let snapshotTimer = 0;
let lastAttachedApi = null;

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizeShip(ship) {
  if (!ship || typeof ship !== 'object') {
    return {
      alive: false,
      x: null,
      y: null,
      vx: null,
      vy: null,
      angle: null,
      invulnerable: null,
      radius: null,
      lives: null,
    };
  }
  return {
    alive: !!ship.alive,
    x: toNumber(ship.x),
    y: toNumber(ship.y),
    vx: toNumber(ship.vx),
    vy: toNumber(ship.vy),
    angle: toNumber(ship.angle),
    invulnerable: toNumber(ship.invulnerable),
    radius: toNumber(ship.radius),
    lives: toNumber(ship.lives),
  };
}

function sanitizeRocks(rocks) {
  if (!Array.isArray(rocks)) return [];
  return rocks.slice(0, 12).map((rock) => ({
    x: toNumber(rock.x),
    y: toNumber(rock.y),
    vx: toNumber(rock.vx),
    vy: toNumber(rock.vy),
    radius: toNumber(rock.radius),
    size: toNumber(rock.size),
    spin: toNumber(rock.spin),
  }));
}

function invoke(api, method) {
  if (!api || typeof api[method] !== 'function') return null;
  try {
    return api[method]();
  } catch (_) {
    return null;
  }
}

function buildSnapshot(api) {
  const score = invoke(api, 'getScore');
  const bestScore = invoke(api, 'getBestScore');
  const ship = sanitizeShip(invoke(api, 'getShipState'));
  const rocks = sanitizeRocks(invoke(api, 'getRockState'));
  const paused = invoke(api, 'isPaused');
  const gameOver = invoke(api, 'isGameOver');
  const wave = invoke(api, 'getWave');

  return {
    score: toNumber(score),
    bestScore: toNumber(bestScore),
    wave: toNumber(wave),
    paused: typeof paused === 'boolean' ? paused : null,
    gameOver: typeof gameOver === 'boolean' ? gameOver : null,
    ship,
    rockCount: rocks.length,
    rocks,
  };
}

function logEvent(api, message, level = 'info') {
  pushEvent('diagnostics', {
    level,
    message: `[${SLUG}] ${message}`,
    details: { state: buildSnapshot(api) },
  });
}

function clearSnapshotTimer() {
  if (snapshotTimer && globalScope && typeof globalScope.clearInterval === 'function') {
    globalScope.clearInterval(snapshotTimer);
  }
  snapshotTimer = 0;
}

function wrapAction(api, method, description) {
  const original = api[method];
  if (typeof original !== 'function') return;
  api[method] = (...args) => {
    try {
      const result = original(...args);
      logEvent(api, description);
      return result;
    } catch (error) {
      pushEvent('diagnostics', {
        level: 'error',
        message: `[${SLUG}] ${description} failed`,
        details: {
          error: error?.message || String(error),
          state: buildSnapshot(api),
        },
      });
      throw error;
    }
  };
}

function attach(api) {
  if (!api || typeof api !== 'object' || attachedApis.has(api)) return;
  attachedApis.add(api);
  if (lastAttachedApi && lastAttachedApi !== api) {
    clearSnapshotTimer();
  }
  lastAttachedApi = api;
  wrapAction(api, 'start', 'start invoked');
  wrapAction(api, 'pause', 'pause invoked');
  wrapAction(api, 'resume', 'resume invoked');
  wrapAction(api, 'restart', 'restart invoked');
  logEvent(api, 'diagnostics adapter attached');

  if (globalScope && typeof globalScope.setInterval === 'function') {
    clearSnapshotTimer();
    snapshotTimer = globalScope.setInterval(
      () => logEvent(api, 'state snapshot', 'debug'),
      SNAPSHOT_INTERVAL
    );
    if (typeof globalScope.addEventListener === 'function') {
      globalScope.addEventListener(
        'beforeunload',
        () => {
          clearSnapshotTimer();
        },
        { once: true }
      );
    }
  }
}

function pollForApi() {
  if (!globalScope) return;
  const api = globalScope.Asteroids;
  if (api && typeof api === 'object' && typeof api.getShipState === 'function') {
    attach(api);
  } else if (!api && lastAttachedApi) {
    lastAttachedApi = null;
    clearSnapshotTimer();
  }
  if (typeof globalScope.setTimeout === 'function') {
    globalScope.setTimeout(pollForApi, POLL_INTERVAL);
  }
}

if (globalScope) {
  pollForApi();
}
