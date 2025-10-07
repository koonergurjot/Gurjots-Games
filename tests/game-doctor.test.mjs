import { afterEach, describe, expect, it } from 'vitest';
import { createGameDoctorFixture } from './fixtures/game-doctor-fixture.mjs';

function buildGameEntry(slug, overrides = {}) {
  const base = {
    id: slug,
    slug,
    title: `${slug} title`,
    short: 'Short description',
    tags: ['arcade'],
    difficulty: 'easy',
    released: '2024-01-01',
    playUrl: `/games/${slug}/`,
    firstFrame: {
      sprites: [`/assets/sprites/${slug}.png`],
      audio: [`/assets/audio/${slug}.mp3`],
    },
    help: {
      objective: 'Score points',
      controls: 'Arrow keys',
      tips: ['Have fun'],
      steps: ['Start'],
    },
  };
  return { ...base, ...overrides };
}

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
      buildGameEntry('healthy-game', {
        title: 'Healthy Fixture',
      }),
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
      buildGameEntry('troubled-game', {
        title: 'Troubled Fixture',
        playUrl: '/games/troubled-game/',
        firstFrame: {
          sprites: ['/assets/sprites/missing.png'],
        },
      }),
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

  it('filters validation to requested slugs', async () => {
    fixture = await createGameDoctorFixture('slug-filter');

    await fixture.writeJson('games.json', [
      buildGameEntry('keep-me', {
        title: 'Keep Me',
      }),
      buildGameEntry('skip-me', {
        title: 'Skip Me',
      }),
    ]);

    await fixture.writeFile('games/keep-me/index.html', '<!doctype html><title>Keep</title>');
    await fixture.writeFile('assets/sprites/keep-me.png', 'sprite-bytes');
    await fixture.writeFile('assets/audio/keep-me.mp3', 'audio-bytes');
    await fixture.writeFile('assets/thumbs/keep-me.png', 'thumb-bytes');

    const result = await fixture.runDoctor(['--slug=keep-me']);

    expect(result.code).toBe(0);
    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 1, failing: 0 });
    expect(report.games).toHaveLength(1);
    expect(report.games[0].slug).toBe('keep-me');
  });

  it('fails when requested slugs are missing from the catalog', async () => {
    fixture = await createGameDoctorFixture('missing-slug');

    await fixture.writeJson('games.json', [buildGameEntry('exists')]);

    const result = await fixture.runDoctor(['--slug=ghost']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('requested slug(s) not found');
  });

  it('targets changed slugs when sprite assets referenced by games are removed', async () => {
    fixture = await createGameDoctorFixture('changed-sprite');

    await fixture.writeJson(
      'games.json',
      [
        buildGameEntry('asset-game', {
          firstFrame: {
            sprites: ['/assets/sprites/shared/hero.png'],
            audio: ['/assets/audio/shared/hit.mp3'],
          },
        }),
      ],
    );

    await fixture.writeFile('games/asset-game/index.html', '<!doctype html><title>Asset Game</title>');
    await fixture.writeFile('assets/sprites/shared/hero.png', 'sprite-bytes');
    await fixture.writeFile('assets/audio/shared/hit.mp3', 'audio-bytes');
    await fixture.writeFile('assets/thumbs/asset-game.png', 'thumb-bytes');

    await fixture.initGitRepo();
    await fixture.runGit(['checkout', '-b', 'remove-sprite']);
    await fixture.runGit(['rm', 'assets/sprites/shared/hero.png']);
    await fixture.runGit(['commit', '-m', 'Remove sprite asset']);

    const result = await fixture.runDoctor(['--changed']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('targeting 1 changed game slug(s)');
    expect(result.stderr).toContain('Game doctor found 1 of 1 game(s) with issues');

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 0, failing: 1 });
    expect(report.games[0].slug).toBe('asset-game');
    expect(
      report.games[0].issues.some((issue) => issue.message === 'Sprite asset missing on disk'),
    ).toBe(true);
  });

  it('targets changed slugs when audio assets referenced by games are removed', async () => {
    fixture = await createGameDoctorFixture('changed-audio');

    await fixture.writeJson(
      'games.json',
      [
        buildGameEntry('asset-audio', {
          firstFrame: {
            sprites: ['/assets/sprites/asset-audio.png'],
            audio: ['/assets/audio/shared/theme.mp3'],
          },
        }),
      ],
    );

    await fixture.writeFile('games/asset-audio/index.html', '<!doctype html><title>Asset Audio</title>');
    await fixture.writeFile('assets/sprites/asset-audio.png', 'sprite-bytes');
    await fixture.writeFile('assets/audio/shared/theme.mp3', 'audio-bytes');
    await fixture.writeFile('assets/thumbs/asset-audio.png', 'thumb-bytes');

    await fixture.initGitRepo();
    await fixture.runGit(['checkout', '-b', 'remove-audio']);
    await fixture.runGit(['rm', 'assets/audio/shared/theme.mp3']);
    await fixture.runGit(['commit', '-m', 'Remove audio asset']);

    const result = await fixture.runDoctor(['--changed']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('targeting 1 changed game slug(s)');
    expect(result.stderr).toContain('Game doctor found 1 of 1 game(s) with issues');

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 0, failing: 1 });
    expect(report.games[0].slug).toBe('asset-audio');
    expect(
      report.games[0].issues.some((issue) => issue.message === 'Audio asset missing on disk'),
    ).toBe(true);
  });

  it('targets all games referencing a shared asset when it changes', async () => {
    fixture = await createGameDoctorFixture('shared-asset');

    await fixture.writeJson(
      'games.json',
      [
        buildGameEntry('slug-a', {
          title: 'Slug A',
          firstFrame: {
            sprites: ['/assets/sprites/shared/shared-hero.png'],
            audio: ['/assets/audio/slug-a.mp3'],
          },
        }),
        buildGameEntry('slug-b', {
          title: 'Slug B',
          firstFrame: {
            sprites: ['/assets/sprites/shared/shared-hero.png'],
            audio: ['/assets/audio/slug-b.mp3'],
          },
        }),
      ],
    );

    await fixture.writeFile('games/slug-a/index.html', '<!doctype html><title>Slug A</title>');
    await fixture.writeFile('games/slug-b/index.html', '<!doctype html><title>Slug B</title>');

    await fixture.writeFile('assets/sprites/shared/shared-hero.png', 'sprite-bytes');
    await fixture.writeFile('assets/audio/slug-a.mp3', 'audio-a');
    await fixture.writeFile('assets/audio/slug-b.mp3', 'audio-b');
    await fixture.writeFile('assets/thumbs/slug-a.png', 'thumb-a');
    await fixture.writeFile('assets/thumbs/slug-b.png', 'thumb-b');

    await fixture.initGitRepo();
    await fixture.runGit(['checkout', '-b', 'remove-shared']);
    await fixture.runGit(['rm', 'assets/sprites/shared/shared-hero.png']);
    await fixture.runGit(['commit', '-m', 'Remove shared sprite']);

    const result = await fixture.runDoctor(['--changed']);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('targeting 2 changed game slug(s)');

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 2, passing: 0, failing: 2 });
    const slugs = report.games.map((game) => game.slug).sort();
    expect(slugs).toEqual(['slug-a', 'slug-b']);
    for (const game of report.games) {
      expect(
        game.issues.some((issue) => issue.message === 'Sprite asset missing on disk'),
      ).toBe(true);
    }
  });

  it('targets slug-named asset changes even when assets are not referenced directly', async () => {
    fixture = await createGameDoctorFixture('slug-assets');

    await fixture.writeJson(
      'games.json',
      [
        buildGameEntry('standalone-assets', {
          firstFrame: {
            sprites: ['/assets/sprites/shared/hero.png'],
            audio: ['/assets/audio/shared/theme.mp3'],
          },
        }),
      ],
    );

    await fixture.writeFile('games/standalone-assets/index.html', '<!doctype html><title>Standalone</title>');
    await fixture.writeFile('assets/thumbs/standalone-assets.png', 'thumb-bytes');

    await fixture.writeFile('assets/sprites/shared/hero.png', 'sprite-bytes');
    await fixture.writeFile('assets/audio/shared/theme.mp3', 'audio-bytes');

    await fixture.writeFile('assets/sprites/standalone-assets.png', 'sprite-bytes');
    await fixture.writeFile('assets/audio/standalone-assets.mp3', 'audio-bytes');

    await fixture.initGitRepo();
    await fixture.runGit(['checkout', '-b', 'remove-slug-assets']);
    await fixture.runGit(['rm', 'assets/sprites/standalone-assets.png']);
    await fixture.runGit(['rm', 'assets/audio/standalone-assets.mp3']);
    await fixture.runGit(['commit', '-m', 'Remove slug-named assets']);

    const result = await fixture.runDoctor(['--changed']);

    expect(result.stdout).toContain('targeting 1 changed game slug(s)');
    expect(result.stdout).not.toContain('Game doctor: --changed detected no modified game slugs.');
    expect(result.code).toBe(0);

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 1, failing: 0 });
    expect(report.games).toHaveLength(1);
    expect(report.games[0].slug).toBe('standalone-assets');
  });

  it('falls back to full validation when asset changes cannot be mapped to games', async () => {
    fixture = await createGameDoctorFixture('ambiguous-asset');

    await fixture.writeJson('games.json', [buildGameEntry('mystery-game')]);

    await fixture.writeFile('games/mystery-game/index.html', '<!doctype html><title>Mystery</title>');
    await fixture.writeFile('assets/sprites/mystery-game.png', 'sprite');
    await fixture.writeFile('assets/audio/mystery-game.mp3', 'audio');
    await fixture.writeFile('assets/thumbs/mystery-game.png', 'thumb');

    await fixture.initGitRepo();
    await fixture.runGit(['checkout', '-b', 'change-placeholder']);
    await fixture.runGit(['rm', 'assets/placeholder-thumb.png']);
    await fixture.runGit(['commit', '-m', 'Remove shared placeholder']);

    const result = await fixture.runDoctor(['--changed']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('unable to determine changed slugs');
    expect(result.stdout).toContain('Running full validation instead');
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
