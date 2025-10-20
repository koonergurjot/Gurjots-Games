const STYLE_ID = 'chess3d-fallback-style';

const GLYPHS = {
  w: { P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔' },
  b: { P: '♟', N: '♞', B: '♝', R: '♜', Q: '♛', K: '♚' },
};

const COLORS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .fallback-board {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 16px;
      width: 100%;
      box-sizing: border-box;
      background: linear-gradient(180deg, rgba(10,14,24,0.92) 0%, rgba(9,12,20,0.94) 100%);
      border-radius: 16px;
      border: 1px solid rgba(180, 198, 255, 0.2);
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
      color: #f5f7ff;
      text-align: center;
    }
    .fallback-board__message {
      font-size: clamp(16px, 2.6vw, 20px);
      font-weight: 600;
      letter-spacing: 0.02em;
      text-shadow: 0 1px 0 rgba(0,0,0,0.4);
    }
    .fallback-board__turn {
      font-size: clamp(14px, 2.2vw, 18px);
      opacity: 0.85;
    }
    .fallback-board__grid {
      display: grid;
      grid-template-columns: repeat(8, minmax(0, 1fr));
      grid-template-rows: repeat(8, minmax(0, 1fr));
      width: min(90vw, 420px);
      aspect-ratio: 1 / 1;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08), 0 16px 32px rgba(0,0,0,0.35);
    }
    .fallback-board__square {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: clamp(22px, 4.5vw, 34px);
      user-select: none;
      transition: background-color 0.18s ease, transform 0.15s ease;
      cursor: pointer;
    }
    .fallback-board__square--light {
      background: linear-gradient(145deg, #f3f5ff 0%, #d4daea 100%);
      color: #121726;
    }
    .fallback-board__square--dark {
      background: linear-gradient(145deg, #3f485f 0%, #242a3b 100%);
      color: #e8ecff;
    }
    .fallback-board__square--selected {
      outline: 3px solid rgba(255, 197, 97, 0.9);
      outline-offset: -3px;
      z-index: 1;
    }
    .fallback-board__square--target::after {
      content: '';
      position: absolute;
      width: 34%;
      height: 34%;
      border-radius: 50%;
      background: rgba(92, 201, 116, 0.85);
      box-shadow: 0 0 12px rgba(92, 201, 116, 0.6);
    }
    .fallback-board__square--capture::after {
      content: '';
      position: absolute;
      inset: 12%;
      border-radius: 50%;
      border: 3px solid rgba(234, 95, 95, 0.9);
      box-shadow: 0 0 16px rgba(234, 95, 95, 0.55);
    }
    .fallback-board__square--lastmove {
      box-shadow: inset 0 0 0 3px rgba(255, 233, 119, 0.7);
    }
    .fallback-board__square--hover {
      box-shadow: inset 0 0 0 2px rgba(120, 180, 255, 0.5);
    }
    .fallback-board__square:focus-visible {
      outline: 3px solid rgba(120, 180, 255, 0.8);
      outline-offset: -3px;
    }
  `;
  document.head.appendChild(style);
}

function createSquareElements() {
  const squares = new Map();
  for (let rank = 7; rank >= 0; rank -= 1) {
    for (let file = 0; file < 8; file += 1) {
      const square = `${COLORS[file]}${rank + 1}`;
      squares.set(square, null);
    }
  }
  return squares;
}

export function mountFallbackBoard({ container, message = 'WebGL unavailable. Showing simplified board.' } = {}) {
  if (!container || typeof document === 'undefined') {
    return {
      setRulesApi() {},
      updateSnapshot() {},
      setMessage() {},
    };
  }

  ensureStyles();
  const wrapper = document.createElement('div');
  wrapper.className = 'fallback-board';

  const messageEl = document.createElement('div');
  messageEl.className = 'fallback-board__message';
  messageEl.textContent = message;

  const turnEl = document.createElement('div');
  turnEl.className = 'fallback-board__turn';
  turnEl.textContent = 'Preparing board…';

  const grid = document.createElement('div');
  grid.className = 'fallback-board__grid';

  const squareEls = createSquareElements();
  const boardState = new Map();
  const state = {
    selected: null,
    legalTargets: [],
    rulesApi: null,
    lastMoveSquares: [],
  };

  squareEls.forEach((_, square) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;
    const isLight = (file + rank) % 2 === 0;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `fallback-board__square ${isLight ? 'fallback-board__square--light' : 'fallback-board__square--dark'}`;
    el.dataset.square = square;
    el.setAttribute('aria-label', `Square ${square}`);
    el.addEventListener('click', () => handleSquareClick(square));
    el.addEventListener('focus', () => highlightSquare(square));
    el.addEventListener('blur', clearHoverHighlight);
    grid.appendChild(el);
    squareEls.set(square, el);
  });

  wrapper.appendChild(messageEl);
  wrapper.appendChild(turnEl);
  wrapper.appendChild(grid);
  container.appendChild(wrapper);

  function clearHoverHighlight() {
    squareEls.forEach((el) => el.classList.remove('fallback-board__square--hover'));
  }

  function highlightSquare(square) {
    clearHoverHighlight();
    const el = squareEls.get(square);
    if (el) el.classList.add('fallback-board__square--hover');
  }

  function setMessage(text) {
    messageEl.textContent = text;
  }

  function setTurnLabel(turn) {
    if (!turnEl) return;
    if (turn === 'b') {
      turnEl.textContent = 'Black to move';
    } else if (turn === 'w') {
      turnEl.textContent = 'White to move';
    } else {
      turnEl.textContent = 'Waiting for move…';
    }
  }

  function clearSelection() {
    state.selected = null;
    state.legalTargets = [];
    squareEls.forEach((el) => {
      el.classList.remove('fallback-board__square--selected', 'fallback-board__square--target', 'fallback-board__square--capture');
    });
  }

  function refreshSelection() {
    squareEls.forEach((el) => {
      el.classList.remove('fallback-board__square--selected', 'fallback-board__square--target', 'fallback-board__square--capture');
    });
    if (!state.selected) return;
    const selectedEl = squareEls.get(state.selected);
    selectedEl?.classList.add('fallback-board__square--selected');
    state.legalTargets.forEach((move) => {
      const targetEl = squareEls.get(move.to);
      if (!targetEl) return;
      if (move.captured) {
        targetEl.classList.add('fallback-board__square--capture');
      } else {
        targetEl.classList.add('fallback-board__square--target');
      }
    });
  }

  function updateBoardPieces(pieces = []) {
    boardState.clear();
    pieces.forEach((piece) => {
      if (!piece || typeof piece.square !== 'string') return;
      boardState.set(piece.square, piece);
    });
    squareEls.forEach((el, square) => {
      const piece = boardState.get(square);
      const glyph = piece ? GLYPHS[piece.color]?.[piece.type] || '' : '';
      el.textContent = glyph;
      if (piece) {
        el.dataset.color = piece.color;
      } else {
        delete el.dataset.color;
      }
    });
  }

  function updateLastMove(lastMove) {
    squareEls.forEach((el) => el.classList.remove('fallback-board__square--lastmove'));
    state.lastMoveSquares = [];
    if (!lastMove) return;
    const { from, to } = lastMove;
    if (typeof from === 'string') {
      squareEls.get(from)?.classList.add('fallback-board__square--lastmove');
      state.lastMoveSquares.push(from);
    }
    if (typeof to === 'string') {
      squareEls.get(to)?.classList.add('fallback-board__square--lastmove');
      state.lastMoveSquares.push(to);
    }
  }

  function ensureRules() {
    return state.rulesApi && typeof state.rulesApi.getLegalMoves === 'function';
  }

  async function handleSquareClick(square) {
    if (!ensureRules()) return;
    const piece = boardState.get(square);
    const turn = state.rulesApi?.turn?.();
    const isOwnPiece = piece && (!turn || piece.color === turn);

    if (!state.selected) {
      if (!isOwnPiece) return;
      const moves = state.rulesApi.getLegalMoves(square) || [];
      if (!moves.length) return;
      state.selected = square;
      state.legalTargets = moves;
      refreshSelection();
      return;
    }

    if (square === state.selected) {
      clearSelection();
      return;
    }

    const legal = (state.legalTargets || []).find((m) => m.to === square);
    if (!legal) {
      if (isOwnPiece) {
        const moves = state.rulesApi.getLegalMoves(square) || [];
        state.selected = square;
        state.legalTargets = moves;
        refreshSelection();
      } else {
        clearSelection();
      }
      return;
    }

    let promotion;
    if (legal.promotion) {
      try {
        const { openPromotion } = await import('../ui/promotionModal.js');
        promotion = await openPromotion(state.rulesApi?.turn?.());
      } catch (err) {
        console?.warn?.('chess3d', '[FallbackBoard] promotion dialog failed', err);
      }
    }
    try {
      state.rulesApi.move({ from: state.selected, to: square, promotion });
    } catch (err) {
      console?.warn?.('chess3d', '[FallbackBoard] move failed', err);
    }
    clearSelection();
  }

  function updateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const pieces = Array.isArray(snapshot.pieces) ? snapshot.pieces : [];
    updateBoardPieces(pieces);
    updateLastMove(snapshot.lastMove);
    const turn = snapshot.turn || state.rulesApi?.turn?.();
    setTurnLabel(turn);
    refreshSelection();
  }

  function setRulesApi(rulesApi) {
    state.rulesApi = rulesApi || null;
    try {
      const turn = state.rulesApi?.turn?.();
      setTurnLabel(turn);
    } catch (_) {
      setTurnLabel('w');
    }
  }

  return {
    element: wrapper,
    setRulesApi,
    updateSnapshot,
    setMessage,
    destroy() {
      wrapper.remove();
    },
  };
}
