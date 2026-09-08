// Klondike Solitaire. A standard 52-card deal: seven tableau columns, a
// stock/waste, and four suit foundations. Click a face-up card to pick it up
// (and everything legally stacked on it), then click a destination pile.
//
// Guess validation is intentionally strict on the rules (foundation order,
// alternating-colour descending tableau runs, Kings-only on empty columns)
// but permissive on everything else: no move limit, no pass limit on
// redrawing the stock, no dead-end detection. The only way this game ends is
// winning, or starting a new deal.
import { play as playSfx } from '../../shared/juice/audio.js';
import { gameEvent } from '../../shared/telemetry.js';
import { send } from '../common/diag-adapter.js';
import { drawBootPlaceholder, showErrorOverlay } from '../common/boot-utils.js';

const SLUG = 'solitaire';
const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H', 'D']);
const RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

const BASE_W = 900;
const BASE_H = 760;
const CARD_W = 100;
const CARD_H = 140;
const MARGIN = 20;
const COLUMN_GAP = 25;
const FAN_UP = 30;
const FAN_DOWN = 12;
const TABLEAU_TOP = 190;

function rankLabel(rank) {
  return RANK_LABEL[rank] || String(rank);
}

function isRed(suit) {
  return RED_SUITS.has(suit);
}

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ suit, rank, faceUp: false, id: `${suit}${rank}` });
    }
  }
  return deck;
}

// A small deterministic PRNG so a "New Game" click and a fresh page load do
// not have to agree on anything -- this only needs to be unpredictable to the
// player, not reproducible, so Math.random-backed Fisher-Yates is enough.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function boot() {
  const canvas = document.getElementById('game');
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!canvas || !ctx) {
    console.error('[solitaire] Missing canvas or 2D context');
    send('GAME_ERROR', { reason: 'no-canvas' });
    showErrorOverlay('Canvas rendering is not supported on this device.');
    return;
  }

  drawBootPlaceholder(canvas, ctx, 'Shuffling…');

  const statusEl = document.getElementById('status');
  const movesEl = document.getElementById('moves');
  const timeEl = document.getElementById('time');
  const newGameBtn = document.getElementById('newGameBtn');

  let stock = [];
  let waste = [];
  let tableau = [[], [], [], [], [], [], []];
  let foundations = { S: [], H: [], D: [], C: [] };
  let selection = null; // { zone: 'tableau'|'waste'|'foundation', index, cardIndex }
  let hitboxes = [];
  let moveCount = 0;
  let startTime = performance.now();
  let won = false;
  let foundationCardsPlaced = 0;

  function totalFoundationCards() {
    return SUITS.reduce((sum, s) => sum + foundations[s].length, 0);
  }

  function dealNewGame() {
    const deck = makeDeck();
    shuffle(deck);
    stock = [];
    waste = [];
    tableau = [[], [], [], [], [], [], []];
    foundations = { S: [], H: [], D: [], C: [] };
    selection = null;
    moveCount = 0;
    foundationCardsPlaced = 0;
    startTime = performance.now();
    won = false;

    let cursor = 0;
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row <= col; row++) {
        const card = deck[cursor++];
        card.faceUp = row === col;
        tableau[col].push(card);
      }
    }
    stock = deck.slice(cursor).map((card) => ({ ...card, faceUp: false }));

    gameEvent('play', { slug: SLUG });
    setStatus('New deal. Click the stock to draw.');
    render();
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function updateStats() {
    if (movesEl) movesEl.textContent = String(moveCount);
    if (timeEl) {
      const seconds = Math.floor((performance.now() - startTime) / 1000);
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      timeEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }
  }

  // A tableau run is valid to lift as a group iff every consecutive pair from
  // the lift point to the end alternates colour and descends by one rank.
  // Legal play only ever builds piles that already satisfy this, but check
  // anyway rather than trust it -- a single stray card should still be
  // liftable even if something upstream ever got it wrong.
  function tableauRunValid(pile, startIndex) {
    for (let i = startIndex; i < pile.length - 1; i++) {
      const a = pile[i];
      const b = pile[i + 1];
      if (b.rank !== a.rank - 1 || isRed(a.suit) === isRed(b.suit)) return false;
    }
    return true;
  }

  function canDropOnTableau(card, pile) {
    if (!pile.length) return card.rank === 13;
    const top = pile[pile.length - 1];
    return card.rank === top.rank - 1 && isRed(card.suit) !== isRed(top.suit);
  }

  function canDropOnFoundation(card, suit) {
    if (suit !== card.suit) return false;
    const pile = foundations[suit];
    if (!pile.length) return card.rank === 1;
    return card.rank === pile[pile.length - 1].rank + 1;
  }

  function clearSelection() {
    selection = null;
  }

  function drawFromStock() {
    if (stock.length) {
      const card = stock.pop();
      card.faceUp = true;
      waste.push(card);
      playSfx('click');
    } else if (waste.length) {
      // Recycle: flip the waste back into the stock, face-down, in the order
      // it will be drawn again (reverse of how it was drawn out).
      while (waste.length) {
        const card = waste.pop();
        card.faceUp = false;
        stock.push(card);
      }
      playSfx('click');
    }
    clearSelection();
    render();
  }

  function flipExposedTableauCard(col) {
    const pile = tableau[col];
    if (pile.length && !pile[pile.length - 1].faceUp) {
      pile[pile.length - 1].faceUp = true;
      playSfx('coin');
    }
  }

  function checkWin() {
    if (won) return;
    if (totalFoundationCards() === 52) {
      won = true;
      const elapsedMs = Math.round(performance.now() - startTime);
      gameEvent('win', { slug: SLUG, value: moveCount, durationMs: elapsedMs });
      setStatus(`You win! Solved in ${moveCount} moves.`);
      playSfx('power');
    }
  }

  function attemptMove(target) {
    if (!selection) return;
    const { zone, index, cardIndex } = selection;
    let sourcePile;
    if (zone === 'tableau') sourcePile = tableau[index];
    else if (zone === 'waste') sourcePile = waste;
    else sourcePile = foundations[SUITS[index]];

    const movingCards = sourcePile.slice(cardIndex);
    if (!movingCards.length) {
      clearSelection();
      return;
    }
    const head = movingCards[0];

    let moved = false;
    if (target.zone === 'foundation') {
      const suit = SUITS[target.index];
      if (movingCards.length === 1 && canDropOnFoundation(head, suit)) {
        sourcePile.splice(cardIndex);
        foundations[suit].push(head);
        foundationCardsPlaced += 1;
        gameEvent('score_event', {
          slug: SLUG,
          name: 'foundation_card',
          value: totalFoundationCards(),
        });
        moved = true;
      }
    } else if (target.zone === 'tableau') {
      const destPile = tableau[target.index];
      const isSamePile = zone === 'tableau' && index === target.index;
      if (!isSamePile && canDropOnTableau(head, destPile)) {
        sourcePile.splice(cardIndex);
        destPile.push(...movingCards);
        moved = true;
      }
    }

    if (moved) {
      moveCount += 1;
      playSfx('hit');
      if (zone === 'tableau') flipExposedTableauCard(index);
      setStatus('');
      checkWin();
    } else {
      setStatus('That move is not legal.');
    }
    clearSelection();
    render();
  }

  function handlePileClick(target) {
    if (won) return;
    if (target.zone === 'stock') {
      drawFromStock();
      return;
    }

    if (selection) {
      const isReclickingSelection =
        selection.zone === target.zone &&
        selection.index === target.index;
      if (isReclickingSelection) {
        clearSelection();
        render();
        return;
      }
      attemptMove(target);
      return;
    }

    // Nothing selected yet: try to pick up a card from the clicked pile.
    if (target.zone === 'waste') {
      if (waste.length) selection = { zone: 'waste', index: 0, cardIndex: waste.length - 1 };
    } else if (target.zone === 'foundation') {
      const pile = foundations[SUITS[target.index]];
      if (pile.length) selection = { zone: 'foundation', index: target.index, cardIndex: pile.length - 1 };
    } else if (target.zone === 'tableau') {
      const pile = tableau[target.index];
      const clickedIndex = target.cardIndex ?? pile.length - 1;
      const card = pile[clickedIndex];
      if (card && card.faceUp && tableauRunValid(pile, clickedIndex)) {
        selection = { zone: 'tableau', index: target.index, cardIndex: clickedIndex };
      } else if (card && card.faceUp) {
        // Defensive fallback: an invalid run still lets you grab the top card alone.
        selection = { zone: 'tableau', index: target.index, cardIndex: pile.length - 1 };
      }
    }
    render();
  }

  // --- Rendering -----------------------------------------------------------

  function cardColor(card) {
    return isRed(card.suit) ? '#dc2626' : '#111827';
  }

  function drawCardBack(x, y, highlighted) {
    ctx.fillStyle = '#1d4ed8';
    ctx.strokeStyle = highlighted ? '#facc15' : '#0f172a';
    ctx.lineWidth = highlighted ? 4 : 2;
    roundRect(x, y, CARD_W, CARD_H, 10);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    roundRect(x + 8, y + 8, CARD_W - 16, CARD_H - 16, 6);
    ctx.stroke();
  }

  function drawCardFace(card, x, y, highlighted) {
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = highlighted ? '#facc15' : 'rgba(15, 23, 42, 0.35)';
    ctx.lineWidth = highlighted ? 4 : 1.5;
    roundRect(x, y, CARD_W, CARD_H, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = cardColor(card);
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(rankLabel(card.rank), x + 8, y + 6);
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(SUIT_SYMBOL[card.suit], x + 8, y + 30);

    ctx.font = '40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(SUIT_SYMBOL[card.suit], x + CARD_W / 2, y + CARD_H / 2 + 6);

    ctx.save();
    ctx.translate(x + CARD_W - 8, y + CARD_H - 6);
    ctx.rotate(Math.PI);
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(rankLabel(card.rank), 0, 0);
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(SUIT_SYMBOL[card.suit], 0, 24);
    ctx.restore();
  }

  function drawEmptySlot(x, y, label) {
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.lineWidth = 2;
    roundRect(x, y, CARD_W, CARD_H, 10);
    ctx.stroke();
    if (label) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.5)';
      ctx.font = '28px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + CARD_W / 2, y + CARD_H / 2);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function isSelected(zone, index, cardIndex) {
    return !!selection && selection.zone === zone && selection.index === index &&
      (zone !== 'tableau' || cardIndex >= selection.cardIndex);
  }

  function render() {
    hitboxes = [];
    ctx.clearRect(0, 0, BASE_W, BASE_H);
    ctx.fillStyle = '#0f5132';
    ctx.fillRect(0, 0, BASE_W, BASE_H);

    // Stock
    const stockX = MARGIN;
    const topY = MARGIN;
    if (stock.length) {
      drawCardBack(stockX, topY, false);
    } else {
      drawEmptySlot(stockX, topY, '↺');
    }
    hitboxes.push({ x: stockX, y: topY, w: CARD_W, h: CARD_H, zone: 'stock' });

    // Waste
    const wasteX = MARGIN + CARD_W + 20;
    if (waste.length) {
      const card = waste[waste.length - 1];
      drawCardFace(card, wasteX, topY, isSelected('waste', 0));
      hitboxes.push({ x: wasteX, y: topY, w: CARD_W, h: CARD_H, zone: 'waste', index: 0 });
    } else {
      drawEmptySlot(wasteX, topY, '');
    }

    // Foundations
    const foundationStartX = BASE_W - MARGIN - 4 * CARD_W - 3 * COLUMN_GAP;
    SUITS.forEach((suit, i) => {
      const x = foundationStartX + i * (CARD_W + COLUMN_GAP);
      const pile = foundations[suit];
      if (pile.length) {
        drawCardFace(pile[pile.length - 1], x, topY, isSelected('foundation', i));
      } else {
        drawEmptySlot(x, topY, SUIT_SYMBOL[suit]);
      }
      hitboxes.push({ x, y: topY, w: CARD_W, h: CARD_H, zone: 'foundation', index: i });
    });

    // Tableau
    const colWidth = CARD_W + COLUMN_GAP;
    for (let col = 0; col < 7; col++) {
      const x = MARGIN + col * colWidth;
      const pile = tableau[col];
      if (!pile.length) {
        drawEmptySlot(x, TABLEAU_TOP, '');
        hitboxes.push({ x, y: TABLEAU_TOP, w: CARD_W, h: CARD_H, zone: 'tableau', index: col, cardIndex: 0 });
        continue;
      }
      let y = TABLEAU_TOP;
      for (let row = 0; row < pile.length; row++) {
        const card = pile[row];
        const isLast = row === pile.length - 1;
        if (card.faceUp) {
          drawCardFace(card, x, y, isSelected('tableau', col, row));
        } else {
          drawCardBack(x, y, false);
        }
        hitboxes.push({
          x,
          y,
          w: CARD_W,
          h: isLast ? CARD_H : (card.faceUp ? FAN_UP : FAN_DOWN),
          zone: 'tableau',
          index: col,
          cardIndex: row,
        });
        y += card.faceUp ? FAN_UP : FAN_DOWN;
      }
    }

    updateStats();
  }

  function pickHit(px, py) {
    for (let i = hitboxes.length - 1; i >= 0; i--) {
      const box = hitboxes[i];
      if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
        return box;
      }
    }
    return null;
  }

  function toLogicalPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = BASE_W / rect.width;
    const scaleY = BASE_H / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  canvas.addEventListener('click', (event) => {
    const point = toLogicalPoint(event.clientX, event.clientY);
    const hit = pickHit(point.x, point.y);
    if (hit) handlePileClick(hit);
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

  newGameBtn?.addEventListener('click', () => dealNewGame());

  window.addEventListener('keydown', (event) => {
    if (event.key === 'n' || event.key === 'N') dealNewGame();
  });

  // Keep the elapsed-time readout live even with no input.
  setInterval(() => { if (!won) updateStats(); }, 1000);

  dealNewGame();
  send('GAME_READY');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
