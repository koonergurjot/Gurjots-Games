import { registerGameDiagnostics } from '../common/diagnostics/adapter.js';
import { pushEvent } from '../common/diag-adapter.js';

const SLUG = 'maze3d';
const globalScope = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : undefined);

function vectorSnapshot(vector) {
  if (!vector) return null;
  const { x, y, z } = vector;
  return {
    x: Number.isFinite(x) ? Number(x.toFixed(3)) : null,
    y: Number.isFinite(y) ? Number(y.toFixed(3)) : null,
    z: Number.isFinite(z) ? Number(z.toFixed(3)) : null,
  };
}

function buildEntities(controller) {
  if (!controller) {
    return {
      state: 'unavailable',
      pointerLock: { locked: false },
      timers: {},
      player: null,
      opponent: null,
    };
  }
  try {
    const snapshot = controller.getDiagnosticsSnapshot?.();
    if (snapshot && typeof snapshot === 'object') {
      return snapshot;
    }
  } catch (err) {
    pushEvent('game', {
      level: 'error',
      message: `[${SLUG}] diagnostics snapshot failed`,
      details: { error: err?.message || String(err) },
    });
  }
  const doc = globalScope?.document;
  const timeText = doc?.getElementById('time')?.textContent || '';
  const oppText = doc?.getElementById('oppTime')?.textContent || '';
  const elapsed = Number.isFinite(parseFloat(timeText)) ? parseFloat(timeText) : null;
  const opponentElapsed = Number.isFinite(parseFloat(oppText)) ? parseFloat(oppText) : null;
  return {
    state: 'unknown',
    pointerLock: {
      locked: !!doc?.pointerLockElement,
    },
    timers: {
      elapsedSeconds: elapsed,
      opponentSeconds: opponentElapsed,
    },
    player: vectorSnapshot(controller.player?.position ?? null),
    opponent: vectorSnapshot(controller.opponent?.mesh?.position ?? null),
  };
}

function safeSubscribe(subscribeFn, handler) {
  if (typeof subscribeFn !== 'function' || typeof handler !== 'function') {
    return null;
  }
  try {
    const unsubscribe = subscribeFn(handler);
    return typeof unsubscribe === 'function' ? unsubscribe : null;
  } catch (err) {
    pushEvent('game', {
      level: 'warn',
      message: `[${SLUG}] diagnostics subscription failed`,
      details: { error: err?.message || String(err) },
    });
    return null;
  }
}

function registerAdapter() {
  if (!globalScope) return;
  const controller = globalScope.Maze3D;
  if (!controller) {
    pushEvent('game', {
      level: 'error',
      message: `[${SLUG}] diagnostics adapter failed: Maze3D controller unavailable`,
    });
    return;
  }

  const teardown = [];

  const stateUnsub = safeSubscribe(controller.onDiagnosticsStateChange, (state, meta) => {
    if (meta?.replay) return;
    pushEvent('game', {
      message: `[${SLUG}] state changed to ${state}`,
      details: { state, meta },
    });
  });
  if (stateUnsub) teardown.push(stateUnsub);

  const pointerUnsub = safeSubscribe(controller.onDiagnosticsPointerLockChange, (locked, meta) => {
    if (meta?.replay) return;
    pushEvent('input', {
      type: 'pointer-lock',
      locked: !!locked,
      message: `[${SLUG}] pointer lock ${locked ? 'engaged' : 'released'}`,
      details: { locked: !!locked, meta },
    });
  });
  if (pointerUnsub) teardown.push(pointerUnsub);

  let lastNetworkEvent = 0;
  const networkUnsub = safeSubscribe(controller.onDiagnosticsNetworkLatency, (latency, meta) => {
    if (meta?.replay || latency == null || !Number.isFinite(latency)) return;
    const now = Date.now();
    if (now - lastNetworkEvent < 150) return;
    lastNetworkEvent = now;
    pushEvent('network', {
      type: 'latency',
      latency,
      message: `[${SLUG}] broadcast latency ${latency.toFixed(1)}ms`,
      details: { latency, meta },
    });
  });
  if (networkUnsub) teardown.push(networkUnsub);

  registerGameDiagnostics(SLUG, {
    hooks: {
      onReady(context) {
        if (typeof context?.requestProbeRun === 'function') {
          try {
            context.requestProbeRun('Initial Maze3D snapshot');
          } catch (err) {
            pushEvent('game', {
              level: 'warn',
              message: `[${SLUG}] initial probe request failed`,
              details: { error: err?.message || String(err) },
            });
          }
        }
      },
    },
    api: {
      start: () => controller.start?.(),
      pause: () => controller.pause?.(),
      resume: () => controller.resume?.(),
      reset: () => controller.restart?.(),
      getEntities: () => buildEntities(controller),
    },
  });

  if (typeof globalScope.addEventListener === 'function' && teardown.length) {
    globalScope.addEventListener(
      'beforeunload',
      () => {
        teardown.splice(0).forEach((fn) => {
          try { fn(); } catch (err) {
            console.warn('maze3d: diagnostics teardown failed', err);
          }
        });
      },
      { once: true },
    );
  }
}

if (globalScope && !globalScope.__MAZE3D_DIAGNOSTICS_READY__) {
  globalScope.__MAZE3D_DIAGNOSTICS_READY__ = true;
  registerAdapter();
}
