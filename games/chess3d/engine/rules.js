import Chess from './chess.min.js';

export let ready = true;
const game = new Chess();

export async function init() {
  // already initialized; retained for compatibility
}

export function loadFEN(fen) {
  if (!fen) game.reset();
  else game.load(fen);
}

export function getLegalMoves(square) {
  return game.moves({ square, verbose: true }).map(m => ({ from: m.from, to: m.to, promotion: m.promotion }));
}

export function move({ from, to, promotion }) {
  const res = game.move({ from, to, promotion });
  return res ? { ok: true, san: res.san, flags: res.flags } : { ok: false };
}

export function undo() { game.undo(); }
export function fen() { return game.fen(); }
export function turn() { return game.turn(); }
export function inCheck() { return game.in_check(); }
export function inCheckmate() { return game.in_checkmate(); }
export function inStalemate() { return game.in_stalemate(); }
export function historySAN() { return game.history(); }
export function history() { return game.history({ verbose: true }); }
