/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { getLocalLeaderboard } from '../shared/ui.js';

describe('getLocalLeaderboard', () => {
  beforeEach(() => localStorage.clear());
  it('returns sorted valid entries', () => {
    localStorage.setItem('leaderboard:pong', JSON.stringify([
      { name: 'A', score: 5 },
      { name: 'B', score: 12 },
      { name: 'C', score: 7 },
      { name: 'D', score: 'x' }
    ]));
    expect(getLocalLeaderboard('pong')).toEqual([
      { name: 'B', score: 12 },
      { name: 'C', score: 7 },
      { name: 'A', score: 5 }
    ]);
  });
  it('handles missing or invalid data', () => {
    expect(getLocalLeaderboard('pong')).toEqual([]);
    localStorage.setItem('leaderboard:pong', 'not-json');
    expect(getLocalLeaderboard('pong')).toEqual([]);
  });
});
