const globalScope = typeof window !== 'undefined' ? window : undefined;
const diagnosticsQueue = globalScope
  ? (globalScope.__diagnosticsQueue = globalScope.__diagnosticsQueue || [])
  : [];

const slug = detectSlug();

function detectSlug() {
  if (!globalScope || !globalScope.location) return 'unknown';
  try {
    let dataSlug = null;
    if (typeof document !== 'undefined') {
      const current = document.currentScript;
      dataSlug = current?.dataset?.game || findScript()?.dataset?.game || null;
    }
    if (dataSlug) return dataSlug;
  } catch (_) {
    /* ignore */
  }
  try {
    const segments = new URL(globalScope.location.href).pathname.split('/').filter(Boolean);
    if (segments[segments.length - 1] === 'index.html') segments.pop();
    return segments[segments.length - 1] || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function findScript() {
  if (typeof document === 'undefined') return null;
  const scripts = Array.from(document.querySelectorAll('script[type="module"]'));
  return scripts.find((script) => (script.src || '').includes('/shared/diagnostics.js')) || null;
}

function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[Function${value.name ? ` ${value.name}` : ''}]`;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof DOMRect !== 'undefined' && value instanceof DOMRect) {
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  }
  if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) {
    const tag = value.tagName?.toLowerCase() || 'element';
    const id = value.id ? `#${value.id}` : '';
    const cls = value.className ? `.${String(value.className).replace(/\s+/g, '.')}` : '';
    return `<${tag}${id}${cls}>`;
  }
  if (depth >= 3) return '[Truncated]';
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, 25).map((item) => sanitize(item, depth + 1, seen));
    }
    const output = {};
    const entries = Object.entries(value).slice(0, 50);
    for (const [key, val] of entries) {
      output[key] = sanitize(val, depth + 1, seen);
    }
    return output;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return String(value);
  }
}

function ensureInterface() {
  if (!globalScope) return null;
  const queue = diagnosticsQueue;
  const existing = globalScope.__diagnostics || {};
  function log(entry) {
    if (!entry) return;
    const normalized = {
      category: entry.category || 'general',
      level: entry.level || 'info',
      message: entry.message || '',
      details: entry.details ?? null,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
    };
    if (globalScope.__GG_DIAG && typeof globalScope.__GG_DIAG.log === 'function') {
      try {
        globalScope.__GG_DIAG.log(normalized);
      } catch (error) {
        queue.push({
          category: 'diagnostics',
          level: 'error',
          message: '[diagnostics] forward failed',
          details: sanitize(error),
          timestamp: Date.now(),
        });
      }
      return;
    }
    queue.push(normalized);
    if (queue.length > 1200) {
      queue.splice(0, queue.length - 1200);
    }
  }

  function flush() {
    if (!globalScope.__GG_DIAG || typeof globalScope.__GG_DIAG.log !== 'function') {
      return false;
    }
    while (queue.length) {
      const entry = queue.shift();
      try {
        globalScope.__GG_DIAG.log(entry);
      } catch (error) {
        queue.unshift(entry);
        queue.push({
          category: 'diagnostics',
          level: 'error',
          message: '[diagnostics] flush failed',
          details: sanitize(error),
          timestamp: Date.now(),
        });
        return false;
      }
    }
    return true;
  }

  function getBootStatus() {
    if (!globalScope.__bootStatus) return {};
    return sanitize(globalScope.__bootStatus);
  }

  function exportLogs(format = 'json') {
    if (!globalScope.__GG_DIAG) return null;
    if (format === 'text' && typeof globalScope.__GG_DIAG.exportText === 'function') {
      return globalScope.__GG_DIAG.exportText();
    }
    if (typeof globalScope.__GG_DIAG.exportJSON === 'function') {
      return globalScope.__GG_DIAG.exportJSON();
    }
    return null;
  }

  function getQueueSnapshot() {
    return queue.slice();
  }

  function open() {
    globalScope.__GG_DIAG?.open?.();
  }

  const api = Object.assign(existing, {
    log,
    flush,
    open,
    getQueue: getQueueSnapshot,
    exportLogs,
    getBootStatus,
    slug,
  });

  globalScope.__diagnostics = api;
  return api;
}

function summarizeBoot(slugValue) {
  if (!globalScope?.__bootStatus) return null;
  const entry = globalScope.__bootStatus[slugValue];
  if (!entry) return null;
  return {
    readyState: entry.readyState,
    bootAttempts: entry.bootAttempts,
    bootSuccesses: entry.bootSuccesses,
    lastMilestones: Array.isArray(entry.milestones) ? entry.milestones.slice(-5) : [],
    canvasWarnings: Array.isArray(entry.canvasWarnings) ? entry.canvasWarnings.length : 0,
  };
}

let loaderPromise = null;

function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('document unavailable'));
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = false;
    script.addEventListener('load', () => resolve(url));
    script.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)));
    document.head.appendChild(script);
  });
}

function ensureLegacyDiagnostics() {
  if (!globalScope) return Promise.resolve();
  if (globalScope.__GG_DIAG && globalScope.__DIAG_CAPTURE_READY) {
    return Promise.resolve();
  }
  if (loaderPromise) return loaderPromise;
  const coreUrl = new URL('../games/common/diag-core.js', import.meta.url).href;
  const captureUrl = new URL('../games/common/diag-capture.js', import.meta.url).href;
  loaderPromise = loadScript(coreUrl)
    .then(() => loadScript(captureUrl))
    .then(() => {
      globalScope.__DIAG_CAPTURE_READY = true;
    })
    .catch((error) => {
      diagnosticsQueue.push({
        category: 'diagnostics',
        level: 'error',
        message: '[diagnostics] asset load failed',
        details: sanitize(error),
        timestamp: Date.now(),
      });
      throw error;
    });
  return loaderPromise;
}

async function init() {
  if (!globalScope || typeof document === 'undefined') return;
  const api = ensureInterface();
  api?.log({
    category: 'diagnostics',
    level: 'info',
    message: `[${slug}] diagnostics initializing`,
    details: { readyState: document.readyState },
  });
  try {
    await ensureLegacyDiagnostics();
    api?.flush();
    api?.log({
      category: 'diagnostics',
      level: 'info',
      message: `[${slug}] diagnostics ready`,
      details: { boot: summarizeBoot(slug), queueLength: diagnosticsQueue.length },
    });
  } catch (error) {
    api?.log({
      category: 'diagnostics',
      level: 'error',
      message: `[${slug}] diagnostics failed`,
      details: sanitize(error),
    });
  }
}

init();
