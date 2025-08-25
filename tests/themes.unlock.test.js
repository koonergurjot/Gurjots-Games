/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { recordLastPlayed } from '../shared/ui.js';
import { getUnlocks } from '../shared/themes.js';

describe('theme unlocks based on plays', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('unlocks themes at defined play thresholds', () => {
    let unlocks = getUnlocks();
    expect(unlocks).toEqual({ minimal: true, neon: false, retro: false });

    for (let i = 0; i < 5; i++) recordLastPlayed('runner');
    unlocks = getUnlocks();
    expect(unlocks).toEqual({ minimal: true, neon: true, retro: false });

    for (let i = 0; i < 5; i++) recordLastPlayed('runner');
    unlocks = getUnlocks();
    expect(unlocks).toEqual({ minimal: true, neon: true, retro: true });
  });
});
