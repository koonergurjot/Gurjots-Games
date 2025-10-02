import { pushEvent } from '../common/diag-adapter.js';

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

if (globalScope?.__g2048) {
  installAdapter(globalScope.__g2048);
}
