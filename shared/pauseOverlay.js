(function (global) {
  const g = global || (typeof globalThis !== 'undefined' ? globalThis : {});
  const doc = g.document;
  const SELECTORS = [
    '.pause-overlay',
    '#gg-pause-overlay',
    '.gg-overlay.gg-pause',
    '.modal-paused',
    '#hud .paused',
    '.hud-paused'
  ];
  const joinedSelectors = SELECTORS.join(',');

  function ensureKillStyle(targetDoc) {
    const d = targetDoc || doc;
    if (!d || !d.head) return null;
    const existing = d.getElementById('gg-pause-kill-style');
    if (existing) return existing;
    const style = d.createElement('style');
    style.id = 'gg-pause-kill-style';
    style.textContent = `
      ${SELECTORS.join(',\n      ')} {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }
    `;
    d.head.appendChild(style);
    return style;
  }

  function hideElement(el) {
    if (!el) return;
    el.style.display = 'none';
    el.classList.add('hidden');
    if (typeof el.setAttribute === 'function') {
      el.setAttribute('aria-hidden', 'true');
    }
  }

  function forceClearPause(options) {
    const opts = options || {};
    const d = opts.document || doc;
    if (!d) return;
    const root = opts.root || d;
    const selectors = opts.selectors || joinedSelectors;
    ensureKillStyle(d);
    try {
      const nodes = typeof selectors === 'string'
        ? root.querySelectorAll(selectors)
        : root.querySelectorAll((selectors || []).join(','));
      nodes.forEach(hideElement);
    } catch (err) {
      // ignore selector issues
    }

    const pausedEl = opts.pausedEl || (typeof d.getElementById === 'function' ? d.getElementById('gg-paused') : null);
    if (pausedEl) {
      pausedEl.setAttribute('hidden', '');
      hideElement(pausedEl);
    }

    const pauseBtn = opts.pauseButton || (typeof d.getElementById === 'function' ? d.getElementById('gg-pause') : null);
    if (pauseBtn && typeof pauseBtn.setAttribute === 'function') {
      pauseBtn.setAttribute('aria-pressed', 'false');
    }

    try {
      const hud = g.GG_HUD;
      if (hud && typeof hud.hidePause === 'function') {
        hud.hidePause();
      }
    } catch (err) {
      // ignore hud errors
    }

    if (typeof opts.onClear === 'function') {
      try { opts.onClear(); } catch (err) {}
    }
  }

  function createPauseOverlay(opts) {
    if (!doc) return null;
    const options = opts || {};
    const existingSelector = options.selector || '.pause-overlay';
    try {
      const previous = doc.querySelector(existingSelector + (options.gameId ? `[data-game="${options.gameId}"]` : ''));
      if (previous && typeof previous.remove === 'function') previous.remove();
    } catch (err) {}

    const overlay = doc.createElement('div');
    overlay.className = 'pause-overlay hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    if (options.gameId) overlay.setAttribute('data-game', String(options.gameId));

    const heading = options.heading || 'Paused';
    const hint = options.hint || 'Press Esc or P to resume';
    const resumeLabel = options.resumeLabel || 'Resume';
    const restartLabel = options.restartLabel || 'Restart';

    overlay.innerHTML = `
      <div class="pixel-panel pixel-panel--pause" role="document">
        <div class="pixel-panel__header">
          <span class="pixel-panel__icon pixel-panel__icon--star" aria-hidden="true"></span>
          <h3 class="pixel-panel__title">${heading}</h3>
          <span class="pixel-panel__icon pixel-panel__icon--shield" aria-hidden="true"></span>
        </div>
        <p class="pixel-panel__hint">${hint}</p>
        <div class="pixel-panel__actions">
          <button type="button" class="btn" data-action="resume">${resumeLabel}</button>
          <button type="button" class="btn" data-action="restart">${restartLabel}</button>
        </div>
      </div>`;

    const attach = () => {
      (doc.body || doc.documentElement).appendChild(overlay);
    };
    if (doc.body) attach();
    else doc.addEventListener('DOMContentLoaded', attach, { once: true });

    const resumeBtn = overlay.querySelector('[data-action="resume"]');
    const restartBtn = overlay.querySelector('[data-action="restart"]');
    const hintEl = overlay.querySelector('.pixel-panel__hint');
    if (hintEl && !hint) hintEl.hidden = true;

    function hide() { overlay.classList.add('hidden'); }
    function show() {
      overlay.classList.remove('hidden');
      if (resumeBtn && typeof resumeBtn.focus === 'function') resumeBtn.focus();
    }

    resumeBtn?.addEventListener('click', () => {
      hide();
      if (typeof options.onResume === 'function') options.onResume();
    });

    restartBtn?.addEventListener('click', () => {
      hide();
      if (typeof options.onRestart === 'function') options.onRestart();
    });

    return {
      show,
      hide,
      element: overlay,
      setHint(text) {
        if (hintEl && typeof text === 'string') {
          hintEl.textContent = text;
          hintEl.hidden = !text.trim();
        }
      }
    };
  }

  const api = {
    createPauseOverlay,
    forceClearPause,
    ensurePauseOverlayStyle: ensureKillStyle,
    selectors: SELECTORS.slice()
  };

  const gameUI = g.gameUI = g.gameUI || {};
  gameUI.forceClearPause = forceClearPause;
  gameUI.createPauseOverlay = createPauseOverlay;
  gameUI.ensurePauseOverlayStyle = ensureKillStyle;

  g.pauseOverlay = Object.assign(g.pauseOverlay || {}, api);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof define === 'function' && define.amd) {
    define(() => api);
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
