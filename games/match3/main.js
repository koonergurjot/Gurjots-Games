// Match-3. An 8x8 board of gems; swap two adjacent gems to line up three or
// more of the same kind. Matches clear, everything above falls to fill the
// gap, and any new match that gravity creates chains into another clear --
// each link in that chain is worth more than the last. A round ends when the
// move budget runs out; New Game starts a fresh board and budget.
import { play as playSfx } from '../../shared/juice/audio.js';
import { gameEvent } from '../../shared/telemetry.js';
import { send } from '../common/diag-adapter.js';
import { drawBootPlaceholder, showErrorOverlay } from '../common/boot-utils.js';

const SLUG = 'match3';
const GRID_SIZE = 8;
const GEM_TYPES = 6;
const STARTING_MOVES = 25;
const LEVEL_SCORE_STEP = 1000;
const CASCADE_DELAY_MS = 180;

const BASE_W = 520;
const BASE_H = 500;
const CELL = 56;
const GRID_PX = GRID_SIZE * CELL;
const GRID_X = (BASE_W - GRID_PX) / 2;
const GRID_Y = 20;

// Six shapes, each with its own color, so the game reads clearly without
// relying on color alone.
const GEM_STYLES = [
  { color: '#ef4444', shape: 'circle' },
  { color: '#3b82f6', shape: 'square' },
  { color: '#22c55e', shape: 'triangle' },
  { color: '#eab308', shape: 'diamond' },
  { color: '#a855f7', shape: 'ring' },
  { color: '#f97316', shape: 'cross' },
];

function randomType() {
  return Math.floor(Math.random() * GEM_TYPES);
}

function boot() {
  const canvas = document.getElementById('game');
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!canvas || !ctx) {
    console.error('[match3] Missing canvas or 2D context');
    send('GAME_ERROR', { reason: 'no-canvas' });
    showErrorOverlay('Canvas rendering is not supported on this device.');
    return;
  }

  drawBootPlaceholder(canvas, ctx, 'Setting the board…');

  const statusEl = document.getElementById('status');
  const movesEl = document.getElementById('moves');
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const newGameBtn = document.getElementById('newGameBtn');

  let grid = [];
  let selected = null;
  let moves = STARTING_MOVES;
  let score = 0;
  let level = 1;
  let busy = false;
  let over = false;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function updateStats() {
    if (movesEl) movesEl.textContent = String(moves);
    if (scoreEl) scoreEl.textContent = String(score);
    if (levelEl) levelEl.textContent = String(level);
  }

  // Fill the board without leaving any pre-formed match: reroll a cell's type
  // whenever the two cells to its left, or the two cells above it, already
  // agree, since a third matching cell there would auto-clear before play
  // even starts.
  function fillBoard() {
    grid = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      const row = [];
      for (let c = 0; c < GRID_SIZE; c++) {
        let type;
        do {
          type = randomType();
        } while (
          (c >= 2 && row[c - 1] === type && row[c - 2] === type) ||
          (r >= 2 && grid[r - 1][c] === type && grid[r - 2][c] === type)
        );
        row.push(type);
      }
      grid.push(row);
    }
  }

  function newGame() {
    fillBoard();
    selected = null;
    moves = STARTING_MOVES;
    score = 0;
    level = 1;
    busy = false;
    over = false;
    gameEvent('play', { slug: SLUG });
    setStatus('Swap adjacent gems to match 3 or more.');
    render();
  }

  // Every run of 3+ identical types in a row or column, collected as a set
  // of "r,c" cell keys (a cell shared by a horizontal and vertical run only
  // needs to be cleared once).
  function findMatches() {
    const matched = new Set();
    for (let r = 0; r < GRID_SIZE; r++) {
      let runStart = 0;
      for (let c = 1; c <= GRID_SIZE; c++) {
        const broke = c === GRID_SIZE || grid[r][c] !== grid[r][runStart];
        if (broke) {
          if (c - runStart >= 3) {
            for (let k = runStart; k < c; k++) matched.add(`${r},${k}`);
          }
          runStart = c;
        }
      }
    }
    for (let c = 0; c < GRID_SIZE; c++) {
      let runStart = 0;
      for (let r = 1; r <= GRID_SIZE; r++) {
        const broke = r === GRID_SIZE || grid[r][c] !== grid[runStart][c];
        if (broke) {
          if (r - runStart >= 3) {
            for (let k = runStart; k < r; k++) matched.add(`${k},${c}`);
          }
          runStart = r;
        }
      }
    }
    return matched;
  }

  function clearMatches(matched) {
    for (const key of matched) {
      const [r, c] = key.split(',').map(Number);
      grid[r][c] = null;
    }
  }

  function applyGravityAndFill() {
    for (let c = 0; c < GRID_SIZE; c++) {
      const column = [];
      for (let r = GRID_SIZE - 1; r >= 0; r--) {
        if (grid[r][c] !== null) column.push(grid[r][c]);
      }
      while (column.length < GRID_SIZE) column.push(randomType());
      for (let r = GRID_SIZE - 1; r >= 0; r--) {
        grid[r][c] = column[GRID_SIZE - 1 - r];
      }
    }
  }

  function addScore(amount) {
    const before = score;
    score += amount;
    gameEvent('score_event', { slug: SLUG, value: score });
    const beforeLevel = Math.floor(before / LEVEL_SCORE_STEP) + 1;
    const afterLevel = Math.floor(score / LEVEL_SCORE_STEP) + 1;
    if (afterLevel > beforeLevel) {
      level = afterLevel;
      gameEvent('level_up', { slug: SLUG, level });
      playSfx('power');
    }
  }

  // Try every adjacent pair on a scratch swap; if none produces a match the
  // board is stuck, and the player has no legal move left.
  function hasAnyValidMove() {
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= GRID_SIZE || nc >= GRID_SIZE) continue;
          [grid[r][c], grid[nr][nc]] = [grid[nr][nc], grid[r][c]];
          const found = findMatches().size > 0;
          [grid[r][c], grid[nr][nc]] = [grid[nr][nc], grid[r][c]];
          if (found) return true;
        }
      }
    }
    return false;
  }

  function endRoundIfOutOfMoves() {
    if (moves > 0) return;
    over = true;
    gameEvent('game_over', { slug: SLUG, value: score });
    setStatus(`Out of moves. Final score: ${score}. Click New Game to play again.`);
  }

  function resolveCascades(cascadeCount) {
    const matched = findMatches();
    if (!matched.size) {
      busy = false;
      if (!hasAnyValidMove()) {
        fillBoard();
        setStatus('No moves left on the board -- reshuffled.');
      }
      endRoundIfOutOfMoves();
      render();
      return;
    }
    clearMatches(matched);
    addScore(matched.size * 10 * cascadeCount);
    applyGravityAndFill();
    playSfx(cascadeCount > 1 ? 'coin' : 'hit');
    render();
    setTimeout(() => resolveCascades(cascadeCount + 1), CASCADE_DELAY_MS);
  }

  function attemptSwap(a, b) {
    [grid[a.r][a.c], grid[b.r][b.c]] = [grid[b.r][b.c], grid[a.r][a.c]];
    if (findMatches().size === 0) {
      // No match: put it back exactly as it was.
      [grid[a.r][a.c], grid[b.r][b.c]] = [grid[b.r][b.c], grid[a.r][a.c]];
      setStatus('No match there.');
      render();
      return;
    }
    moves -= 1;
    busy = true;
    setStatus('');
    resolveCascades(1);
  }

  function handleCellClick(r, c) {
    if (over || busy) return;
    if (!selected) {
      selected = { r, c };
      render();
      return;
    }
    if (selected.r === r && selected.c === c) {
      selected = null;
      render();
      return;
    }
    const adjacent = Math.abs(selected.r - r) + Math.abs(selected.c - c) === 1;
    if (adjacent) {
      const a = selected;
      selected = null;
      attemptSwap(a, { r, c });
    } else {
      selected = { r, c };
      render();
    }
  }

  // --- Rendering -----------------------------------------------------------

  function drawGem(x, y, type, highlighted) {
    const style = GEM_STYLES[type];
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const size = CELL * 0.36;

    if (highlighted) {
      ctx.fillStyle = 'rgba(250, 204, 21, 0.25)';
      ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    }

    ctx.fillStyle = style.color;
    ctx.strokeStyle = highlighted ? '#facc15' : 'rgba(15, 23, 42, 0.5)';
    ctx.lineWidth = highlighted ? 3 : 1.5;

    switch (style.shape) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(cx, cy, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 'square':
        ctx.beginPath();
        ctx.rect(cx - size, cy - size, size * 2, size * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 'triangle':
        ctx.beginPath();
        ctx.moveTo(cx, cy - size);
        ctx.lineTo(cx + size, cy + size);
        ctx.lineTo(cx - size, cy + size);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      case 'diamond':
        ctx.beginPath();
        ctx.moveTo(cx, cy - size);
        ctx.lineTo(cx + size, cy);
        ctx.lineTo(cx, cy + size);
        ctx.lineTo(cx - size, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      case 'ring':
        // An outline shape has no fill to carry its color, so the stroke
        // itself needs to be the gem's color rather than the border tint
        // every other shape uses -- otherwise it draws as a near-invisible
        // dark ring against the dark board.
        ctx.strokeStyle = highlighted ? '#facc15' : style.color;
        ctx.lineWidth = size * 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'cross': {
        const arm = size * 0.4;
        ctx.beginPath();
        ctx.rect(cx - arm, cy - size, arm * 2, size * 2);
        ctx.rect(cx - size, cy - arm, size * 2, arm * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      default:
        break;
    }
  }

  function render() {
    ctx.clearRect(0, 0, BASE_W, BASE_H);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, BASE_W, BASE_H);

    ctx.fillStyle = '#161c2e';
    ctx.fillRect(GRID_X, GRID_Y, GRID_PX, GRID_PX);

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const x = GRID_X + c * CELL;
        const y = GRID_Y + r * CELL;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, CELL, CELL);
        const type = grid[r][c];
        if (type !== null && type !== undefined) {
          const isSelected = !!selected && selected.r === r && selected.c === c;
          drawGem(x, y, type, isSelected);
        }
      }
    }

    updateStats();
  }

  function toLogicalPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = BASE_W / rect.width;
    const scaleY = BASE_H / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  canvas.addEventListener('click', (event) => {
    const point = toLogicalPoint(event.clientX, event.clientY);
    const c = Math.floor((point.x - GRID_X) / CELL);
    const r = Math.floor((point.y - GRID_Y) / CELL);
    if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) handleCellClick(r, c);
  });

  // The shell fits every canvas to its parent on load and again on every DOM
  // mutation (it injects its own back button, objectives chip, progression
  // badge and missions panel well after this script's first render), and
  // resizing a canvas element always clears its bitmap. Watch the attributes
  // that fit actually changes and redraw whenever it does, rather than only
  // drawing once and being wiped out by a later resize.
  new MutationObserver(() => render()).observe(canvas, {
    attributes: true,
    attributeFilter: ['width', 'height'],
  });

  newGameBtn?.addEventListener('click', () => newGame());
  window.addEventListener('keydown', (event) => {
    if (event.key === 'n' || event.key === 'N') newGame();
  });

  newGame();
  send('GAME_READY');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
