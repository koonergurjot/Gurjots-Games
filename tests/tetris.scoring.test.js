import { describe, it, expect } from 'vitest';
import { createScoringSystem, detectTSpin } from '../games/tetris/scoring.js';
import { createRandomizerSelector, seedFromDate } from '../games/tetris/randomizer.js';

function makeGrid(filled = [], cols = 10, rows = 20) {
  const set = new Set(filled.map(([x, y]) => `${x},${y}`));
  return {
    get(x, y) {
      return set.has(`${x},${y}`) ? 1 : 0;
    },
  };
}

describe('tetris scoring system', () => {
  it('toggles back-to-back status correctly for tetrises', () => {
    const scoring = createScoringSystem();
    const first = scoring.scoreLock({ linesCleared: 4, tspin: { type: 'none', mini: false, lines: 4 } });
    expect(first.backToBack).toBe(true);
    expect(first.b2bJustAwarded).toBe(false);

    const second = scoring.scoreLock({ linesCleared: 4, tspin: { type: 'none', mini: false, lines: 4 } });
    expect(second.backToBack).toBe(true);
    expect(second.b2bJustAwarded).toBe(true);

    const single = scoring.scoreLock({ linesCleared: 1, tspin: { type: 'none', mini: false, lines: 1 } });
    expect(single.backToBack).toBe(false);

    const restart = scoring.scoreLock({ linesCleared: 4, tspin: { type: 'none', mini: false, lines: 4 } });
    expect(restart.backToBack).toBe(true);
    expect(restart.b2bJustAwarded).toBe(false);
  });

  describe('detectTSpin', () => {
    it('detects a full T-Spin Double when three corners and the front are occupied', () => {
      const grid = makeGrid([
        [4, 0],
        [6, 0],
        [4, 2],
        [6, 2],
        [6, 1],
      ]);
      const result = detectTSpin({
        piece: { t: 'T', x: 4, y: 0, o: 1 },
        grid,
        lastRotation: { kicked: true, kickIndex: 1 },
        clearedLines: 2,
        bounds: { cols: 10, rows: 20 },
      });
      expect(result.type).toBe('full');
      expect(result.mini).toBe(false);
      expect(result.lines).toBe(2);
    });

    it('flags T-Spin Mini when the front is open and a soft kick is used', () => {
      const grid = makeGrid([
        [4, 0],
        [6, 0],
        [4, 2],
      ]);
      const result = detectTSpin({
        piece: { t: 'T', x: 4, y: 0, o: 0 },
        grid,
        lastRotation: { kicked: true, kickIndex: 1 },
        clearedLines: 1,
        bounds: { cols: 10, rows: 20 },
      });
      expect(result.type).toBe('mini');
      expect(result.mini).toBe(true);
    });

    it('treats aggressive kicks as full spins even if the front is open', () => {
      const grid = makeGrid([
        [4, 0],
        [6, 0],
        [4, 2],
      ]);
      const result = detectTSpin({
        piece: { t: 'T', x: 4, y: 0, o: 0 },
        grid,
        lastRotation: { kicked: true, kickIndex: 3 },
        clearedLines: 1,
        bounds: { cols: 10, rows: 20 },
      });
      expect(result.mini).toBe(false);
      expect(result.type).toBe('full');
    });
  });
});

describe('daily seed generation', () => {
  it('produces repeatable openings for the same calendar day', () => {
    const first = seedFromDate(new Date(2024, 0, 15, 8));
    const second = seedFromDate(new Date(2024, 0, 15, 20));
    expect(first.seed).toBe(second.seed);
    expect(first.label).toBe(second.label);

    const selectorA = createRandomizerSelector({ mode: 'bag', seed: first.seed });
    const selectorB = createRandomizerSelector({ mode: 'bag', seed: second.seed });
    const sampleA = Array.from({ length: 5 }, () => selectorA.next());
    const sampleB = Array.from({ length: 5 }, () => selectorB.next());
    expect(sampleA).toEqual(sampleB);

    const nextDay = seedFromDate(new Date(2024, 0, 16, 9));
    expect(nextDay.seed).not.toBe(first.seed);
  });
});
