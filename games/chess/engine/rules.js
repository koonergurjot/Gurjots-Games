import * as ChessModule from "./chess.min.js";

export let ready = false;
let game;

export async function init() {
  const ChessCtor = ChessModule.default || ChessModule.Chess || ChessModule;
  game = new ChessCtor();
  ready = true;
}

export function loadFEN(fenOrNullToReset) {
  if (fenOrNullToReset == null) game.reset();
  else game.load(fenOrNullToReset);
}

export function getLegalMoves(square) {
  return game.moves({ square, verbose: true }).map(m => {
    const move = { from: m.from, to: m.to };
    if (m.promotion) move.promotion = m.promotion;
    return move;
  });
}

export function move({ from, to, promotion }) {
  const res = game.move({ from, to, promotion });
  if (!res) return { ok: false };
  const detail = {
    color: res.color,
    from: res.from,
    to: res.to,
    piece: res.piece?.toUpperCase?.() || res.piece,
    san: res.san,
    flags: res.flags,
    promotion: res.promotion ? res.promotion.toUpperCase() : null,
    captured: res.captured ? res.captured.toUpperCase() : null,
  };
  return { ok: true, san: res.san, flags: res.flags, detail };
}

export const _internal = { get game(){ return game; } };

export function undo() {
  game.undo();
}

export function fen() {
  return game.fen();
}

export function turn() {
  return game.turn();
}

export function inCheck() {
  return game.in_check();
}

export function inCheckmate() {
  return game.in_checkmate();
}

export function inStalemate() {
  return game.in_stalemate();
}

export function historySAN() {
  return game.history();
}
