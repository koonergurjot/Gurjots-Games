import * as ChessModule from "../../chess/engine/chess.min.js";

const Chess = ChessModule.default || ChessModule.Chess || ChessModule;

const PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

function evaluateBoard(game) {
  let score = 0;
  const board = game.board();
  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      const value = PIECE_VALUES[piece.type] || 0;
      score += piece.color === "w" ? value : -value;
    }
  }
  return score;
}

function minimax(depth, game, alpha, beta, isMaximisingPlayer) {
  if (depth === 0 || game.game_over()) {
    return evaluateBoard(game);
  }
  const moves = game.moves({ verbose: true });
  if (isMaximisingPlayer) {
    let maxEval = -Infinity;
    for (const move of moves) {
      game.move(move);
      const evalScore = minimax(depth - 1, game, alpha, beta, false);
      game.undo();
      if (evalScore > maxEval) maxEval = evalScore;
      if (evalScore > alpha) alpha = evalScore;
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      game.move(move);
      const evalScore = minimax(depth - 1, game, alpha, beta, true);
      game.undo();
      if (evalScore < minEval) minEval = evalScore;
      if (evalScore < beta) beta = evalScore;
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function minimaxRoot(depth, game) {
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;
  const isMaximisingPlayer = game.turn() === "w";
  let bestMove = null;
  let bestValue = isMaximisingPlayer ? -Infinity : Infinity;
  for (const move of moves) {
    game.move(move);
    const value = minimax(depth - 1, game, -Infinity, Infinity, !isMaximisingPlayer);
    game.undo();
    if (isMaximisingPlayer ? value > bestValue : value < bestValue) {
      bestValue = value;
      bestMove = move;
    }
  }
  return bestMove;
}

function moveToUci(move) {
  if (!move) return null;
  return move.from + move.to + (move.promotion ? move.promotion : "");
}

export async function bestMove(fen, depth = 2) {
  const game = new Chess();
  game.load(fen);
  const move = minimaxRoot(depth, game);
  return { uci: moveToUci(move) };
}

export async function evaluate(fen, { depth } = {}) {
  const game = new Chess();
  game.load(fen);
  const cp = evaluateBoard(game);
  return { cp, mate: null, pv: null };
}

export async function initEngine() {
  return;
}

export function cancel() {
  return;
}

