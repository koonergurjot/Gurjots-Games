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
        playUrl: '/games/healthy-game/',
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
    expect(report.games[0].routing).toMatchObject({
      playUrl: '/games/healthy-game/',
      resolvedToShell: 'games/healthy-game/index.html',
      resolvedToPublicAsset: null,
    });

    const markdown = await fixture.readFile('health/report.md');
    expect(markdown).toContain('## Healthy Fixture');
    expect(markdown).toContain('- Status: ✅ Healthy');
    expect(markdown).toContain('- Play URL: /games/healthy-game/');
    expect(markdown).toContain('- Routing: ✅ playUrl resolves to games/healthy-game/index.html');
  });

  it('fails strict mode when regressions are introduced', async () => {
    fixture = await createGameDoctorFixture('regression');

    await fixture.writeJson('games.json', [
      {
        slug: 'troubled-game',
        title: 'Troubled Fixture',
        playUrl: '/games/troubled-game/',
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
    expect(report.games[0].issues.some((issue) => issue.message === 'Play URL does not resolve to a known shell')).toBe(
      true,
    );

    const markdown = await fixture.readFile('health/report.md');
    expect(markdown).toContain('## Troubled Fixture');
    expect(markdown).toContain('❌ Needs attention');
    expect(markdown).toContain('- Play URL: /games/troubled-game/');
    expect(markdown).toContain('Routing: ❌ playUrl did not resolve to a known shell');
  });

  it('lists all detected issues for unhealthy games', async () => {
    fixture = await createGameDoctorFixture('unhealthy');

    await fixture.writeJson('games.json', [
      {
        slug: 'unhealthy-game',
        title: 'Unhealthy Fixture',
        playUrl: '/games/unhealthy-game/',
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
        'Play URL does not resolve to a known shell',
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
    expect(markdown).toContain('Routing: ❌ playUrl did not resolve to a known shell');
    expect(markdown).toContain('Sprite asset must live under /assets/');
    expect(markdown).toContain('Audio asset must live under /assets/');
  });

  it('reports mismatched playUrl slug with remediation details', async () => {
    fixture = await createGameDoctorFixture('playurl-mismatch');

    await fixture.writeJson('games.json', [
      {
        slug: 'sluggy-game',
        title: 'Sluggy Fixture',
        playUrl: '/games/mismatch-route/',
        firstFrame: {
          sprites: ['/assets/sprites/sluggy-game.png'],
        },
      },
    ]);

    await fixture.writeFile('games/sluggy-game/index.html', '<!doctype html><title>Sluggy</title>');
    await fixture.writeFile('assets/sprites/sluggy-game.png', 'sprite-bytes');

    const result = await fixture.runDoctor();

    expect(result.code).toBe(1);

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 0, failing: 1 });
    const [gameReport] = report.games;
    expect(gameReport.slug).toBe('sluggy-game');
    expect(gameReport.routing.matchesSlug).toBe(false);
    expect(gameReport.routing.resolvedToShell).toBeNull();
    expect(gameReport.routing.resolvedToPublicAsset).toBeNull();
    const issueMessages = gameReport.issues.map((issue) => issue.message);
    expect(issueMessages).toEqual(
      expect.arrayContaining([
        'Play URL slug does not match game slug',
        'Play URL does not resolve to a known shell',
      ]),
    );

    const markdown = await fixture.readFile('health/report.md');
    expect(markdown).toContain('## Sluggy Fixture');
    expect(markdown).toContain('- Play URL: /games/mismatch-route/');
    expect(markdown).toContain('- Routing hint: playUrl slug "mismatch-route" does not match game slug "sluggy-game".');
    expect(markdown).toContain('Routing: ❌ playUrl did not resolve to a known shell');
  });

  it('validates routing when only a gameshell build exists', async () => {
    fixture = await createGameDoctorFixture('gameshell-routing');

    await fixture.writeJson('games.json', [
      {
        slug: 'shell-only',
        title: 'Shell Only Fixture',
        playUrl: '/games/shell-only/',
        firstFrame: {
          sprites: ['/assets/sprites/shell-only.png'],
        },
      },
    ]);

    await fixture.writeFile('gameshells/shell-only/index.html', '<!doctype html><title>Shell Only</title>');
    await fixture.writeFile('assets/sprites/shell-only.png', 'sprite-bytes');

    const result = await fixture.runDoctor();

    expect(result.code).toBe(0);

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 1, failing: 0 });
    const [gameReport] = report.games;
    expect(gameReport.shell.found).toBe('gameshells/shell-only/index.html');
    expect(gameReport.routing.resolvedToShell).toBe('gameshells/shell-only/index.html');

    const markdown = await fixture.readFile('health/report.md');
    expect(markdown).toContain('## Shell Only Fixture');
    expect(markdown).toContain('- Routing: ✅ playUrl resolves to gameshells/shell-only/index.html');
  });
});
