/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  localStorage.clear();
  return import('../shared/objectives.js');
};

describe('briefings', () => {
  it('covers every catalogued game with a premise and three objectives', async () => {
    const { BRIEFINGS } = await load();
    const catalog = JSON.parse(
      await import('node:fs').then((fs) => fs.promises.readFile('games.json', 'utf8')),
    );
    for (const game of catalog) {
      const briefing = BRIEFINGS[game.slug];
      expect(briefing, `no briefing for ${game.slug}`).toBeTruthy();
      expect(briefing.premise.length).toBeGreaterThan(30);
      expect(briefing.objectives).toHaveLength(3);
      for (const objective of briefing.objectives) {
        expect(objective.goal).toBeGreaterThan(0);
        expect(objective.label.length).toBeGreaterThan(4);
      }
    }
  });

  it('resolves the g2048 shell alias to the catalog slug', async () => {
    const { getBriefing } = await load();
    expect(getBriefing('g2048')?.title).toBe(getBriefing('2048')?.title);
    expect(getBriefing('nope')).toBeNull();
  });
});

describe('objective tracking', () => {
  beforeEach(() => localStorage.clear());

  it('completes a run objective once the goal is reached', async () => {
    const { recordGameEvent, getProgress } = await load();
    recordGameEvent({ type: 'play', slug: 'snake' });
    recordGameEvent({ type: 'score', slug: 'snake', value: 20 });
    expect(getProgress('snake').find((o) => o.id === 'snake_50').done).toBe(false);
    recordGameEvent({ type: 'score', slug: 'snake', value: 60 });
    expect(getProgress('snake').find((o) => o.id === 'snake_50').done).toBe(true);
  });

  it('resets run counters on a new run but keeps career ones', async () => {
    const { recordGameEvent, getProgress } = await load();
    recordGameEvent({ type: 'play', slug: 'snake' });
    recordGameEvent({ type: 'game_over', slug: 'snake', value: 10 });
    const career = () => getProgress('snake').find((o) => o.id === 'snake_career').have;
    expect(career()).toBe(1);

    // A new run zeroes the per-run score but the career tally carries over.
    recordGameEvent({ type: 'play', slug: 'snake' });
    expect(getProgress('snake').find((o) => o.id === 'snake_50').have).toBe(0);
    recordGameEvent({ type: 'game_over', slug: 'snake', value: 10 });
    expect(career()).toBe(2);
  });

  it('stays completed once earned', async () => {
    const { recordGameEvent, getProgress } = await load();
    recordGameEvent({ type: 'play', slug: 'pong' });
    recordGameEvent({ type: 'win', slug: 'pong' });
    expect(getProgress('pong').find((o) => o.id === 'pong_win').done).toBe(true);
    recordGameEvent({ type: 'play', slug: 'pong' });
    expect(getProgress('pong').find((o) => o.id === 'pong_win').done).toBe(true);
  });

  it('ignores events for games it has no briefing for', async () => {
    const { recordGameEvent } = await load();
    expect(recordGameEvent({ type: 'play', slug: 'nope' })).toBeNull();
    expect(recordGameEvent({})).toBeNull();
  });
});
