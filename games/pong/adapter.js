import { registerGameDiagnostics } from '../common/diagnostics/adapter.js';

const SLUG = 'pong';

const globalScope = typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : undefined);

const DEFAULT_SCORE = Object.freeze({
  status: 'unknown',
  p1: 0,
  p2: 0,
  mode: '',
  ai: '',
  target: 0,
  winByTwo: false,
});

const DEFAULT_LIFECYCLE = Object.freeze({
  status: 'unknown',
  running: false,
  paused: false,
  over: false,
  shellPaused: false,
});

function ensureQueue() {
  if (!globalScope) return [];
  if (Array.isArray(globalScope.__PONG_READY__)) return globalScope.__PONG_READY__;
  const queue = [];
  globalScope.__PONG_READY__ = queue;
  return queue;
}

function whenPongReady(callback) {
  if (!globalScope || typeof callback !== 'function') return;
  const controller = globalScope.Pong;
  if (controller && typeof controller === 'object') {
    callback(controller);
    return;
  }
  ensureQueue().push(callback);
}

function statusFromLifecycle(snapshot) {
  if (!snapshot) return 'unknown';
  if (snapshot.over) return 'game-over';
  if (snapshot.paused) return 'paused';
  if (snapshot.running) return 'running';
  return 'idle';
}

function safeCall(fn, context) {
  if (typeof fn !== 'function') return null;
  try {
    return fn.call(context);
  } catch (err) {
    console.warn('[pong] diagnostics call failed', err);
    return null;
  }
}

function snapshotLifecycle(pong) {
  const fallbackSource = pong?.state || null;
  const base = {
    running: !!fallbackSource?.running,
    paused: !!fallbackSource?.paused,
    over: !!fallbackSource?.over,
    shellPaused: !!fallbackSource?.shellPaused,
  };
  const provided = pong ? safeCall(pong.getLifecycleSnapshot, pong) : null;
  const merged = provided && typeof provided === 'object'
    ? { ...base, ...provided }
    : base;
  return {
    ...DEFAULT_LIFECYCLE,
    ...merged,
    status: statusFromLifecycle(merged),
  };
}

function snapshotScore(pong) {
  const lifecycle = snapshotLifecycle(pong);
  const fallbackSource = pong?.state || {};
  const score = fallbackSource.score || {};
  const base = {
    status: lifecycle.status,
    p1: Number(score.p1) || 0,
    p2: Number(score.p2) || 0,
    mode: typeof fallbackSource.mode === 'string' ? fallbackSource.mode : '',
    ai: typeof fallbackSource.ai === 'string' ? fallbackSource.ai : '',
    target: Number(fallbackSource.toScore) || 0,
    winByTwo: !!fallbackSource.winByTwo,
  };
  const provided = pong ? safeCall(pong.getScoreSnapshot, pong) : null;
  const merged = provided && typeof provided === 'object'
    ? { ...base, ...provided, status: provided.status || lifecycle.status }
    : base;
  if (!merged.status) merged.status = lifecycle.status;
  return { ...DEFAULT_SCORE, ...merged };
}

function snapshotEntities(pong) {
  const score = snapshotScore(pong);
  const lifecycle = snapshotLifecycle(pong);
  const provided = pong ? safeCall(pong.getEntitySnapshot, pong) : null;
  if (provided && typeof provided === 'object') {
    const paddles = Array.isArray(provided.paddles) ? provided.paddles : [];
    const balls = Array.isArray(provided.balls) ? provided.balls : [];
    const powerups = Array.isArray(provided.powerups) ? provided.powerups : [];
    const mergedScore = provided.score && typeof provided.score === 'object'
      ? { ...score, ...provided.score }
      : score;
    const mergedLifecycle = provided.lifecycle && typeof provided.lifecycle === 'object'
      ? { ...lifecycle, ...provided.lifecycle }
      : lifecycle;
    return {
      score: mergedScore,
      lifecycle: mergedLifecycle,
      paddles,
      balls,
      powerups,
    };
  }

  const state = pong?.state || {};
  const paddles = [];
  if (state.p1) {
    paddles.push({
      id: 'p1',
      x: Number(state.p1.x) || 0,
      y: Number(state.p1.y) || 0,
      w: Number(state.p1.w) || 0,
      h: Number(state.p1.h) || 0,
      dy: Number(state.p1.dy) || 0,
      speed: Number(state.p1.speed) || 0,
    });
  }
  if (state.p2) {
    paddles.push({
      id: 'p2',
      x: Number(state.p2.x) || 0,
      y: Number(state.p2.y) || 0,
      w: Number(state.p2.w) || 0,
      h: Number(state.p2.h) || 0,
      dy: Number(state.p2.dy) || 0,
      speed: Number(state.p2.speed) || 0,
    });
  }
  const balls = Array.isArray(state.balls)
    ? state.balls.map((ball, index) => ({
        id: index,
        x: Number(ball.x) || 0,
        y: Number(ball.y) || 0,
        dx: Number(ball.dx) || 0,
        dy: Number(ball.dy) || 0,
        r: Number(ball.r) || 0,
        spin: Number(ball.spin) || 0,
        lastHit: typeof ball.lastHit === 'string' ? ball.lastHit : null,
      }))
    : [];

  const powerups = Array.isArray(state.powerups)
    ? state.powerups.map((pu, index) => ({
        id: typeof pu.id === 'number' ? pu.id : index,
        kind: typeof pu.kind === 'string' ? pu.kind : 'unknown',
        x: Number(pu.x) || 0,
        y: Number(pu.y) || 0,
        r: Number(pu.r) || 0,
        life: Number(pu.life) || 0,
      }))
    : [];

  return {
    score,
    lifecycle,
    paddles,
    balls,
    powerups,
  };
}

function invokeControl(pong, name, ...args) {
  if (!pong) return undefined;
  const direct = typeof pong[name] === 'function' ? pong[name] : null;
  const controls = pong.controls && typeof pong.controls === 'object' ? pong.controls : null;
  const viaControls = controls && typeof controls[name] === 'function' ? controls[name] : null;
  const target = direct || viaControls;
  if (!target) return undefined;
  try {
    return target.apply(pong, args);
  } catch (err) {
    console.warn(`[pong] diagnostics control "${name}" failed`, err);
    return undefined;
  }
}

whenPongReady((pong) => {
  try {
    registerGameDiagnostics(SLUG, {
      hooks: {
        onReady(context) {
          if (typeof context?.requestProbeRun === 'function') {
            context.requestProbeRun('Initial Pong snapshot');
          }
        },
      },
      api: {
        start() {
          return invokeControl(pong, 'start');
        },
        pause() {
          return invokeControl(pong, 'pause');
        },
        resume() {
          return invokeControl(pong, 'resume');
        },
        reset() {
          return invokeControl(pong, 'reset');
        },
        getScore() {
          return snapshotScore(pong);
        },
        getEntities() {
          return snapshotEntities(pong);
        },
      },
    });
  } catch (err) {
    console.error('[pong] failed to register diagnostics adapter', err);
  }
});
