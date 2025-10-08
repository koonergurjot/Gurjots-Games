import { describe, expect, it } from 'vitest';
import { normalizePlayPath } from '../shared/game-path-utils.js';

describe('normalizePlayPath', () => {
  it('preserves paths that already end with .html regardless of casing', () => {
    const result = normalizePlayPath('/games/puzzle/LEVEL.HTML?foo=1#hash');
    expect(result).toBe('/games/puzzle/LEVEL.HTML?foo=1#hash');
  });

  it('appends index.html when the path does not specify an html file', () => {
    const result = normalizePlayPath('/games/puzzle/level');
    expect(result).toBe('/games/puzzle/level/index.html');
  });
});
