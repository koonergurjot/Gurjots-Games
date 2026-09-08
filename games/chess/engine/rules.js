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
    // Carry what the move takes. Both chess3d renderers already knew how to
    // mark a capture differently from a quiet move, but this dropped the flag,
    // so every target rendered the same and that code never ran.
    if (m.captured) move.captured = m.captured.toUpperCase();
    if (m.flags) move.flags = m.flags;
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

// The bundled chess.min.js is chess.js v1, which renamed in_check/in_checkmate/
// in_stalemate to isCheck/isCheckmate/isStalemate. This module still called the
// v0 names, so every check, checkmate and stalemate test threw
// "game.in_check is not a function" in both chess and chess3d. Accept either
// spelling so the engine keeps working whichever build is vendored.
function callEither(newName, oldName, fallback) {
  if (!game) return fallback;
  const fn = typeof game[newName] === "function" ? game[newName]
           : typeof game[oldName] === "function" ? game[oldName]
           : null;
  return fn ? fn.call(game) : fallback;
}

export function inCheck() {
  return callEither("isCheck", "in_check", false);
}

export function inCheckmate() {
  return callEither("isCheckmate", "in_checkmate", false);
}

export function inStalemate() {
  return callEither("isStalemate", "in_stalemate", false);
}

export function historySAN() {
  // Callers can reach this before init() has resolved; report an empty history
  // rather than throwing on an undefined game and taking the boot down with it.
  if (!game) return [];
  return game.history();
}
