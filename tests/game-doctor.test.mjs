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
        slug: 'healthy-game',
        title: 'Healthy Fixture',
        firstFrame: {
          sprites: ['/assets/sprites/healthy-game.png'],
          audio: ['/assets/audio/healthy-game.mp3'],
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
        slug: 'troubled-game',
        title: 'Troubled Fixture',
        firstFrame: {
          sprites: ['/assets/sprites/missing.png'],
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

  it('lists all detected issues for unhealthy games', async () => {
    fixture = await createGameDoctorFixture('unhealthy');

    await fixture.writeJson('games.json', [
      {
        slug: 'unhealthy-game',
        title: 'Unhealthy Fixture',
        firstFrame: {
          sprites: [
            '/assets/sprites/unhealthy-game.png',
            '/assets/missing-sprite.png',
            'bad-sprite',
          ],
          audio: ['/assets/audio/unhealthy-game.mp3', 'bad-audio'],
        },
      },
    ]);

    await fixture.writeFile('assets/sprites/unhealthy-game.png', 'sprite-bytes');
    await fixture.writeJson('tools/reporters/game-doctor-manifest.json', {
      version: 1,
      requirements: {
        'unhealthy-game': 'invalid-requirements-entry',
      },
    });

    const result = await fixture.runDoctor();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Game doctor found 1 of 1 game(s) with issues');

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 0, failing: 1 });

    const [gameReport] = report.games;
    expect(gameReport.slug).toBe('unhealthy-game');
    expect(gameReport.ok).toBe(false);

    const issueMessages = gameReport.issues.map((issue) => issue.message);
    expect(issueMessages).toEqual(
      expect.arrayContaining([
        'Missing playable shell',
        'Manifest requirements entry must be an object',
        'Sprite asset missing on disk',
        'Sprite asset must live under /assets/',
        'Audio asset missing on disk',
        'Audio asset must live under /assets/',
      ]),
    );

    expect(gameReport.assets.sprites).toEqual(
      expect.arrayContaining(['assets/sprites/unhealthy-game.png']),
    );
    expect(gameReport.assets.audio).toEqual([]);

    const markdown = await fixture.readFile('health/report.md');
    expect(markdown).toContain('## Unhealthy Fixture');
    expect(markdown).toContain('- Issues:');
    expect(markdown).toContain('Missing playable shell');
    expect(markdown).toContain('Sprite asset must live under /assets/');
    expect(markdown).toContain('Audio asset must live under /assets/');
  });
});
