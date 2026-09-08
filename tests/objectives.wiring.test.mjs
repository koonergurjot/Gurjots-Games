/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BRIEFINGS } from '../shared/objectives.js';

/**
 * An objective is only real if the game reports the event it counts. Nothing
 * fails loudly when it does not -- the objective simply never completes -- so
 * pin the contract here instead. Four of these were dead when the briefings
 * first landed.
 */
// A slug maps to one or more source files: shooter and runner each cover two
// modes (Campaign/Arena, Campaign/Night Rush) split across separate engines
// that share one catalog entry and one telemetry slug.
const ENTRY_POINTS = {
  pong: ['games/pong/pong.js'],
  snake: ['games/snake/snake.js'],
  tetris: ['games/tetris/tetris.js'],
  breakout: ['games/breakout/breakout.js'],
  chess: ['games/chess/chess.js'],
  chess3d: ['games/chess3d/main.js'],
  2048: ['games/2048/g2048.js'],
  asteroids: ['games/asteroids/main.js'],
  maze3d: ['games/maze3d/main-3d.js'],
  platformer: ['games/platformer/main.js', 'games/platformer/practice/main.js'],
  runner: ['games/runner/main.js', 'games/runner/night/main.js'],
  shooter: ['games/shooter/main.js', 'games/shooter/arena/main.js'],
  solitaire: ['games/solitaire/main.js'],
};

function emittedEvents(files) {
  const events = new Set();
  for (const file of files) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    for (const m of source.matchAll(/gameEvent\(\s*['"]([a-z_]+)['"]/g)) {
      events.add(m[1]);
    }
    // Several games pick the event name at the call site: gameEvent(result, ...)
    // or gameEvent(outcome, ...), where the value is 'win' or 'lose'.
    if (/gameEvent\(\s*(result|outcome)\b/.test(source)) {
      events.add('win');
      events.add('lose');
    }
    if (/gameEvent\(\s*result === 'win'/.test(source)) {
      events.add('win');
      events.add('lose');
    }
  }
  return events;
}

describe('objective wiring', () => {
  it('covers every game in the briefing table', () => {
    expect(Object.keys(ENTRY_POINTS).sort()).toEqual(Object.keys(BRIEFINGS).sort());
  });

  for (const [slug, files] of Object.entries(ENTRY_POINTS)) {
    it(`${slug} emits every event its objectives count`, () => {
      const events = emittedEvents(files);
      const missing = BRIEFINGS[slug].objectives
        .filter((objective) => objective.kind !== 'run_score')
        .filter((objective) => !events.has(objective.event))
        .map((objective) => `${objective.id} needs ${objective.event}`);
      expect(missing).toEqual([]);
    });
  }
});
