/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  return import('../shared/progression.js');
};

afterEach(() => vi.useRealTimers());

describe('progression curve', () => {
  it('spends more XP on each successive level', async () => {
    const { xpForLevel } = await load();
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(250);
    const costs = [2, 3, 4, 5, 6].map(n => xpForLevel(n) - xpForLevel(n - 1));
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(costs).size).toBe(costs.length);
  });

  it('maps XP onto the level it has paid for', async () => {
    const { levelForXp } = await load();
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(249)).toBe(2);
    expect(levelForXp(250)).toBe(3);
  });

  it('reports progress through the current level', async () => {
    const { progressForXp } = await load();
    const at150 = progressForXp(150);
    expect(at150.level).toBe(2);
    expect(at150.into).toBe(50);
    expect(at150.needed).toBe(150);
    expect(at150.remaining).toBe(100);
    expect(at150.ratio).toBeCloseTo(1 / 3, 5);
  });

  it('treats missing or nonsense XP as zero rather than NaN', async () => {
    const { progressForXp } = await load();
    for (const value of [undefined, null, NaN, -20, 'abc']) {
      const p = progressForXp(value);
      expect(p.level).toBe(1);
      expect(Number.isFinite(p.ratio)).toBe(true);
    }
  });
});

describe('awarding XP', () => {
  beforeEach(() => localStorage.clear());

  it('accumulates XP and reports levels crossed', async () => {
    const { awardXp } = await load();
    expect(awardXp(40).level).toBe(1);
    const crossed = awardXp(70);
    expect(crossed.level).toBe(2);
    expect(crossed.levelsGained).toBe(1);
    expect(crossed.xp).toBe(110);
  });

  it('reports every unlock crossed in one award, not just the last', async () => {
    const { awardXp, UNLOCKS } = await load();
    const jump = awardXp(1000);
    expect(jump.level).toBe(6);
    const expected = UNLOCKS.filter(u => u.level <= 6).map(u => u.id);
    expect(jump.unlocked.map(u => u.id)).toEqual(expected);
  });

  it('ignores non-positive and malformed awards', async () => {
    const { awardXp } = await load();
    for (const value of [0, -5, NaN, undefined, 'x']) {
      expect(awardXp(value).gained).toBe(0);
    }
    expect(awardXp(10).xp).toBe(10);
  });
});

describe('personal bests', () => {
  beforeEach(() => localStorage.clear());

  it('only records a score that beats the stored one', async () => {
    const { recordBest, getBest } = await load();
    expect(recordBest('pong', 10)).toMatchObject({ best: 10, improved: true });
    expect(recordBest('pong', 5).improved).toBe(false);
    expect(recordBest('pong', 10).improved).toBe(false);
    expect(recordBest('pong', 11).improved).toBe(true);
    expect(getBest('pong')).toBe(11);
    expect(getBest('snake')).toBe(0);
  });
});

describe('gameplay events', () => {
  beforeEach(() => localStorage.clear());

  it('pays a bonus the first time a score is beaten', async () => {
    const { recordGameEvent } = await load();
    const first = recordGameEvent({ type: 'game_over', slug: 'snake', value: 100 });
    // 5 for finishing, 2 from the score, 50 for the personal best.
    expect(first.reason).toBe('personal_best');
    expect(first.gained).toBe(57);
  });

  it('still pays for finishing a run that beat nothing', async () => {
    const { recordGameEvent } = await load();
    recordGameEvent({ type: 'game_over', slug: 'snake', value: 100 });
    vi.setSystemTime(Date.now() + 5000);
    const worse = recordGameEvent({ type: 'game_over', slug: 'snake', value: 40 });
    expect(worse.reason).toBe('run_end');
    expect(worse.gained).toBe(5);
  });

  it('pays a finished run once even when a game emits several end events', async () => {
    const { recordGameEvent, getState } = await load();
    // The runner sends game_over, lose and end back to back for one death.
    recordGameEvent({ type: 'game_over', slug: 'runner', value: 0 });
    recordGameEvent({ type: 'lose', slug: 'runner' });
    recordGameEvent({ type: 'end', slug: 'runner', value: 0 });
    expect(getState().xp).toBe(5);
  });

  it('caps the XP a single huge score can pay out', async () => {
    const { recordGameEvent } = await load();
    const huge = recordGameEvent({ type: 'game_over', slug: 'tetris', value: 10_000_000 });
    expect(huge.gained).toBe(5 + 60 + 50);
  });

  it('never pays for an in-run score tick', async () => {
    const { recordGameEvent, getState } = await load();
    // The runner reports its rising score every frame. Paying anything here --
    // even only when it beats the stored best -- awards XP per frame, which put
    // a single six-second run at level 8.
    for (let score = 1; score <= 200; score++) {
      expect(recordGameEvent({ type: 'score', slug: 'runner', value: score })).toBeNull();
    }
    expect(getState().xp).toBe(0);
  });

  it('counts a play and ignores events it has no rule for', async () => {
    const { recordGameEvent, getState } = await load();
    recordGameEvent({ type: 'play', slug: 'pong' });
    expect(getState().plays).toBe(1);
    expect(getState().xp).toBe(5);
    expect(recordGameEvent({ type: 'score_event', slug: 'pong' })).toBeNull();
    expect(recordGameEvent({})).toBeNull();
  });
});

describe('unlocks', () => {
  beforeEach(() => localStorage.clear());

  it('gates by level and rejects unknown ids', async () => {
    const { awardXp, isUnlocked, getUnlocked } = await load();
    expect(isUnlocked('theme:neon')).toBe(false);
    awardXp(xpToLevel(2));
    expect(isUnlocked('theme:neon')).toBe(true);
    expect(isUnlocked('mode:hardcore')).toBe(false);
    expect(isUnlocked('theme:nonexistent')).toBe(false);
    expect(getUnlocked()).toContain('theme:neon');
  });
});

function xpToLevel(level) {
  return ((level - 1) * (200 + (level - 2) * 50)) / 2;
}
