import { registerGameDiagnostics } from '../common/diagnostics/adapter.js';
import { pushEvent } from '/games/common/diag-adapter.js';

const globalScope = typeof window !== 'undefined' ? window : undefined;
const SLUG = 'asteroids';
const POLL_INTERVAL = 1000;
const attachedApis = new WeakSet();
let lastAttachedApi = null;
const adapterContexts = new WeakMap();

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

function setContext(api, context) {
  if (!api || !context || typeof context !== 'object') return;
  adapterContexts.set(api, context);
}

function triggerProbe(api, label, reason = 'state-change') {
  const context = adapterContexts.get(api);
  if (!context || typeof context.requestProbeRun !== 'function') return;
  const trimmedLabel = typeof label === 'string' && label.trim() ? label.trim() : 'State snapshot';
  const normalizedLabel = trimmedLabel.toLowerCase().startsWith('asteroids')
    ? trimmedLabel
    : `Asteroids: ${trimmedLabel}`;
  try {
    context.requestProbeRun(normalizedLabel, { reason });
  } catch (error) {
    pushEvent('diagnostics', {
      level: 'warn',
      message: `[${SLUG}] probe request failed`,
      details: {
        error: error?.message || String(error),
        label: normalizedLabel,
        reason,
      },
    });
  }
}

function logEvent(api, message, level = 'info') {
  pushEvent('diagnostics', {
    level,
    message: `[${SLUG}] ${message}`,
    details: { state: buildSnapshot(api) },
  });
}

function wrapAction(api, method, description) {
  const original = api[method];
  if (typeof original !== 'function') return;
  api[method] = (...args) => {
    try {
      const result = original(...args);
      logEvent(api, description);
      triggerProbe(api, description, `action:${method}`);
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
      triggerProbe(api, `${description} failed`, `action-error:${method}`);
      throw error;
    }
  };
}

function attach(api) {
  if (!api || typeof api !== 'object' || attachedApis.has(api)) return;
  attachedApis.add(api);
  lastAttachedApi = api;
  wrapAction(api, 'start', 'start invoked');
  wrapAction(api, 'pause', 'pause invoked');
  wrapAction(api, 'resume', 'resume invoked');
  wrapAction(api, 'restart', 'restart invoked');
  logEvent(api, 'diagnostics adapter attached');

  try {
    registerGameDiagnostics(SLUG, {
      hooks: {
        onReady(context) {
          setContext(api, context);
          logEvent(api, 'diagnostics adapter ready');
          triggerProbe(api, 'Initial snapshot', 'initial');
        },
        onStateChange(context) {
          setContext(api, context);
          triggerProbe(api, 'State change detected', 'summary-change');
        },
        onScoreChange(context) {
          setContext(api, context);
          triggerProbe(api, 'Score updated', 'score-change');
        },
        onError(context) {
          setContext(api, context);
          const error = context?.error;
          pushEvent('diagnostics', {
            level: 'error',
            message: `[${SLUG}] diagnostics summary error`,
            details: {
              error: error?.message || String(error),
              state: buildSnapshot(api),
            },
          });
          triggerProbe(api, 'Summary error detected', 'summary-error');
        },
      },
      api: {
        start() {
          return invoke(api, 'start');
        },
        pause() {
          return invoke(api, 'pause');
        },
        resume() {
          return invoke(api, 'resume');
        },
        reset() {
          return invoke(api, 'restart');
        },
        getScore() {
          return toNumber(invoke(api, 'getScore'));
        },
        async getEntities() {
          return buildSnapshot(api);
        },
      },
    });
  } catch (error) {
    pushEvent('diagnostics', {
      level: 'error',
      message: `[${SLUG}] failed to register diagnostics adapter`,
      details: {
        error: error?.message || String(error),
      },
    });
  }
}

function pollForApi() {
  if (!globalScope) return;
  const api = globalScope.Asteroids;
  if (api && typeof api === 'object' && typeof api.getShipState === 'function') {
    if (lastAttachedApi && lastAttachedApi !== api) {
      adapterContexts.delete(lastAttachedApi);
    }
    attach(api);
  } else if (!api && lastAttachedApi) {
    adapterContexts.delete(lastAttachedApi);
    lastAttachedApi = null;
  }
  if (typeof globalScope.setTimeout === 'function') {
    globalScope.setTimeout(pollForApi, POLL_INTERVAL);
  }
}

if (globalScope) {
  pollForApi();
}
