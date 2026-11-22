/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { mergeSnapshot, mergeValue, snapshot } from '../shared/cloud.js';

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

  it('keeps the higher XP and play count when both devices have progress', () => {
    localStorage.setItem('gg:xp:guest', JSON.stringify({ xp: 5, plays: 1 }));
    mergeSnapshot({ 'gg:xp:guest': JSON.stringify({ xp: 500, plays: 40 }) });
    expect(JSON.parse(localStorage.getItem('gg:xp:guest'))).toEqual({ xp: 500, plays: 40 });
  });

  it('unions achievement unlocks and stats instead of discarding the cloud copy', () => {
    localStorage.setItem('achievements:default', JSON.stringify({}));
    localStorage.setItem('achstats:default', JSON.stringify({ totalPlays: 2, plays: { snake: 2 } }));
    mergeSnapshot({
      'achievements:default': JSON.stringify({ first_play: 123, ten_plays: 456 }),
      'achstats:default': JSON.stringify({ totalPlays: 12, plays: { snake: 1, pong: 11 } }),
    });
    expect(JSON.parse(localStorage.getItem('achievements:default'))).toEqual({ first_play: 123, ten_plays: 456 });
    expect(JSON.parse(localStorage.getItem('achstats:default'))).toEqual({ totalPlays: 12, plays: { snake: 2, pong: 11 } });
  });

  it('syncs mission progress stored under gg:missions:', () => {
    localStorage.setItem('gg:missions:guest', '{}');
    expect(Object.keys(snapshot())).toContain('gg:missions:guest');
  });

  it('mergeValue ORs booleans, maxes numbers and keeps local text', () => {
    expect(mergeValue({ done: false, n: 1, s: 'a' }, { done: true, n: 3, s: 'b' })).toEqual({ done: true, n: 3, s: 'a' });
  });
});
