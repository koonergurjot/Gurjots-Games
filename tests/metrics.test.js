/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startSessionTimer, endSessionTimer } from '../shared/metrics.js';

describe('metrics session timing', () => {
  let originalNow;
  beforeEach(() => {
    localStorage.clear();
    originalNow = performance.now;
  });
  afterEach(() => {
    performance.now = originalNow;
  });

  it('records time when switching between sessions', () => {
    let now = 0;
    performance.now = () => now;

    startSessionTimer('first');
    now = 500;
    startSessionTimer('second');
    now = 800;
    endSessionTimer('second');
    endSessionTimer('first');

    expect(localStorage.getItem('time:first')).toBe('500');
    expect(localStorage.getItem('time:second')).toBe('300');
  });

  it('ends the current session when slug is omitted', () => {
    let now = 0;
    performance.now = () => now;

    startSessionTimer('only');
    now = 250;
    endSessionTimer();

    expect(localStorage.getItem('time:only')).toBe('250');
  });
});
