/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { saveBestScore, getBestScore } from '../shared/ui.js';

describe('best score', () => {
  beforeEach(() => localStorage.clear());
  it('returns null when missing or invalid', () => {
    expect(getBestScore('pong')).toBeNull();
    localStorage.setItem('bestScore:pong', 'not-a-number');
    expect(getBestScore('pong')).toBeNull();
  });
  it('only saves when higher', () => {
    saveBestScore('pong', 10);
    saveBestScore('pong', 5);
    expect(getBestScore('pong')).toBe(10);
    saveBestScore('pong', 12);
    expect(getBestScore('pong')).toBe(12);
  });
});
