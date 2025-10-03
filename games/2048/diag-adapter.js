import { pushEvent } from '/games/common/diag-adapter.js';
import { registerGameDiagnostics } from '../common/diagnostics/adapter.js';

const globalScope = typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : undefined);

const GAME_ID = '2048';
const READY_CURSOR_KEY = '__diagCursor2048_ready';
const READY_WRAP_KEY = '__diagWrapped2048_ready';
const SCORE_CURSOR_KEY = '__diagCursor2048_score';
const SCORE_WRAP_KEY = '__diagWrapped2048_score';

function cloneGrid(grid) {
  if (!Array.isArray(grid)) return [];
  return grid.map((row) => Array.isArray(row) ? row.slice() : []);
}

function buildDetails(handle, event = {}) {
  const baseGrid = Array.isArray(event.grid) ? event.grid : handle?.grid;
  const size = typeof event.size === 'number'
    ? event.size
    : (Array.isArray(baseGrid) ? baseGrid.length : null);
  const delta = typeof event.delta === 'number' ? event.delta : null;
  const streak = typeof event.streak === 'number' ? event.streak : null;
  const gained = typeof event.gained === 'number' ? event.gained : null;
  return {
    type: typeof event.type === 'string' && event.type ? event.type : null,
    reason: typeof event.reason === 'string' && event.reason ? event.reason : null,
    timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
    score: typeof event.score === 'number'
      ? event.score
      : (typeof handle?.score === 'number' ? handle.score : 0),
    best: typeof event.best === 'number' ? event.best : null,
    undoLeft: typeof event.undoLeft === 'number' ? event.undoLeft : null,
    over: typeof event.over === 'boolean' ? event.over : null,
    won: typeof event.won === 'boolean' ? event.won : null,
    size,
    delta,
    streak,
    gained,
    grid: cloneGrid(baseGrid),
  };
}

function publishReady(handle, event) {
  const details = buildDetails(handle, event);
  pushEvent('game', {
    level: 'info',
    message: `[${GAME_ID}] ready`,
    details: { ...details, type: 'ready' },
  });
}

function publishScore(handle, event) {
  const details = buildDetails(handle, event);
  const delta = details.delta;
  const level = typeof delta === 'number' && delta < 0 ? 'warn' : 'info';
  const deltaText = typeof delta === 'number' && delta !== 0
    ? (delta > 0 ? ` (+${delta})` : ` (${delta})`)
    : '';
  pushEvent('game', {
    level,
    message: `[${GAME_ID}] score ${details.score}${deltaText}`,
    details: { ...details, type: 'score' },
  });
}

function monitorQueue(handle, queue, cursorKey, wrapKey, handler) {
  if (!Array.isArray(queue) || typeof handler !== 'function') return;
  const processed = typeof queue[cursorKey] === 'number' ? queue[cursorKey] : 0;
  for (let i = processed; i < queue.length; i += 1) {
    try {
      handler(queue[i]);
    } catch (_) {
      // Swallow handler errors to avoid breaking the game loop.
    }
  }
  queue[cursorKey] = queue.length;
  if (queue[wrapKey]) return;
  const originalPush = queue.push.bind(queue);
  queue.push = (...items) => {
    const result = originalPush(...items);
    for (const item of items) {
      try {
        handler(item);
      } catch (_) {
        // Ignore handler errors for individual events.
      }
    }
    queue[cursorKey] = queue.length;
    return result;
  };
  Object.defineProperty(queue, wrapKey, {
    value: true,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

function installAdapter(handle) {
  if (!handle) return;
  if (Array.isArray(handle.readyEvents)) {
    monitorQueue(handle, handle.readyEvents, READY_CURSOR_KEY, READY_WRAP_KEY, (event) => {
      publishReady(handle, event);
    });
  }
  if (Array.isArray(handle.scoreEvents)) {
    monitorQueue(handle, handle.scoreEvents, SCORE_CURSOR_KEY, SCORE_WRAP_KEY, (event) => {
      publishScore(handle, event);
    });
  }
}

function attachQueueListener(listeners, queue, listener) {
  if (!listeners || typeof listeners.add !== 'function') return () => {};
  if (typeof listener !== 'function') return () => {};
  if (Array.isArray(queue)) {
    for (const event of queue) {
      try {
        listener(event);
      } catch (_) {
        /* ignore listener errors */
      }
    }
  }
  listeners.add(listener);
  return () => {
    try {
      listeners.delete(listener);
    } catch (_) {
      /* ignore unsubscription errors */
    }
  };
}

function registerDiagnostics(handle) {
  if (!handle) {
    pushEvent('game', {
      level: 'warn',
      message: `[${GAME_ID}] diagnostics registration skipped: handle unavailable`,
    });
    return;
  }
  try {
    registerGameDiagnostics('g2048', {
      hooks: {
        onReady(listener) {
          return attachQueueListener(handle.readyListeners, handle.readyEvents, listener);
        },
        onScoreChange(listener) {
          return attachQueueListener(handle.scoreListeners, handle.scoreEvents, listener);
        },
      },
      api: {
        start() {
          handle.gameLoop?.start?.();
        },
        pause() {
          handle.gameLoop?.stop?.();
        },
        resume() {
          handle.gameLoop?.start?.();
        },
        reset() {
          handle.reset?.(false, 'diagnostics');
        },
        getScore() {
          return {
            score: typeof handle.score === 'number' ? handle.score : 0,
            best: typeof handle.best === 'number' ? handle.best : null,
            undoLeft: typeof handle.undoLeft === 'number' ? handle.undoLeft : null,
            over: typeof handle.over === 'boolean' ? handle.over : null,
            won: typeof handle.won === 'boolean' ? handle.won : null,
            size: typeof handle.size === 'number' ? handle.size : null,
          };
        },
        getEntities() {
          const details = buildDetails(handle);
          return {
            grid: details.grid,
            state: {
              score: details.score,
              best: details.best,
              undoLeft: details.undoLeft,
              over: details.over,
              won: details.won,
              size: details.size,
            },
            readyEvents: Array.isArray(handle.readyEvents) ? handle.readyEvents.slice() : [],
            scoreEvents: Array.isArray(handle.scoreEvents) ? handle.scoreEvents.slice() : [],
          };
        },
      },
    });
    pushEvent('game', {
      level: 'info',
      message: `[${GAME_ID}] diagnostics adapter registered`,
    });
  } catch (error) {
    pushEvent('game', {
      level: 'error',
      message: `[${GAME_ID}] diagnostics registration failed`,
      details: {
        error: error?.message || String(error),
        stack: error?.stack || null,
      },
    });
  }
}

if (globalScope?.__g2048) {
  const handle = globalScope.__g2048;
  installAdapter(handle);
  registerDiagnostics(handle);
} else {
  pushEvent('game', {
    level: 'warn',
    message: `[${GAME_ID}] diagnostics handle unavailable`,
  });
}
