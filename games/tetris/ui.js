import '../../shared/ui/hud.js';

const STYLE_ID = 'tetris-hud-style';

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

export function createHud({ onToggleDailySeed } = {}){
  if (typeof document === 'undefined') return null;
  ensureStyle();
  const host = resolveHudContainer();
  if (!host) return null;
  host.innerHTML = `
    <div class="tetris-hud" aria-live="polite">
      <section class="tetris-hud__panel tetris-hud__panel--stats">
        <header class="tetris-hud__header">
          <h2>Mission Control</h2>
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

  if (dailyToggle) {
    dailyToggle.addEventListener('change', event => {
      if (typeof onToggleDailySeed === 'function') {
        onToggleDailySeed(event.target.checked);
      }
    });
  }

  renderPiece(holdNode, null);
  renderPieceList(nextNode, []);

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
  };
}
