const DEFAULT_ALLOW = 'autoplay; fullscreen; gamepad; xr-spatial-tracking';
const DEFAULT_SANDBOX = 'allow-scripts allow-same-origin allow-modals allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-downloads';
const DEFAULT_TIMEOUT = 20000;

function ensureMount(target) {
  const doc = document;
  if (!doc) return null;
  if (target && typeof target === 'object' && target.nodeType === 1) return target;
  if (typeof target === 'string' && target) {
    const found = doc.querySelector(target);
    if (found) return found;
    if (target.startsWith('#')) {
      const el = doc.createElement('div');
      el.id = target.slice(1);
      doc.body.appendChild(el);
      return el;
    }
  }
  let fallback = doc.getElementById('game-root');
  if (!fallback) {
    fallback = doc.createElement('div');
    fallback.id = 'game-root';
    doc.body.appendChild(fallback);
  }
  return fallback;
}

function escapeForInlineScript(code) {
  return String(code || '').replace(/<\/script/gi, '<\\/script');
}

function json(value) {
  return JSON.stringify(value).replace(/<\//g, '\\u003C/');
}

function buildModuleSrcdoc(options) {
  const slug = options.slug || 'game';
  const entry = options.entry;
  const mountId = options.moduleRootId || 'game-root';
  const meta = options.meta || { slug };
  const css = options.moduleCSS || '';
  const script = `
const slug = ${json(slug)};
const entryUrl = ${json(entry)};
const mountSelector = ${json('#' + mountId)};
const mountEl = document.getElementById(${json(mountId)});
const meta = ${json(meta)};
const ctx = { mount: mountSelector, root: mountEl, meta };
function post(payload){
  try {
    parent.postMessage(payload, '*');
  } catch (err) {
    try { parent.postMessage(payload, '*'); } catch (_err) {}
  }
}
function signal(type, extra){
  const detail = Object.assign({ type, slug }, extra || {});
  post(detail);
}
const controller = { pause: null, resume: null, dispose: null };
function adopt(candidate){
  if (!candidate) return;
  if (typeof candidate.pause === 'function') {
    controller.pause = () => {
      try { candidate.pause(); } catch (err) { console.warn('[sandbox] pause handler failed', err); }
    };
  }
  if (typeof candidate.resume === 'function') {
    controller.resume = () => {
      try { candidate.resume(); } catch (err) { console.warn('[sandbox] resume handler failed', err); }
    };
  }
  if (typeof candidate.dispose === 'function' || typeof candidate.destroy === 'function') {
    const disposer = candidate.dispose || candidate.destroy;
    controller.dispose = () => {
      try { disposer.call(candidate); } catch (err) { console.warn('[sandbox] dispose handler failed', err); }
    };
  }
}
async function boot(){
  try {
    const mod = await import(entryUrl);
    const primary = mod && (mod.default || mod);
    const initFn = (primary && typeof primary.init === 'function') ? primary.init
      : (mod && typeof mod.init === 'function') ? mod.init
      : (typeof primary === 'function') ? primary
      : (typeof mod.default === 'function' ? mod.default : null);
    let result = null;
    if (typeof initFn === 'function') {
      result = await initFn(ctx);
    } else if (primary && typeof primary.mount === 'function') {
      result = await primary.mount(ctx);
    }
    adopt(primary);
    adopt(mod);
    adopt(result);
    signal('GAME_READY');
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error('[sandbox] module boot failed', err);
    signal('GAME_ERROR', { error: message, message });
  }
}
window.addEventListener('message', (event) => {
  const data = event && event.data;
  if (!data || (data.slug && data.slug !== slug)) return;
  const type = data.type;
  if (type === 'GAME_PAUSE') {
    if (controller.pause) controller.pause();
  } else if (type === 'GAME_RESUME') {
    if (controller.resume) controller.resume();
  } else if (type === 'GAME_DISPOSE') {
    if (controller.dispose) controller.dispose();
  }
});
signal('GAME_LOADING');
boot();
`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; padding: 0; min-height: 100%; background: #000; }
    #${mountId} { position: relative; width: 100%; min-height: 100vh; }
    ${css}
  </style>
</head>
<body>
  <div id="${mountId}"></div>
  <script type="module">${escapeForInlineScript(script)}</script>
</body>
</html>`;
}

export function createGameSandbox(options = {}) {
  const baseConfig = {
    slug: options.slug || 'unknown',
    target: options.target || '#game-root',
    allow: options.allow || DEFAULT_ALLOW,
    sandbox: options.sandbox || options.sandboxAttributes || DEFAULT_SANDBOX,
    className: options.className || 'gg-game-sandbox',
    timeoutMs: Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT,
    onEvent: typeof options.onEvent === 'function' ? options.onEvent : null,
  };

  const state = {
    config: baseConfig,
    frame: null,
    mode: null,
    readyPromise: null,
    readyResolve: null,
    readyReject: null,
    timer: null,
    disposed: false,
    messageHandler: null,
  };

  function clearTimer() {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function removeFrame() {
    if (state.frame) {
      try {
        if (state.frame.parentNode && typeof state.frame.parentNode.removeChild === 'function') {
          state.frame.parentNode.removeChild(state.frame);
        } else if (typeof state.frame.remove === 'function') {
          state.frame.remove();
        }
      } catch (err) {}
    }
    state.frame = null;
    if (state.messageHandler) {
      window.removeEventListener('message', state.messageHandler);
      state.messageHandler = null;
    }
    if (state.readyReject) {
      state.readyReject(new Error('Sandbox was reset before completing initialization'));
    }
    state.readyPromise = null;
    state.readyResolve = null;
    state.readyReject = null;
    clearTimer();
  }

  async function init(initOptions = {}) {
    if (state.disposed) throw new Error('Sandbox has been disposed');

    const merged = {
      ...state.config,
      ...initOptions,
      slug: initOptions.slug || state.config.slug,
    };
    if (!merged.entry) throw new Error('Sandbox init requires an entry');

    state.config = {
      ...merged,
      timeoutMs: Number.isFinite(merged.timeoutMs) ? Number(merged.timeoutMs) : state.config.timeoutMs,
    };

    const mount = ensureMount(merged.target);
    if (!mount) throw new Error('Unable to resolve mount element');

    // Remove any previous sandbox frames within the mount.
    try {
      mount.querySelectorAll('iframe[data-gg-sandbox]').forEach(el => {
        if (el === state.frame) return;
        try { el.remove(); } catch (err) {
          if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
            el.parentNode.removeChild(el);
          }
        }
      });
    } catch (err) {}

    removeFrame();

    const frame = document.createElement('iframe');
    frame.setAttribute('data-gg-sandbox', '');
    frame.dataset.slug = merged.slug || '';
    frame.className = merged.className || 'gg-game-sandbox';
    frame.setAttribute('allow', merged.allow || DEFAULT_ALLOW);
    frame.setAttribute('aria-label', `${merged.title || merged.slug || 'game'} frame`);
    frame.setAttribute('title', `${merged.title || merged.slug || 'game'} frame`);
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.style.border = '0';

    state.mode = merged.mode === 'iframe' ? 'iframe' : 'module';

    if (state.mode === 'iframe') {
      frame.src = merged.entry;
    } else {
      frame.setAttribute('sandbox', merged.sandbox || DEFAULT_SANDBOX);
      frame.srcdoc = buildModuleSrcdoc({
        slug: merged.slug,
        entry: merged.entry,
        moduleRootId: merged.moduleRootId,
        meta: merged.meta,
        moduleCSS: merged.moduleCSS,
      });
    }

    mount.appendChild(frame);
    state.frame = frame;

    const ready = new Promise((resolve, reject) => {
      state.readyResolve = resolve;
      state.readyReject = reject;
    });
    state.readyPromise = ready;

    state.messageHandler = function handleMessage(event) {
      if (!state.frame || event.source !== state.frame.contentWindow) return;
      const data = event && event.data;
      if (!data || typeof data !== 'object') return;
      if (merged.slug && data.slug && data.slug !== merged.slug) return;

      if (data.type === 'GAME_READY') {
        clearTimer();
        if (state.readyResolve) state.readyResolve(data);
        state.readyResolve = null;
        state.readyReject = null;
      } else if (data.type === 'GAME_ERROR') {
        clearTimer();
        const err = new Error(data.error || data.message || 'Game failed to load');
        if (state.readyReject) state.readyReject(err);
        state.readyResolve = null;
        state.readyReject = null;
      }

      if (typeof merged.onEvent === 'function') {
        try {
          merged.onEvent(data);
        } catch (err) {
          console.warn('[sandbox] onEvent handler failed', err);
        }
      }
    };

    window.addEventListener('message', state.messageHandler);

    clearTimer();
    const timeout = Number.isFinite(merged.timeoutMs) ? Number(merged.timeoutMs) : DEFAULT_TIMEOUT;
    if (timeout > 0) {
      state.timer = setTimeout(() => {
        state.timer = null;
        if (state.readyReject) {
          const err = new Error('Game sandbox timed out');
          state.readyReject(err);
          state.readyResolve = null;
          state.readyReject = null;
          if (typeof merged.onEvent === 'function') {
            try {
              merged.onEvent({ type: 'GAME_TIMEOUT', slug: merged.slug, error: err.message, message: err.message });
            } catch (_) {}
          }
        }
      }, timeout);
    }

    return { frame, mode: state.mode, ready };
  }

  function postMessage(type) {
    if (!state.frame || !state.frame.contentWindow) return;
    try {
      state.frame.contentWindow.postMessage({ type, slug: state.config.slug }, '*');
    } catch (err) {
      console.warn('[sandbox] failed to post message', err);
    }
  }

  function pause() {
    postMessage('GAME_PAUSE');
  }

  function resume() {
    postMessage('GAME_RESUME');
  }

  async function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    try {
      postMessage('GAME_DISPOSE');
    } catch (_) {}
    removeFrame();
  }

  return {
    init,
    pause,
    resume,
    dispose,
    getFrame: () => state.frame,
    get mode() {
      return state.mode;
    },
    get ready() {
      return state.readyPromise;
    }
  };
}
