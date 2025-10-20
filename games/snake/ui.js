const STYLE_ID = 'snake-topbar-style';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .snake-topbar {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(17, 23, 53, 0.82);
      color: #e6e7ea;
      font-size: 14px;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
      transition: box-shadow 0.2s ease, transform 0.2s ease;
    }
    .snake-topbar__score {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .snake-topbar__scoreValue {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .snake-topbar__best {
      font-size: 12px;
      color: rgba(230, 231, 234, 0.75);
      letter-spacing: 0.03em;
    }
    .snake-topbar__speed {
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .snake-topbar__toggles {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .snake-topbar__toggle {
      padding: 4px 10px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(148, 163, 184, 0.14);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
    }
    .snake-topbar__toggle[data-active="off"] {
      opacity: 0.5;
      background: rgba(148, 163, 184, 0.08);
    }
    .snake-topbar--boost {
      box-shadow: 0 0 18px rgba(249, 115, 22, 0.35);
    }
    .snake-topbar--poison {
      animation: snake-topbar-warning 0.45s ease-out;
    }
    @keyframes snake-topbar-warning {
      0% { transform: translateY(0); box-shadow: 0 8px 20px rgba(0,0,0,0.35); }
      40% { transform: translateY(-2px); box-shadow: 0 0 18px rgba(239, 68, 68, 0.45); }
      100% { transform: translateY(0); box-shadow: 0 8px 20px rgba(0,0,0,0.35); }
    }
    @media (max-width: 720px) {
      .snake-topbar {
        padding: 10px;
        gap: 8px;
      }
      .snake-topbar__speed {
        font-size: 12px;
      }
    }
  `;
  document.head.appendChild(style);
}

export function initSnakeUI(initial = {}) {
  ensureStyle();
  const hud = document.querySelector('.hud');
  const bar = document.createElement('div');
  bar.className = 'snake-topbar';
  bar.innerHTML = `
    <div class="snake-topbar__score">
      <span class="snake-topbar__scoreValue" data-role="score">0</span>
      <span class="snake-topbar__best" data-role="best">Best 0</span>
    </div>
    <div class="snake-topbar__speed" data-role="speed">Speed T1</div>
    <div class="snake-topbar__toggles">
      <span class="snake-topbar__toggle" data-role="walls" data-active="on">WALLS</span>
      <span class="snake-topbar__toggle" data-role="wrap" data-active="on">WRAP</span>
    </div>
  `;
  if (hud && hud.firstChild) hud.insertBefore(bar, hud.firstChild);
  else if (hud) hud.appendChild(bar);
  else document.body.appendChild(bar);

  const scoreNode = bar.querySelector('[data-role="score"]');
  const bestNode = bar.querySelector('[data-role="best"]');
  const speedNode = bar.querySelector('[data-role="speed"]');
  const wallsNode = bar.querySelector('[data-role="walls"]');
  const wrapNode = bar.querySelector('[data-role="wrap"]');

  let warningTimer = null;
  let lastState = {
    score: 0,
    bestScore: 0,
    speedTier: 1,
    wallsEnabled: true,
    wrapEnabled: true,
    boostActive: false,
    boostRemainingMs: 0,
    ...initial
  };

  function updateTopBar(state = {}) {
    lastState = { ...lastState, ...state };
    const {
      score = 0,
      bestScore = 0,
      speedTier = 1,
      wallsEnabled = true,
      wrapEnabled = true,
      boostActive = false,
      boostRemainingMs = 0
    } = lastState;

    if (scoreNode) scoreNode.textContent = String(score);
    if (bestNode) bestNode.textContent = `Best ${bestScore}`;

    if (speedNode) {
      const pieces = [];
      if (boostActive) pieces.push('🔥');
      pieces.push(`Speed T${Math.max(1, speedTier)}`);
      if (boostActive && Number.isFinite(boostRemainingMs) && boostRemainingMs > 0) {
        const seconds = Math.max(0, boostRemainingMs) / 1000;
        pieces.push(`(${seconds.toFixed(1)}s)`);
      }
      speedNode.textContent = pieces.join(' ');
    }

    if (wallsNode) {
      wallsNode.dataset.active = wallsEnabled ? 'on' : 'off';
      wallsNode.textContent = wallsEnabled ? 'WALLS' : 'WALLS OFF';
    }
    if (wrapNode) {
      wrapNode.dataset.active = wrapEnabled ? 'on' : 'off';
      wrapNode.textContent = wrapEnabled ? 'WRAP' : 'WRAP OFF';
    }

    bar.classList.toggle('snake-topbar--boost', !!boostActive);
  }

  function flashPoisonWarning() {
    if (!bar) return;
    bar.classList.remove('snake-topbar--poison');
    // force reflow so animation retriggers
    void bar.offsetWidth;
    bar.classList.add('snake-topbar--poison');
    if (warningTimer) clearTimeout(warningTimer);
    warningTimer = setTimeout(() => {
      bar.classList.remove('snake-topbar--poison');
    }, 450);
  }

  function setBoostActive(active, durationMs = 0) {
    updateTopBar({ boostActive: !!active, boostRemainingMs: durationMs });
  }

  updateTopBar(initial);

  return {
    updateTopBar,
    flashPoisonWarning,
    setBoostActive
  };
}
