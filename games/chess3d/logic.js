import * as rules from "../chess/engine/rules.js";
import { bestMove, evaluate, cancel } from "./ai/simpleEngine.js";

const listeners = new Set();
let evaluatingToken = 0;

const fileRankToSquare = (file, rank) => String.fromCharCode(97 + file) + (rank + 1);

function parsePieces(fen) {
  if (typeof fen !== "string" || !fen.length) return [];
  const placement = fen.split(" ")[0] || "";
  const pieces = [];
  let rank = 7;
  let file = 0;
  for (let i = 0; i < placement.length; i += 1) {
    const ch = placement[i];
    if (ch === "/") {
      rank -= 1;
      file = 0;
      continue;
    }
    const skip = Number.parseInt(ch, 10);
    if (Number.isInteger(skip)) {
      file += skip;
      continue;
    }
    const color = ch === ch.toUpperCase() ? "w" : "b";
    const type = ch.toUpperCase();
    if (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
      pieces.push({ square: fileRankToSquare(file, rank), type, color });
    }
    file += 1;
  }
  return pieces;
}

function snapshot(meta = {}) {
  const fen = rules.fen();
  return {
    fen,
    pieces: parsePieces(fen),
    turn: rules.turn(),
    inCheck: rules.inCheck(),
    inCheckmate: rules.inCheckmate(),
    inStalemate: rules.inStalemate(),
    history: rules.historySAN(),
    ...meta,
  };
}

function notify(meta) {
  const payload = snapshot(meta);
  listeners.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("chess3d", "[Logic] listener failed", err);
    }
  });
}

export function onUpdate(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function init() {
  await rules.init();
  notify({ reason: "init" });
}

export function startNewGame() {
  rules.loadFEN(null);
  cancel();
  evaluatingToken += 1;
  notify({ reason: "new-game" });
}

export function loadFEN(fen) {
  rules.loadFEN(fen);
  cancel();
  evaluatingToken += 1;
  notify({ reason: "load-fen" });
}

export function getLegalMoves(square) {
  return rules.getLegalMoves(square);
}

export function turn() {
  return rules.turn();
}

export function historySAN() {
  return rules.historySAN();
}

export function fen() {
  return rules.fen();
}

export function applyMove({ from, to, promotion }) {
  const normalizedPromotion = typeof promotion === "string" && promotion.length
    ? promotion.toLowerCase()
    : undefined;
  const res = rules.move({ from, to, promotion: normalizedPromotion });
  if (!res?.ok) return res || { ok: false };
  notify({ reason: "move", lastMove: res.detail || null });
  return { ok: true, detail: res.detail };
}

export async function playAIMove(depth = 1) {
  const token = ++evaluatingToken;
  try {
    const { uci } = await bestMove(rules.fen(), depth);
    if (!uci || token !== evaluatingToken) return { ok: false };
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promo = uci.length > 4 ? uci.slice(4, 5) : null;
    return applyMove({ from, to, promotion: promo });
  } finally {
    if (token === evaluatingToken) cancel();
  }
}

export async function requestEvaluation(depth = 1) {
  const token = ++evaluatingToken;
  try {
    const { cp, mate, pv } = await evaluate(rules.fen(), { depth });
    if (token !== evaluatingToken) return null;
    return { cp, mate, pv };
  } catch (err) {
    if (token === evaluatingToken) throw err;
    return null;
  }
}

export function stopSearch() {
  cancel();
  evaluatingToken += 1;
}

export function undo() {
  rules.undo();
  evaluatingToken += 1;
  notify({ reason: "undo" });
}
