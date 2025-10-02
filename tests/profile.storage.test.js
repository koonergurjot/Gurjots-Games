/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function getLegacyStats() {
  try {
    return JSON.parse(localStorage.getItem('gg:xp') || '{"xp":0,"plays":0}');
  } catch {
    return { xp: 0, plays: 0 };
  }
}

describe('profile-aware storage', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    delete window.GG;
  });

  it('isolates xp and achievements per profile', async () => {
    const profileModule = await import('../shared/profile.js');
    const { login, getAggregatedStats, getProfileStatsKey } = profileModule;

    login('PlayerOne');
    await import('../js/gameUtil.js');
    const achievements = await import('../shared/achievements.js');

    window.GG.addXP(15);
    window.GG.incPlays();
    achievements.emitEvent({ type: 'play', slug: 'tetris' });

    const playerOneKey = getProfileStatsKey('PlayerOne');
    expect(JSON.parse(localStorage.getItem(playerOneKey))).toMatchObject({ xp: 15, plays: 1 });

    const playerOneStats = getAggregatedStats();
    expect(playerOneStats.xp).toBe(15);
    expect(playerOneStats.plays).toBe(1);
    expect(playerOneStats.achievements.some(a => a.id === 'first_play' && a.unlocked)).toBe(true);

    login('PlayerTwo');
    window.GG.addXP(5);
    window.GG.incPlays();
    achievements.emitEvent({ type: 'play', slug: 'pong' });

    const playerTwoKey = getProfileStatsKey('PlayerTwo');
    expect(JSON.parse(localStorage.getItem(playerTwoKey))).toMatchObject({ xp: 5, plays: 1 });

    const legacySnapshot = getLegacyStats();
    expect(legacySnapshot).toMatchObject({ xp: 5, plays: 1 });

    const playerTwoStats = getAggregatedStats();
    expect(playerTwoStats.xp).toBe(5);
    expect(playerTwoStats.plays).toBe(1);
    expect(playerTwoStats.achievements.some(a => a.id === 'first_play' && a.unlocked)).toBe(true);

    login('PlayerOne');
    const playerOneAgain = getAggregatedStats();
    expect(playerOneAgain.xp).toBe(15);
    expect(playerOneAgain.plays).toBe(1);
    expect(playerOneAgain.achievements.some(a => a.id === 'first_play' && a.unlocked)).toBe(true);

    const legacyAfterSwitch = getLegacyStats();
    expect(legacyAfterSwitch).toMatchObject({ xp: 5, plays: 1 });
  });
});
