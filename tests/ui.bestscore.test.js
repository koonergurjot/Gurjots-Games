import { saveBestScore, getBestScore } from '../shared/ui.js';

describe('best score', () => {
  beforeEach(() => localStorage.clear());
  it('only saves when higher', () => {
    saveBestScore('pong', 10);
    saveBestScore('pong', 5);
    expect(getBestScore('pong')).toBe(10);
    saveBestScore('pong', 12);
    expect(getBestScore('pong')).toBe(12);
  });
});
