import { Chess } from './chess.min.js';

let game;

export function init() {
  game = new Chess();
}

export function loadFEN(fen) {
  if (!game) init();
  game.load(fen);
}

export function getLegalMoves(square) {
  if (!game) init();
  return game.moves({ square, verbose: true }).map(m => m.to);
}

export function move({ from, to, promotion }) {
  if (!game) init();
  return game.move({ from, to, promotion });
}

export function undo() {
  if (!game) return null;
  return game.undo();
}

export function fen() {
  if (!game) init();
  return game.fen();
}

export function turn() {
  if (!game) init();
  return game.turn();
}

export function inCheck() {
  return game?.in_check() ?? false;
}

export function inCheckmate() {
  return game?.in_checkmate() ?? false;
}

export function inStalemate() {
  return game?.in_stalemate() ?? false;
}

export function historySAN() {
  return game?.history() ?? [];
}

export function history() {
  return game?.history({ verbose: true }) ?? [];
}
