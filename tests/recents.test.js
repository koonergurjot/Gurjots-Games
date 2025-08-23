/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { recordLastPlayed } from '../shared/recents.js';

describe('recordLastPlayed', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps unique ids and caps at 10', () => {
    recordLastPlayed('a');
    recordLastPlayed('b');
    recordLastPlayed('a');
    let arr = JSON.parse(localStorage.getItem('lastPlayed'));
    expect(arr).toEqual(['a', 'b']);

    for (let i = 0; i < 15; i++) {
      recordLastPlayed(String(i));
    }
    arr = JSON.parse(localStorage.getItem('lastPlayed'));
    expect(arr).toEqual(['14', '13', '12', '11', '10', '9', '8', '7', '6', '5']);
  });
});
