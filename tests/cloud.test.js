/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { mergeSnapshot, snapshot } from '../shared/cloud.js';

describe('cloud save merge', () => {
  beforeEach(() => localStorage.clear());

  it('fills in keys the device does not have', () => {
    mergeSnapshot({ 'gg:bests': '{"snake":50}' });
    expect(localStorage.getItem('gg:bests')).toBe('{"snake":50}');
  });

  it('keeps the higher best for each game and never lowers a score', () => {
    localStorage.setItem('gg:bests', JSON.stringify({ snake: 90, pong: 5 }));
    mergeSnapshot({ 'gg:bests': JSON.stringify({ snake: 50, pong: 20, tetris: 7 }) });
    expect(JSON.parse(localStorage.getItem('gg:bests'))).toEqual({ snake: 90, pong: 20, tetris: 7 });
  });

  it('ignores junk and leaves local-only keys alone', () => {
    localStorage.setItem('lastPlayed', 'pong');
    mergeSnapshot({ lastPlayed: 'snake', 'gg:bests': 5, x: null });
    mergeSnapshot(null);
    expect(localStorage.getItem('lastPlayed')).toBe('pong');
  });

  it('snapshots progress but not device settings', () => {
    localStorage.setItem('gg:bests', '{}');
    localStorage.setItem('gg:prefs', '{"sound":false}');
    const keys = Object.keys(snapshot());
    expect(keys).toContain('gg:bests');
    expect(keys).not.toContain('gg:prefs');
  });
});
