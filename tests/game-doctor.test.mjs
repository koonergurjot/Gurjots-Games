import { afterEach, describe, expect, it } from 'vitest';
import { createGameDoctorFixture } from './fixtures/game-doctor-fixture.mjs';

let fixture;

afterEach(async () => {
  if (fixture) {
    await fixture.cleanup();
    fixture = null;
  }
});

describe('tools/game-doctor.mjs', () => {
  it('produces passing reports for healthy games', async () => {
    fixture = await createGameDoctorFixture('healthy');

    await fixture.writeJson('games.json', [
      {
        id: 'healthy-game',
        slug: 'healthy-game',
        title: 'Healthy Fixture',
        short: 'A well-behaved test entry.',
        tags: ['Puzzle'],
        difficulty: 'easy',
        released: '2024-01-01',
        playUrl: '/games/healthy-game/',
        firstFrame: {
          sprites: ['/assets/sprites/healthy-game.png'],
          audio: ['/assets/audio/healthy-game.mp3'],
        },
        help: {
          objective: 'Reach a healthy state.',
          controls: 'Use the keyboard.',
          tips: ['Stay healthy.'],
          steps: ['Do the healthy thing.'],
        },
      },
    ]);

    await fixture.writeFile('games/healthy-game/index.html', '<!doctype html><title>Healthy</title>');
    await fixture.writeFile('assets/sprites/healthy-game.png', 'sprite-bytes');
    await fixture.writeFile('assets/audio/healthy-game.mp3', 'audio-bytes');
    await fixture.writeFile('assets/thumbs/healthy-game.png', 'thumb-bytes');

    const result = await fixture.runDoctor();

    expect(result.code).toBe(0);
    expect(result.stderr.trim()).toBe('');
    expect(result.stdout).toContain('Game doctor: all 1 game(s) look healthy!');

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 1, failing: 0 });
    expect(report.games).toHaveLength(1);
    expect(report.games[0].slug).toBe('healthy-game');
    expect(report.games[0].ok).toBe(true);

    const markdown = await fixture.readFile('health/report.md');
    expect(markdown).toContain('## Healthy Fixture');
    expect(markdown).toContain('- Status: ✅ Healthy');
  });

  it('fails strict mode when regressions are introduced', async () => {
    fixture = await createGameDoctorFixture('regression');

    await fixture.writeJson('games.json', [
      {
        id: 'troubled-game',
        slug: 'troubled-game',
        title: 'Troubled Fixture',
        short: 'A game with issues.',
        tags: ['Adventure'],
        difficulty: 'medium',
        released: '2024-01-01',
        playUrl: '/games/troubled-game/',
        firstFrame: {
          sprites: ['/assets/sprites/missing.png'],
        },
        help: {
          objective: 'Solve the troubles.',
          controls: 'Use mouse clicks.',
          tips: ['Beware of bugs.'],
          steps: ['Attempt to play.'],
        },
      },
    ]);

    await fixture.writeJson('health/baseline.json', {
      games: [
        {
          slug: 'troubled-game',
          ok: true,
        },
      ],
    });

    const result = await fixture.runDoctor(['--strict', '--baseline=health/baseline.json']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Game doctor strict mode detected 1 regression(s)');

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 0, failing: 1 });
    expect(report.games[0].ok).toBe(false);
    expect(report.games[0].issues.some((issue) => issue.message === 'Missing playable shell')).toBe(true);

    const markdown = await fixture.readFile('health/report.md');
    expect(markdown).toContain('## Troubled Fixture');
    expect(markdown).toContain('❌ Needs attention');
  });
});
