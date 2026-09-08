import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.resolve(process.cwd(), 'games/snake/snake.js'), 'utf8');

/**
 * Obstacle rows used to be spawned from inside the draw function, so while the
 * score sat on a multiple of ten a fresh row appeared on every animation frame
 * until the cap. They also picked a row at random with no regard for where the
 * snake was, which killed the player through no fault of their own.
 */
describe('snake obstacle rows', () => {
  it('is not spawned from the render path', () => {
    const draw = source.slice(source.indexOf('function draw'));
    const renderBlock = draw.slice(0, draw.indexOf('\nfunction ', 10));
    expect(renderBlock).not.toContain('addObstacleRow(');
  });

  it('spawns on a score threshold rather than every frame', () => {
    expect(source).toContain('function maybeAddObstacleRow()');
    expect(source).toMatch(/lastObstacleScore\s*=\s*threshold/);
  });

  it('refuses rows that sit on the snake, its path, or the food', () => {
    const fn = source.slice(source.indexOf('function addObstacleRow()'));
    const body = fn.slice(0, fn.indexOf('\nfunction '));
    expect(body).toContain('occupied.has(y)');
    expect(body).toMatch(/Math\.abs\(y - head\.y\) < OBSTACLE_SAFE_ROWS/);
    expect(body).toMatch(/food\.y === y/);
  });

  it('always leaves a gap to steer through', () => {
    const fn = source.slice(source.indexOf('function addObstacleRow()'));
    const body = fn.slice(0, fn.indexOf('\nfunction '));
    expect(body).toContain('gapStart');
    expect(source).toMatch(/const OBSTACLE_GAP = [1-9]/);
  });

  it('clears the threshold when a run resets', () => {
    expect(source.match(/lastObstacleScore = 0;/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
