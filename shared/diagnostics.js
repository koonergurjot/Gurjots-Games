import { pushEvent, isCaptureReady } from '../games/common/diag-adapter.js';

const globalScope = typeof window !== 'undefined' ? window : undefined;
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

let loaderPromise = null;

function ensureLegacyDiagnostics() {
  if (!globalScope) return Promise.resolve();
  if (globalScope.__GG_DIAG && isCaptureReady()) {
    return Promise.resolve();
  }
  if (loaderPromise) return loaderPromise;
  const coreUrl = new URL('../games/common/diag-core.js', import.meta.url).href;
  const captureUrl = new URL('../games/common/diag-capture.js', import.meta.url).href;
  loaderPromise = loadScript(coreUrl)
    .then(() => loadScript(captureUrl))
    .then(() => {
      pushEvent('diagnostics', {
        level: 'info',
        message: `[${slug}] legacy diagnostics assets loaded`,
      });
    })
    .catch((error) => {
      pushEvent('diagnostics', {
        level: 'error',
        message: `[${slug}] failed to load diagnostics assets`,
        details: error,
      });
      throw error;
    });
  return loaderPromise;
}

function ensureInterface() {
  if (!globalScope) return null;
  const existing = globalScope.__diagnostics;
  if (existing && existing.__shimmed) return existing;
  const api = {
    __shimmed: true,
    slug,
    log(entry) {
      if (!entry) return;
      const payload = {
        level: entry.level || 'info',
        message: entry.message || '',
      };
      if (entry.details !== undefined) payload.details = entry.details;
      if (typeof entry.timestamp === 'number') payload.timestamp = entry.timestamp;
      pushEvent(entry.category || 'diagnostics', payload);
    },
    flush() {
      return isCaptureReady();
    },
    open() {
      globalScope.__GG_DIAG?.open?.();
    },
    getQueue() {
      const queue = globalScope.__GG_DIAG_QUEUE;
      return Array.isArray(queue) ? queue.slice() : [];
    },
    exportLogs(format = 'json') {
      if (!globalScope.__GG_DIAG) return null;
      if (format === 'text' && typeof globalScope.__GG_DIAG.exportText === 'function') {
        return globalScope.__GG_DIAG.exportText();
      }
      if (typeof globalScope.__GG_DIAG.exportJSON === 'function') {
        return globalScope.__GG_DIAG.exportJSON();
      }
      return null;
    },
    getBootStatus() {
      return summarizeBoot(slug);
    },
  };
  globalScope.__diagnostics = api;
  return api;
}

async function init() {
  if (!globalScope || typeof document === 'undefined') return;
  ensureInterface();
  pushEvent('diagnostics', {
    level: 'warn',
    message: `[${slug}] shared/diagnostics.js is deprecated; migrate to games/common/diag-adapter.js`,
  });
  try {
    await ensureLegacyDiagnostics();
    pushEvent('diagnostics', {
      level: 'info',
      message: `[${slug}] diagnostics ready`,
      details: {
        boot: summarizeBoot(slug),
        captureReady: isCaptureReady(),
      },
    });
  } catch (error) {
    pushEvent('diagnostics', {
      level: 'error',
      message: `[${slug}] diagnostics setup failed`,
      details: error,
    });
  }
}

init();
