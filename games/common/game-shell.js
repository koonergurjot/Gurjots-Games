import { mountPause } from './pause.js';
import { installCanvasScaler, getHudSafeGutter } from './canvas.js';

const toAbsoluteUrl = (value) => {
  if (!value) return null;
  try {
    return new URL(value, window.location.href).href;
  } catch (_) {
    return null;
  }
};

const findOwningScript = () => {
  if (document.currentScript) return document.currentScript;

  const potentialOwners = Array.from(document.querySelectorAll('script[src]')).filter((script) => {
    const normalizedSrc = toAbsoluteUrl(script.src);
    return Boolean(normalizedSrc && /(?:^|\/)game-shell\.js(\?|$)/.test(normalizedSrc));
  });
  if (potentialOwners.length === 1) {
    return potentialOwners[0];
  }
  const dataMatched = potentialOwners.find((script) => script.dataset?.game || script.dataset?.slug);
  if (dataMatched) {
    return dataMatched;
  }

  const fallback =
    document.querySelector('script[src*="game-shell.js"][data-game]') ||
    document.querySelector('script[src*="game-shell.js"][data-slug]') ||
    document.querySelector('script[src*="game-shell.js"]');
  return fallback || null;
};

const current = findOwningScript();
if (!current) {
  console.warn('[game-shell] Unable to locate owning <script> element.');
}

const dataset = current?.dataset || {};
const applyTheme = dataset.applyTheme !== 'false';
const slug = dataset.game || dataset.slug || '';

installCanvasScaler();

if (typeof window !== 'undefined') {
  window.GGShellHud = Object.assign(window.GGShellHud || {}, {
    gutter: getHudSafeGutter(),
  });
}
const diagSrc = dataset.diagSrc || '/games/common/diag-autowire.js';
const backHref = dataset.backHref || '/index.html';
const preloadTargets = (dataset.preloadFirst || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const sendToParent = (type, detail) => {
  try {
    window.parent?.postMessage({ type, slug, ...(detail || {}) }, '*');
  } catch (_) {
    /* no-op */
  }
};

const emitGameEvent = (detail = {}) => {
  if (!detail || typeof detail !== 'object') return;
  const eventDetail = { ...detail };
  eventDetail.slug = typeof eventDetail.slug === 'string' && eventDetail.slug ? eventDetail.slug : slug;
  if (typeof eventDetail.eventType === 'string' && !eventDetail.type) {
    eventDetail.type = eventDetail.eventType;
  }
  if (!eventDetail.type || !eventDetail.slug) return;
  try {
    sendToParent('GAME_EVENT', { slug: eventDetail.slug, event: eventDetail });
  } catch (_) {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent('ggshell:game-event', { detail: eventDetail }));
  } catch (_) {
    /* ignore */
  }
};

if (typeof window !== 'undefined') {
  window.GGShellEmitEvent = function (type, detail = {}) {
    const payload = typeof detail === 'object' && detail ? { ...detail } : {};
    if (type && !payload.type) payload.type = type;
    emitGameEvent(payload);
  };
  window.GGShellEmitMissionEvent = window.GGShellEmitEvent;
}

const readyPromises = [];
const whenDomReady = (fn) => {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(fn, 0);
  } else {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  }
};

const ensureMissionsHost = () => {
  if (!slug || typeof document === 'undefined') return null;
  let host = document.querySelector('[data-gg-missions-hud]');
  if (!host) {
    host = document.createElement('section');
    host.className = 'game-shell__missions';
    host.dataset.ggMissionsHud = 'true';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('data-loading', 'true');
    const surface = document.querySelector('.game-shell__surface');
    const target = surface || document.body || document.documentElement;
    if (surface) {
      surface.prepend(host);
    } else if (target && typeof target.prepend === 'function') {
      target.prepend(host);
    }
  }
  return host;
};

const attemptMountMissions = () => {
  if (!slug || typeof window === 'undefined') return false;
  const api = window.Missions;
  if (!api || typeof api.mountHUD !== 'function') return false;
  const host = ensureMissionsHost();
  if (!host) return false;
  try {
    api.mountHUD({ slug, target: host });
    host.dataset.loading = 'false';
    host.dataset.ready = 'true';
    host.removeAttribute('hidden');
    return true;
  } catch (err) {
    console.warn('[game-shell] missions HUD mount failed', err);
    return false;
  }
};

const installMissions = () => {
  if (!slug || typeof window === 'undefined') return;
  const host = ensureMissionsHost();
  if (!host) return;
  const hydrate = () => attemptMountMissions();
  if (hydrate()) return;
  let attempts = 0;
  const tick = () => {
    attempts += 1;
    if (hydrate()) {
      window.clearInterval(intervalId);
      return;
    }
    if (attempts > 40) {
      window.clearInterval(intervalId);
      host.dataset.loading = 'false';
      host.dataset.ready = 'false';
      host.setAttribute('hidden', '');
    }
  };
  const intervalId = window.setInterval(tick, 500);
  const onMissionsReady = () => {
    if (hydrate()) {
      window.removeEventListener('missions:ready', onMissionsReady);
      window.removeEventListener('ggmissions:ready', onMissionsReady);
    }
  };
  window.addEventListener('missions:ready', onMissionsReady);
  window.addEventListener('ggmissions:ready', onMissionsReady);
  window.addEventListener('beforeunload', () => window.clearInterval(intervalId), { once: true });
};

if (applyTheme) {
  document.body.classList.add('game-shell');
}

document.body.dataset.gameSlug = slug;

if (!document.querySelector('.game-shell__back')) {
  const backHost = document.createElement('div');
  backHost.className = 'game-shell__back';
  const anchor = document.createElement('a');
  anchor.className = 'game-shell__back-link';
  const baseParts = window.location.pathname.split('/games/');
  const base = (baseParts[0] || '/').replace(/\/+$/, '/');
  const target = backHref || `${base}index.html`;
  anchor.href = target;
  anchor.setAttribute('data-shell-back-link', '');
  anchor.setAttribute('aria-label', 'Back to games hub');
  anchor.innerHTML = '<span aria-hidden="true">⟵</span><span>Back</span>';
  backHost.append(anchor);
  document.body.prepend(backHost);

  if (!document.getElementById('game-shell-announcer')) {
    const announcer = document.createElement('div');
    announcer.id = 'game-shell-announcer';
    announcer.className = 'game-shell__sr-only';
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    document.body.prepend(announcer);

    let lastScoreAnnouncement = null;
    let shellPaused = false;
    let pauseOverlay = null;

    const emitOverlayEvent = (type, detail) => {
      try {
        window.dispatchEvent(new CustomEvent(type, { detail }));
      } catch (_) {
        /* ignore */
      }
    };

    const normalizeOverlayDetail = (detail, fallbackSource) => {
      const normalized = detail && typeof detail === 'object' ? { ...detail } : {};
      if (!normalized.source && fallbackSource) normalized.source = fallbackSource;
      if (slug && !normalized.slug) normalized.slug = slug;
      return normalized;
    };

    const ensurePauseOverlay = () => {
      if (pauseOverlay) return pauseOverlay;
      if (!document.body) return null;
      const host = document.createElement('div');
      host.className = 'game-shell__pause';
      host.setAttribute('aria-hidden', 'true');
      document.body.appendChild(host);
      pauseOverlay = mountPause(host, {
        onPause(detail) {
          if (!shellPaused) {
            updateShellPauseState(true, normalizeOverlayDetail(detail, 'overlay'));
          }
        },
        onResume(detail) {
          if (shellPaused) {
            updateShellPauseState(false, normalizeOverlayDetail(detail, 'overlay'));
          }
        },
        onRestart(detail) {
          const payload = normalizeOverlayDetail(detail, 'overlay');
          emitOverlayEvent('ggshell:restart', payload);
          sendToParent('GAME_RESTART', payload);
        },
        onExit(detail) {
          const payload = normalizeOverlayDetail(detail, 'overlay');
          emitOverlayEvent('ggshell:exit', payload);
          sendToParent('GAME_EXIT', payload);
        },
      });
      return pauseOverlay;
    };
    const updateShellPauseState = (paused, detail) => {
      if (shellPaused === paused) return;
      shellPaused = paused;
      const overlayDetail = normalizeOverlayDetail(detail, 'shell');
      const overlay = ensurePauseOverlay();
      if (overlay) {
        if (paused) overlay.show(overlayDetail);
        else overlay.hide(overlayDetail);
      }
      const eventName = paused ? 'ggshell:pause' : 'ggshell:resume';
      try {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
      } catch (_) {
        // Swallow errors dispatching custom events to avoid breaking games.
      }
      sendToParent(paused ? 'GAME_PAUSE' : 'GAME_RESUME', { reason: detail?.source || 'unknown' });
    };
    const setAnnouncement = (message) => {
      if (!message) return;
      announcer.textContent = String(message);
    };
    const announceScore = (score) => {
      const numericScore = Number(score);
      if (Number.isNaN(numericScore)) return;
      if (numericScore === lastScoreAnnouncement) return;
      lastScoreAnnouncement = numericScore;
      setAnnouncement(`Score ${numericScore}`);
    };

    window.addEventListener('message', (event) => {
      const data = event && typeof event.data === 'object' ? event.data : null;
      if (!data || !data.type) return;
      if (data.type === 'GAME_PAUSE' || data.type === 'GG_PAUSE') {
        setAnnouncement('Game paused');
        updateShellPauseState(true, { source: 'message', payload: data });
      }
      if (data.type === 'GAME_RESUME' || data.type === 'GG_RESUME') {
        setAnnouncement('Game resumed');
        updateShellPauseState(false, { source: 'message', payload: data });
      }
      if (data.type === 'GAME_SCORE') {
        announceScore(data.score);
      }
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      setAnnouncement(document.hidden ? 'Game paused' : 'Game resumed');
      updateShellPauseState(document.hidden, { source: 'visibilitychange' });
    });

    window.addEventListener('ggshell:announce', (event) => {
      setAnnouncement(event?.detail);
    });

    window.addEventListener('ggshell:score', (event) => {
      announceScore(event?.detail);
    });

    window.GGShellAnnounce = setAnnouncement;
    window.GGShellAnnounceScore = announceScore;

    const initializePauseOverlay = () => {
      ensurePauseOverlay();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializePauseOverlay, { once: true });
    } else {
      initializePauseOverlay();
    }
  }
}

if (slug && !document.querySelector(`script[data-slug="${slug}"][data-shell-diag]`)) {
  const attach = () => {
    const diag = document.createElement('script');
    diag.src = diagSrc;
    diag.defer = true;
    diag.dataset.slug = slug;
    diag.dataset.shellDiag = 'true';
    diag.className = 'game-shell__diagnostics-anchor';
    document.head.append(diag);
  };
  if (document.readyState === 'complete') {
    setTimeout(attach, 0);
  } else {
    window.addEventListener('load', attach, { once: true });
  }
}

if (dataset.focusTarget) {
  const tryFocus = () => {
    const el = document.querySelector(dataset.focusTarget);
    if (el && typeof el.focus === 'function') {
      el.focus({ preventScroll: true });
    }
  };
  if (document.readyState === 'complete') {
    setTimeout(tryFocus, 0);
  } else {
    window.addEventListener('load', tryFocus, { once: true });
  }
}

const SCORE_SELECTORS = {
  pong: ['#score-p1'],
  breakout: ['#score'],
  snake: ['#score', '#scoreValue'],
  shooter: ['#score'],
  tetris: ['#score'],
  runner: ['#score'],
  g2048: ['#currentScore'],
};

const trackedScores = new WeakSet();
let lastEmittedScore = null;

const coerceScore = (value) => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const emitScore = (score) => {
  const numeric = coerceScore(score);
  if (numeric == null) return;
  if (numeric === lastEmittedScore) return;
  lastEmittedScore = numeric;
  sendToParent('GAME_SCORE', { score: numeric });
  try {
    window.dispatchEvent(new CustomEvent('ggshell:score', { detail: numeric }));
  } catch (_) {
    /* ignore */
  }
};

window.GGShellEmitScore = emitScore;

const observeScoreNode = (node) => {
  if (!node || trackedScores.has(node)) return;
  trackedScores.add(node);

  const readScore = () => {
    if (!document.contains(node)) return null;
    if (node.dataset && node.dataset.gameScore != null) {
      const direct = coerceScore(node.dataset.gameScore);
      if (direct != null) return direct;
    }
    if (node.value != null) return coerceScore(node.value);
    return coerceScore(node.textContent);
  };

  const notify = () => {
    const currentScore = readScore();
    if (currentScore != null) emitScore(currentScore);
  };

  notify();

  const observer = new MutationObserver(() => notify());
  observer.observe(node, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-game-score', 'aria-valuenow', 'value'],
  });

  const destroy = () => {
    observer.disconnect();
    node.removeEventListener('input', notify);
    node.removeEventListener('change', notify);
  };

  node.addEventListener('input', notify, { passive: true });
  node.addEventListener('change', notify, { passive: true });
  window.addEventListener('beforeunload', destroy, { once: true });
};

const ensureScoreObservers = () => {
  const selectorList = new Set([...(SCORE_SELECTORS[slug] || [])]);
  document.querySelectorAll('[data-game-score]').forEach((node) => {
    observeScoreNode(node);
  });
  selectorList.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      observeScoreNode(node);
    });
  });
};

const watchedCanvases = new WeakSet();

const fitCanvas = (canvas) => {
  if (!canvas || watchedCanvases.has(canvas)) return;
  watchedCanvases.add(canvas);
  const resize = () => {
    try {
      const globalFit = typeof window.fitCanvasToParent === 'function' ? window.fitCanvasToParent : null;
      const shellCanvas = window.GGShellCanvas || {};
      const preferred = typeof shellCanvas.fit === 'function'
        ? shellCanvas.fit
        : (typeof shellCanvas.scaleCanvas === 'function' ? shellCanvas.scaleCanvas : null);
      if (preferred && preferred !== globalFit) {
        preferred(canvas);
      }
      if (globalFit) {
        globalFit(canvas);
      }
    } catch (err) {
      console.warn('[game-shell] fitCanvasToParent failed', err);
    }
  };
  resize();
  window.addEventListener('resize', resize);
  canvas.addEventListener('ggshell:fit', resize);
};

const ensureCanvasFits = () => {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('canvas').forEach((canvas) => fitCanvas(canvas));
};

const installCanvasObserver = () => {
  if (typeof document === 'undefined' || !document.body) return;
  ensureCanvasFits();
  const observer = new MutationObserver(() => ensureCanvasFits());
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
};

const installControlsOverlay = () => {
  if (document.querySelector('[data-gg-controls-overlay]')) return;
  const host = document.querySelector('.game-shell__surface') || document.body;
  const overlay = document.createElement('aside');
  overlay.setAttribute('data-gg-controls-overlay', '');
  overlay.className = 'game-shell__controls';
  overlay.innerHTML = `
    <details class="game-shell__controls-details" open>
      <summary>Controls</summary>
      <ul class="game-shell__controls-list">
        <li>⬆️/⬇️/⬅️/➡️ — Move / Navigate</li>
        <li><kbd>Space</kbd> — Jump / Action</li>
        <li><kbd>P</kbd> — Pause / Resume</li>
        <li><kbd>R</kbd> — Restart</li>
      </ul>
    </details>
  `;
  host.appendChild(overlay);
};

const installVisibilityHelper = () => {
  if (window.GGShellVisibility) return;
  window.GGShellVisibility = {
    bind({ onPause, onResume } = {}) {
      const unbinders = [];
      if (typeof onPause === 'function') {
        const handler = (event) => onPause(event);
        window.addEventListener('ggshell:pause', handler);
        unbinders.push(['ggshell:pause', handler]);
      }
      if (typeof onResume === 'function') {
        const handler = (event) => onResume(event);
        window.addEventListener('ggshell:resume', handler);
        unbinders.push(['ggshell:resume', handler]);
      }
      return () => {
        unbinders.forEach(([type, handler]) => window.removeEventListener(type, handler));
      };
    },
  };
};

const resolveAssetUrl = (value) => {
  if (!value) return null;
  try {
    return new URL(value, current?.src || window.location.href).href;
  } catch (_) {
    return value;
  }
};

const preloadFirstFrameAssets = () => {
  const sources = new Set();
  preloadTargets.forEach((value) => {
    const url = resolveAssetUrl(value);
    if (url) sources.add(url);
  });
  document.querySelectorAll('[data-preload-first]').forEach((el) => {
    const attr = el.getAttribute('data-preload-first');
    const url = resolveAssetUrl(attr);
    if (url) sources.add(url);
  });
  if (!sources.size) return;
  const tasks = Array.from(sources).map((src) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ src, status: 'loaded' });
      img.onerror = () => {
        sendToParent('GAME_ERROR', { error: `Failed to preload ${src}` });
        resolve({ src, status: 'error' });
      };
      img.src = src;
    });
  });
  const combined = Promise.allSettled(tasks);
  readyPromises.push(combined);
};

if (typeof document !== 'undefined') {
  installCanvasObserver();
  whenDomReady(() => {
    installControlsOverlay();
    ensureScoreObservers();
    installVisibilityHelper();
    installMissions();
    preloadFirstFrameAssets();
  });
}

window.GGShellReady = {
  wait: () => Promise.allSettled(readyPromises),
};
