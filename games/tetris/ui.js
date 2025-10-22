import '../../shared/ui/hud.js';

const STYLE_ID = 'tetris-hud-style';

const DEFAULT_DAS_MS = 160;
const DEFAULT_ARR_MS = 20;
const DAS_MIN_MS = 0;
const DAS_MAX_MS = 400;
const ARR_MIN_MS = 0;
const ARR_MAX_MS = 100;
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const clampMs = (value, min, max) => {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const formatTiming = (ms) => (ms <= 0 ? 'Instant' : `${ms} ms`);

const PIECE_LABELS = {
  I: 'I tetromino',
  O: 'O tetromino',
  T: 'T tetromino',
  S: 'S tetromino',
  Z: 'Z tetromino',
  J: 'J tetromino',
  L: 'L tetromino',
};

function ensureStyle(){
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .tetris-hud {\n      pointer-events: none;\n      display: flex;\n      flex-direction: column;\n      gap: 12px;\n      padding: 12px;\n      align-items: flex-end;\n    }\n    .tetris-hud__panel {\n      pointer-events: auto;\n      background: rgba(15, 19, 32, 0.85);\n      color: #f8fafc;\n      border-radius: 14px;\n      padding: 12px 16px;\n      min-width: 220px;\n      box-shadow: 0 12px 30px rgba(15, 19, 32, 0.35);\n      backdrop-filter: blur(6px);\n      border: 1px solid rgba(148, 163, 184, 0.25);\n    }\n    .tetris-hud__panel h2,\n    .tetris-hud__panel h3 {\n      margin: 0;\n      font-weight: 600;\n      font-size: 0.9rem;\n      text-transform: uppercase;\n      letter-spacing: 0.08em;\n      color: #cbd5f5;\n    }\n    .tetris-hud__header {\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      gap: 8px;\n      margin-bottom: 8px;\n    }\n    .tetris-hud__badges {\n      display: flex;\n      gap: 6px;\n    }\n    .tetris-hud__badge {\n      background: rgba(148, 163, 184, 0.18);\n      color: #e2e8f0;\n      border-radius: 999px;\n      padding: 2px 8px;\n      font-size: 0.7rem;\n      letter-spacing: 0.06em;\n    }\n    .tetris-hud__badge--daily {\n      background: rgba(45, 212, 191, 0.18);\n      color: #5eead4;\n    }\n    .tetris-hud__badge--b2b {\n      background: rgba(249, 115, 22, 0.2);\n      color: #fb923c;\n    }\n    .tetris-hud__stats {\n      display: grid;\n      grid-template-columns: repeat(3, minmax(0, 1fr));\n      gap: 6px 12px;\n      margin: 0;\n      padding: 0;\n    }\n    .tetris-hud__stats dt {\n      font-size: 0.68rem;\n      text-transform: uppercase;\n      letter-spacing: 0.06em;\n      color: rgba(148, 163, 184, 0.9);\n    }\n    .tetris-hud__stats dd {\n      margin: 0;\n      font-size: 1rem;\n      font-weight: 700;\n      color: #f1f5f9;\n    }\n    .tetris-hud__combo {\n      margin-top: 10px;\n      font-weight: 600;\n      color: #38bdf8;\n      letter-spacing: 0.08em;\n      text-transform: uppercase;\n    }\n    .tetris-hud__toggle {\n      display: flex;\n      align-items: center;\n      gap: 6px;\n      margin-top: 12px;\n      font-size: 0.8rem;\n      color: rgba(226, 232, 240, 0.85);\n    }\n    .tetris-hud__toggle input {\n      pointer-events: auto;\n      accent-color: #38bdf8;\n    }\n    .tetris-hud__panel--queue {\n      display: grid;\n      gap: 12px;\n    }\n    .tetris-hud__block {\n      display: grid;\n      gap: 6px;\n    }\n    .tetris-hud__pieces {\n      display: flex;\n      gap: 6px;\n      align-items: center;\n      min-height: 36px;\n    }\n    .tetris-hud__pieces[data-disabled='true'] {\n      opacity: 0.5;\n    }\n    .tetris-hud__piece {\n      display: inline-flex;\n      align-items: center;\n      justify-content: center;\n      width: 32px;\n      height: 32px;\n      border-radius: 8px;\n      font-weight: 700;\n      font-size: 0.9rem;\n      color: #e2e8f0;\n      background: rgba(148, 163, 184, 0.25);\n      box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.45);\n    }\n    .tetris-hud__piece--empty {\n      opacity: 0.45;\n      font-weight: 500;\n    }\n    .tetris-hud__piece[data-piece='I'] { background: rgba(56, 189, 248, 0.3); color: #bae6fd; }\n    .tetris-hud__piece[data-piece='O'] { background: rgba(250, 204, 21, 0.35); color: #fef08a; }\n    .tetris-hud__piece[data-piece='T'] { background: rgba(192, 132, 252, 0.35); color: #e9d5ff; }\n    .tetris-hud__piece[data-piece='S'] { background: rgba(74, 222, 128, 0.32); color: #bbf7d0; }\n    .tetris-hud__piece[data-piece='Z'] { background: rgba(248, 113, 113, 0.35); color: #fecaca; }\n    .tetris-hud__piece[data-piece='J'] { background: rgba(96, 165, 250, 0.32); color: #dbeafe; }\n    .tetris-hud__piece[data-piece='L'] { background: rgba(251, 146, 60, 0.35); color: #fed7aa; }\n    @media (max-width: 720px) {\n      .tetris-hud {\n        align-items: stretch;\n      }\n      .tetris-hud__panel {\n        min-width: unset;\n      }\n    }\n  `;
  document.head.appendChild(style);
}

function resolveHudContainer(){
  if (typeof document === 'undefined') return null;
  let el = document.querySelector('.hud, #hud');
  if (el && el.id === 'hud' && !el.classList.contains('hud')) {
    el.classList.add('hud');
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'hud';
    document.body.appendChild(el);
  }
  return el;
}

function renderPiece(container, type){
  container.innerHTML = '';
  if (!type) {
    const placeholder = document.createElement('span');
    placeholder.className = 'tetris-hud__piece tetris-hud__piece--empty';
    placeholder.textContent = '—';
    container.appendChild(placeholder);
    return;
  }
  const piece = document.createElement('span');
  piece.className = 'tetris-hud__piece';
  piece.dataset.piece = type;
  piece.textContent = type;
  const label = PIECE_LABELS[type] || `Piece ${type}`;
  piece.setAttribute('aria-label', label);
  container.appendChild(piece);
}

function renderPieceList(container, types){
  container.innerHTML = '';
  if (!types || !types.length) {
    const placeholder = document.createElement('span');
    placeholder.className = 'tetris-hud__piece tetris-hud__piece--empty';
    placeholder.textContent = '—';
    container.appendChild(placeholder);
    return;
  }
  types.forEach((type, index) => {
    const piece = document.createElement('span');
    piece.className = 'tetris-hud__piece';
    piece.dataset.piece = type;
    piece.textContent = type;
    const label = PIECE_LABELS[type] || `Piece ${type}`;
    piece.setAttribute('aria-label', `${label} (${index + 1})`);
    container.appendChild(piece);
  });
}

function createHowToOverlay({
  getGhost,
  setGhost,
  getDas,
  setDas,
  getArr,
  setArr,
  onOpen,
  onClose,
} = {}){
  if (typeof document === 'undefined') return null;
  const existing = document.querySelector('.tetris-howto');
  if (existing && existing.parentElement) {
    existing.parentElement.removeChild(existing);
  }
  const overlay = document.createElement('div');
  overlay.className = 'tetris-howto';
  overlay.id = 'tetrisHowtoOverlay';
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="tetris-howto__panel" role="dialog" aria-modal="true" aria-labelledby="tetrisHowtoTitle">
      <header class="tetris-howto__header">
        <h2 class="tetris-howto__title" id="tetrisHowtoTitle">How to play</h2>
        <button type="button" class="tetris-howto__close" data-action="close" aria-label="Close how-to overlay">&times;</button>
      </header>
      <div class="tetris-howto__content">
        <section class="tetris-howto__section">
          <h3>Controls</h3>
          <ul class="tetris-howto__list">
            <li><kbd>←</kbd>/<kbd>→</kbd> — Move piece</li>
            <li><kbd>↑</kbd> — Rotate</li>
            <li><kbd>↓</kbd> — Soft drop</li>
            <li><kbd>Space</kbd> — Hard drop</li>
            <li><kbd>C</kbd> — Hold</li>
            <li><kbd>G</kbd> — Toggle ghost</li>
            <li><kbd>P</kbd> — Pause</li>
          </ul>
        </section>
        <section class="tetris-howto__section">
          <h3>Settings</h3>
          <div class="tetris-howto__settings">
            <label class="tetris-howto__toggle" for="tetrisHowtoGhost">
              <span>Ghost piece</span>
              <input type="checkbox" id="tetrisHowtoGhost" />
            </label>
            <div class="tetris-howto__slider">
              <div class="tetris-howto__slider-header">
                <label for="tetrisHowtoDas">Delayed Auto Shift (DAS)</label>
                <span class="tetris-howto__value" data-das-value>160 ms</span>
              </div>
              <input type="range" id="tetrisHowtoDas" min="${DAS_MIN_MS}" max="${DAS_MAX_MS}" step="10" />
              <p class="tetris-howto__note">Time you hold left/right before auto movement kicks in.</p>
            </div>
            <div class="tetris-howto__slider">
              <div class="tetris-howto__slider-header">
                <label for="tetrisHowtoArr">Auto Repeat Rate (ARR)</label>
                <span class="tetris-howto__value" data-arr-value>20 ms</span>
              </div>
              <input type="range" id="tetrisHowtoArr" min="${ARR_MIN_MS}" max="${ARR_MAX_MS}" step="5" />
              <p class="tetris-howto__note">Speed of repeated movement once DAS completes.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
  const body = document.body || document.documentElement;
  if (!body) return null;
  body.appendChild(overlay);

  const panel = overlay.querySelector('.tetris-howto__panel');
  const closeBtn = overlay.querySelector('[data-action="close"]');
  const ghostToggle = overlay.querySelector('#tetrisHowtoGhost');
  const dasInput = overlay.querySelector('#tetrisHowtoDas');
  const arrInput = overlay.querySelector('#tetrisHowtoArr');
  const dasValue = overlay.querySelector('[data-das-value]');
  const arrValue = overlay.querySelector('[data-arr-value]');

  if (panel) {
    panel.setAttribute('tabindex', '-1');
  }

  let restoreFocus = null;
  let lastOverflow = '';

  const updateDasLabel = (ms) => {
    if (dasValue) dasValue.textContent = formatTiming(ms);
  };
  const updateArrLabel = (ms) => {
    if (arrValue) arrValue.textContent = formatTiming(ms);
  };

  const readSettingMs = (value, fallbackMs, min, max) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return clampMs(Math.round(value), min, max);
    }
    return fallbackMs;
  };

  const sync = (settings = {}) => {
    const ghostValue =
      typeof settings.ghost === 'boolean'
        ? settings.ghost
        : (typeof getGhost === 'function' ? !!getGhost() : false);
    if (ghostToggle) ghostToggle.checked = ghostValue;

    const rawDasSeconds =
      typeof settings.das === 'number'
        ? settings.das
        : (typeof getDas === 'function' ? getDas() : DEFAULT_DAS_MS / 1000);
    const dasMs = readSettingMs(Math.max(0, rawDasSeconds) * 1000, DEFAULT_DAS_MS, DAS_MIN_MS, DAS_MAX_MS);
    if (dasInput) dasInput.value = String(dasMs);
    updateDasLabel(dasMs);

    const rawArrSeconds =
      typeof settings.arr === 'number'
        ? settings.arr
        : (typeof getArr === 'function' ? getArr() : DEFAULT_ARR_MS / 1000);
    const arrMs = readSettingMs(Math.max(0, rawArrSeconds) * 1000, DEFAULT_ARR_MS, ARR_MIN_MS, ARR_MAX_MS);
    if (arrInput) arrInput.value = String(arrMs);
    updateArrLabel(arrMs);
  };

  const close = () => {
    if (overlay.hasAttribute('hidden')) return;
    overlay.classList.remove('tetris-howto--open');
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKeydown, true);
    overlay.removeEventListener('click', onOverlayClick);
    if (body) body.style.overflow = lastOverflow;
    if (typeof onClose === 'function') {
      try { onClose(); } catch (_) {}
    }
    if (restoreFocus && typeof restoreFocus.focus === 'function') {
      try { restoreFocus.focus(); } catch (_) {}
    }
    restoreFocus = null;
  };

  const trapFocus = (event) => {
    const container = panel || overlay;
    if (!container) return;
    const focusable = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.tabIndex !== -1 &&
      typeof el.focus === 'function' &&
      (() => {
        try {
          const rect = el.getBoundingClientRect();
          return rect && (rect.width > 0 || rect.height > 0);
        } catch (_) {
          return false;
        }
      })()
    );
    if (!focusable.length) {
      event.preventDefault();
      if (container && typeof container.focus === 'function') {
        container.focus();
      }
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      trapFocus(event);
    }
  };

  const onOverlayClick = (event) => {
    if (event.target === overlay) {
      close();
    }
  };

  const open = () => {
    sync();
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => overlay.classList.add('tetris-howto--open'));
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (body) {
      lastOverflow = body.style.overflow || '';
      body.style.overflow = 'hidden';
    }
    document.addEventListener('keydown', onKeydown, true);
    overlay.addEventListener('click', onOverlayClick);
    if (typeof onOpen === 'function') {
      try { onOpen(); } catch (_) {}
    }
    requestAnimationFrame(() => {
      if (closeBtn && typeof closeBtn.focus === 'function') {
        try { closeBtn.focus({ preventScroll: true }); } catch (_) { closeBtn.focus(); }
      } else if (panel && typeof panel.focus === 'function') {
        try { panel.focus({ preventScroll: true }); } catch (_) { panel.focus(); }
      }
    });
  };

  if (closeBtn) {
    closeBtn.addEventListener('click', () => close());
  }
  if (ghostToggle) {
    ghostToggle.addEventListener('change', () => {
      const checked = ghostToggle.checked;
      if (typeof setGhost === 'function') {
        try { setGhost(checked); } catch (_) {}
      }
      sync({ ghost: checked });
    });
  }
  if (dasInput) {
    dasInput.addEventListener('input', () => {
      const next = clampMs(Math.round(dasInput.valueAsNumber || 0), DAS_MIN_MS, DAS_MAX_MS);
      updateDasLabel(next);
    });
    dasInput.addEventListener('change', () => {
      const requested = clampMs(Math.round(dasInput.valueAsNumber || 0), DAS_MIN_MS, DAS_MAX_MS);
      let applied = requested;
      if (typeof setDas === 'function') {
        const result = setDas(requested / 1000);
        if (Number.isFinite(result)) {
          applied = clampMs(Math.round(Math.max(0, result) * 1000), DAS_MIN_MS, DAS_MAX_MS);
        }
      }
      sync({ das: applied / 1000 });
    });
  }
  if (arrInput) {
    arrInput.addEventListener('input', () => {
      const next = clampMs(Math.round(arrInput.valueAsNumber || 0), ARR_MIN_MS, ARR_MAX_MS);
      updateArrLabel(next);
    });
    arrInput.addEventListener('change', () => {
      const requested = clampMs(Math.round(arrInput.valueAsNumber || 0), ARR_MIN_MS, ARR_MAX_MS);
      let applied = requested;
      if (typeof setArr === 'function') {
        const result = setArr(requested / 1000);
        if (Number.isFinite(result)) {
          applied = clampMs(Math.round(Math.max(0, result) * 1000), ARR_MIN_MS, ARR_MAX_MS);
        }
      }
      sync({ arr: applied / 1000 });
    });
  }

  return {
    open,
    close,
    sync,
    id: overlay.id,
  };
}

export function createHud({
  onToggleDailySeed,
  getGhost,
  setGhost,
  getDas,
  setDas,
  getArr,
  setArr,
} = {}){
  if (typeof document === 'undefined') return null;
  ensureStyle();
  const host = resolveHudContainer();
  if (!host) return null;
  host.innerHTML = `
    <div class="tetris-hud" aria-live="polite">
      <section class="tetris-hud__panel tetris-hud__panel--stats">
        <header class="tetris-hud__header">
          <div class="tetris-hud__heading">
            <h2>Mission Control</h2>
            <button type="button" class="tetris-hud__button" id="tetrisHowToButton" aria-haspopup="dialog" aria-expanded="false">
              How to play
            </button>
          </div>
          <div class="tetris-hud__badges">
            <span id="tetrisDailyBadge" class="tetris-hud__badge tetris-hud__badge--daily" hidden>Daily</span>
            <span id="tetrisB2BBadge" class="tetris-hud__badge tetris-hud__badge--b2b" hidden>B2B</span>
          </div>
        </header>
        <dl class="tetris-hud__stats">
          <div><dt>Score</dt><dd id="tetrisHudScore">0</dd></div>
          <div><dt>Level</dt><dd id="tetrisHudLevel">1</dd></div>
          <div><dt>Lines</dt><dd id="tetrisHudLines">0</dd></div>
        </dl>
        <div id="tetrisHudCombo" class="tetris-hud__combo" hidden></div>
        <label class="tetris-hud__toggle">
          <input type="checkbox" id="tetrisDailyToggle" />
          Daily seed
        </label>
      </section>
      <section class="tetris-hud__panel tetris-hud__panel--queue">
        <div class="tetris-hud__block">
          <h3>Hold</h3>
          <div id="tetrisHoldDisplay" class="tetris-hud__pieces" aria-live="polite" data-disabled="false"></div>
        </div>
        <div class="tetris-hud__block">
          <h3>Next</h3>
          <div id="tetrisNextDisplay" class="tetris-hud__pieces tetris-hud__pieces--preview" aria-live="polite"></div>
        </div>
      </section>
    </div>
  `;

  const scoreNode = host.querySelector('#tetrisHudScore');
  const levelNode = host.querySelector('#tetrisHudLevel');
  const lineNode = host.querySelector('#tetrisHudLines');
  const comboNode = host.querySelector('#tetrisHudCombo');
  const holdNode = host.querySelector('#tetrisHoldDisplay');
  const nextNode = host.querySelector('#tetrisNextDisplay');
  const dailyToggle = host.querySelector('#tetrisDailyToggle');
  const dailyBadge = host.querySelector('#tetrisDailyBadge');
  const b2bBadge = host.querySelector('#tetrisB2BBadge');
  let howToButton = null;
  const overlay = createHowToOverlay({
    getGhost,
    setGhost,
    getDas,
    setDas,
    getArr,
    setArr,
    onOpen(){
      if (howToButton) howToButton.setAttribute('aria-expanded', 'true');
    },
    onClose(){
      if (howToButton) howToButton.setAttribute('aria-expanded', 'false');
    },
  });
  howToButton = host.querySelector('#tetrisHowToButton');
  if (howToButton) {
    if (overlay?.id) {
      howToButton.setAttribute('aria-controls', overlay.id);
    }
    howToButton.addEventListener('click', () => {
      if (overlay && typeof overlay.open === 'function') {
        overlay.open();
      }
    });
  }

  if (dailyToggle) {
    dailyToggle.addEventListener('change', event => {
      if (typeof onToggleDailySeed === 'function') {
        onToggleDailySeed(event.target.checked);
      }
    });
  }

  renderPiece(holdNode, null);
  renderPieceList(nextNode, []);

  if (overlay && typeof overlay.sync === 'function') {
    overlay.sync({
      ghost: typeof getGhost === 'function' ? getGhost() : undefined,
      das: typeof getDas === 'function' ? getDas() : undefined,
      arr: typeof getArr === 'function' ? getArr() : undefined,
    });
  }

  return {
    setStats({ score, level, lines }) {
      if (scoreNode) scoreNode.textContent = typeof score === 'number' ? score.toLocaleString() : String(score ?? '0');
      if (levelNode) levelNode.textContent = typeof level === 'number' ? String(level) : String(level ?? '1');
      if (lineNode) lineNode.textContent = typeof lines === 'number' ? String(lines) : String(lines ?? '0');
    },
    setCombo(comboCount) {
      if (!comboNode) return;
      const count = Number(comboCount) || 0;
      if (count > 1) {
        comboNode.hidden = false;
        comboNode.textContent = `Combo x${count}`;
      } else if (count === 1) {
        comboNode.hidden = false;
        comboNode.textContent = 'Combo x1';
      } else {
        comboNode.hidden = true;
        comboNode.textContent = '';
      }
    },
    setBackToBack(active) {
      if (b2bBadge) {
        b2bBadge.hidden = !active;
      }
    },
    setHold({ piece, canHold } = {}) {
      if (!holdNode) return;
      holdNode.dataset.disabled = canHold ? 'false' : 'true';
      renderPiece(holdNode, piece || null);
    },
    setNext(types) {
      if (!nextNode) return;
      renderPieceList(nextNode, Array.isArray(types) ? types.filter(Boolean) : []);
    },
    setDaily({ active, label }) {
      if (dailyToggle) {
        dailyToggle.checked = !!active;
      }
      if (dailyBadge) {
        if (active) {
          dailyBadge.hidden = false;
          dailyBadge.textContent = label ? `Daily ${label}` : 'Daily';
        } else {
          dailyBadge.hidden = true;
          dailyBadge.textContent = 'Daily';
        }
      }
    },
    syncSettings(settings = {}) {
      if (overlay && typeof overlay.sync === 'function') {
        overlay.sync(settings);
      }
    },
  };
}
