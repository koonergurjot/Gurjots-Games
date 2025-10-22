const globalScope = typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : undefined);

const localQueue = [];

function ensureQueue() {
  if (!globalScope) return localQueue;
  const queue = globalScope.__GG_DIAG_QUEUE || (globalScope.__GG_DIAG_QUEUE = []);
  return queue;
}

function fallbackPushEvent(category, payload) {
  const queue = ensureQueue();
  const entry = Object.assign({
    category,
    timestamp: typeof payload?.timestamp === 'number' ? payload.timestamp : Date.now(),
  }, payload);
  if (typeof entry.level !== 'string') entry.level = 'info';
  if (typeof entry.message !== 'string') entry.message = entry.message ? String(entry.message) : '';
  queue.push(entry);
  if (queue.length > 2000) {
    queue.splice(0, queue.length - 2000);
  }
  return entry;
}

export function pushEvent(category, payload) {
  const normalizedCategory = typeof category === 'string' && category.trim()
    ? category.trim()
    : 'game';
  const data = payload && typeof payload === 'object' ? { ...payload } : {};
  if (!payload || typeof payload !== 'object') {
    if (payload !== undefined) data.message = String(payload);
  }
  data.category = normalizedCategory;
  if (typeof data.level !== 'string') data.level = 'info';
  if (typeof data.timestamp !== 'number') data.timestamp = Date.now();

  const dispatcher = globalScope && typeof globalScope.__GG_DIAG_PUSH_EVENT__ === 'function'
    ? globalScope.__GG_DIAG_PUSH_EVENT__
    : fallbackPushEvent;
  const result = dispatcher(normalizedCategory, data);
  return result || data;
}

export function isCaptureReady() {
  return !!(globalScope && globalScope.__DIAG_CAPTURE_READY);
}

export function send(type, payload) {
  if (!type || typeof type !== 'string') {
    return null;
  }

  const message = {
    type,
    ...(payload && typeof payload === 'object' ? payload : {}),
  };

  try {
    if (globalScope && globalScope.parent && typeof globalScope.parent.postMessage === 'function') {
      globalScope.parent.postMessage(message, '*');
    }
  } catch (_err) {
    /* ignore postMessage failures */
  }

  return message;
}
