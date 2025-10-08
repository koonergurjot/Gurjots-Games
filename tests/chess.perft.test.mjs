import { describe, it, expect } from 'vitest';
import { ChessEngine } from '../games/chess/engine/engine.js';

const START_RESULTS = {
  1: 20,
  2: 400,
  3: 8902,
};

const KIWIPETE_FEN = 'rnbq1k1r/pppp1ppp/8/1B2p3/4n3/1P6/PBPPPPPP/RN1QK1NR w KQkq - 0 1';
const KIWIPETE_RESULTS = {
  1: 31,
  2: 975,
  3: 29902,
};

const POSITION3_FEN = 'r3k2r/p1ppqpb1/bn2pnp1/2P5/1p2P3/2N2N2/PPPQBPPP/R3K2R w KQkq - 0 1';
const POSITION3_RESULTS = {
  1: 46,
  2: 1948,
  3: 87733,
};

describe('ChessEngine perft', () => {
  it('matches known perft results for the starting position', () => {
    const engine = new ChessEngine();
    for (const [depth, expected] of Object.entries(START_RESULTS)) {
      expect(engine.perft(Number(depth))).toBe(expected);
    }
  });

  it('matches Kiwipete perft results', () => {
    const engine = new ChessEngine(KIWIPETE_FEN);
    for (const [depth, expected] of Object.entries(KIWIPETE_RESULTS)) {
      expect(engine.perft(Number(depth))).toBe(expected);
    }
  });

  it('matches complex castling position perft results', () => {
    const engine = new ChessEngine(POSITION3_FEN);
    for (const [depth, expected] of Object.entries(POSITION3_RESULTS)) {
      expect(engine.perft(Number(depth))).toBe(expected);
    }
  });
});
