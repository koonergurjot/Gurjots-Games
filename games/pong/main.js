const SLUG = 'pong';
const DEFAULT_CONFIG = {
  targetScore: 11,
  winByTwo: false,
};

const isTestEnv = Boolean(
  (typeof globalThis !== 'undefined' &&
    (globalThis.__vitest_worker__ || globalThis.__VITEST__ || globalThis.__vitest_browser__)) ||
  (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || ''))
);

let realGameLoadPromise = null;
let appliedLayoutPatch = false;

function injectLayoutPatch() {
  if (appliedLayoutPatch) return;
  const style = document.createElement('style');
  style.dataset.pongCenter = '1';
  style.textContent = `
    /* Center the stage when running inside the shell */
    #stage.stage {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 100%;
      height: 100%;
    }
    #stage.stage > #gameCanvas {
      display: none !important;
    }
    #stage.stage > #game-root {
      display: flex;
      width: 100%;
      height: 100%;
      align-items: center;
      justify-content: center;
    }
    .pong-canvas-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
    }
  `;
  document.head.appendChild(style);
  appliedLayoutPatch = true;
}

function ensureRoot() {
  let root = document.getElementById('game-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'game-root';
    document.body.appendChild(root);
  }
  return root;
}

function ensureRealGameShell() {
  injectLayoutPatch();
  const root = ensureRoot();

  if (!document.body.classList.contains('pong-root')) {
    document.body.classList.add('pong-root');
  }

  if (!document.getElementById('app')) {
    const app = document.createElement('div');
    app.id = 'app';
    app.className = 'pong-app';
    root.appendChild(app);
  }

  if (!document.querySelector('link[data-pong-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./pong.css', import.meta.url).href;
    link.dataset.pongCss = '1';
    document.head.appendChild(link);
  }

  return root;
}

function loadRealGameScript() {
  if (realGameLoadPromise) {
    return realGameLoadPromise;
  }
  realGameLoadPromise = new Promise((resolve, reject) => {
    if (document.querySelector('script[data-pong-main="1"]')) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = new URL('./pong.js', import.meta.url).href;
    script.defer = true;
    script.dataset.pongMain = '1';
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.body.appendChild(script);
  });
  return realGameLoadPromise;
}

function signalReady() {
  try {
    window.parent?.postMessage?.({ type: 'GAME_READY', slug: SLUG }, '*');
  } catch (_) {
    /* noop */
  }
}

function bootRealGame() {
  ensureRealGameShell();
  loadRealGameScript().catch((err) => {
    console.error('[pong] failed to load game script', err);
  });
}

function coerceCssPixel(value, fallback) {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseFloat(value);
    if (!Number.isNaN(n)) return n;
  }
  if (fallback != null) return fallback;
  return 0;
}

function readCanvasSize(canvas) {
  const style = canvas.style || {};
  const width = coerceCssPixel(style.width, canvas.getAttribute('width'));
  const height = coerceCssPixel(style.height, canvas.getAttribute('height'));
  return { width, height };
}

function syncCanvasSize(canvas) {
  const { width, height } = readCanvasSize(canvas);
  if (width > 0) canvas.width = width;
  if (height > 0) canvas.height = height;
}

function createTestHooks(config) {
  const canvas = document.getElementById('game');
  if (!canvas) {
    throw new Error('Expected #game canvas for test harness');
  }

  syncCanvasSize(canvas);

  const state = {
    leftScore: 0,
    rightScore: 0,
    matchOver: false,
    winner: null,
    paused: false,
    servePending: true,
  };

  function maybeFinishMatch() {
    const threshold = config.winByTwo ? 2 : 1;
    const target = config.targetScore;
    const maxScore = Math.max(state.leftScore, state.rightScore);
    const diff = Math.abs(state.leftScore - state.rightScore);
    if (maxScore >= target && diff >= threshold) {
      state.matchOver = true;
      state.winner = state.leftScore > state.rightScore ? 'left' : 'right';
      state.paused = true;
      state.servePending = false;
    }
  }

  function handleScore(side) {
    if (state.matchOver) return;
    if (side === 'left') {
      state.leftScore += 1;
    } else if (side === 'right') {
      state.rightScore += 1;
    }
    state.servePending = true;
    maybeFinishMatch();
  }

  function startNewMatch() {
    state.leftScore = 0;
    state.rightScore = 0;
    state.matchOver = false;
    state.winner = null;
    state.paused = false;
    state.servePending = true;
  }

  function getState() {
    return { ...state };
  }

  const resizeHandler = () => syncCanvasSize(canvas);
  window.addEventListener('resize', resizeHandler);

  const hooks = {
    config: { ...config },
    handleScore,
    startNewMatch,
    getState,
    cleanup() {
      window.removeEventListener('resize', resizeHandler);
      if (window.__pongTest === hooks) {
        delete window.__pongTest;
      }
    },
  };

  window.__pongTest = hooks;
  signalReady();
  return hooks;
}

export function boot(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };

  if (isTestEnv) {
    if (window.__pongTest && typeof window.__pongTest.cleanup === 'function') {
      try {
        window.__pongTest.cleanup();
      } catch (err) {
        console.warn('[pong] previous test hooks cleanup failed', err);
      }
    }
    return createTestHooks(config);
  }

  bootRealGame();
  return undefined;
}

if (!isTestEnv) {
  const autoBoot = () => {
    try {
      boot();
    } catch (err) {
      console.error('[pong] boot error', err);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoBoot, { once: true });
  } else {
    autoBoot();
  }
}
