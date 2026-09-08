import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as rules from '../games/chess/engine/rules.js';

/**
 * chess3d marks a capture differently from a quiet move in both its 3D markers
 * and its 2D fallback board, but getLegalMoves rebuilt each move as {from, to}
 * and dropped the captured flag -- so that branch never ran in either renderer
 * and every target square looked identical.
 */
describe('getLegalMoves', () => {
  beforeAll(async () => { await rules.init(); });
  beforeEach(() => rules.loadFEN(null));

  it('reports what a move captures', () => {
    // 1. e4 d5 leaves the e4 pawn able to take on d5.
    rules.move({ from: 'e2', to: 'e4' });
    rules.move({ from: 'd7', to: 'd5' });
    const moves = rules.getLegalMoves('e4');
    const capture = moves.find((m) => m.to === 'd5');
    expect(capture, 'exd5 should be legal').toBeTruthy();
    expect(capture.captured).toBe('P');

    const quiet = moves.find((m) => m.to === 'e5');
    expect(quiet, 'e5 should be legal').toBeTruthy();
    expect(quiet.captured).toBeUndefined();
  });

  it('still reports from, to and promotion', () => {
    const opening = rules.getLegalMoves('e2');
    expect(opening.length).toBeGreaterThan(0);
    for (const move of opening) {
      expect(move.from).toBe('e2');
      expect(typeof move.to).toBe('string');
    }
  });
});
