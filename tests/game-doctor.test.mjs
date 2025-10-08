import { afterEach, describe, expect, it } from 'vitest';
import { createGameDoctorFixture } from './fixtures/game-doctor-fixture.mjs';

function buildGameEntry(slug, overrides = {}) {
  const assetHints = {
    sprites: [`/assets/sprites/${slug}.png`],
    audio: [`/assets/audio/${slug}.mp3`],
  };
  const base = {
    id: slug,
    slug,
    title: `${slug} title`,
    description: 'Short description',
    short: 'Short description',
    controls: 'Arrow keys',
    tags: ['arcade'],
    engineType: 'canvas-2d',
    assets: assetHints,
    version: '1.0.0',
    thumbnailPath: `/assets/thumbs/${slug}.png`,
    featureFlags: ['offline'],
    minDevice: { width: 320, height: 200 },
    difficulty: 'easy',
    released: '2024-01-01',
    playUrl: `/games/${slug}/`,
    firstFrame: assetHints,
    help: {
      objective: 'Score points',
      controls: 'Arrow keys',
      tips: ['Have fun'],
      steps: ['Start'],
    },
  };
  const entry = { ...base, ...overrides };
  if (overrides.firstFrame && !overrides.assets) {
    entry.assets = entry.firstFrame;
  }
  if (overrides.assets && !overrides.firstFrame) {
    entry.firstFrame = entry.assets;
  }
  if (!entry.assets && entry.firstFrame) {
    entry.assets = entry.firstFrame;
  }
  if (!entry.firstFrame && entry.assets) {
    entry.firstFrame = entry.assets;
  }
  if (!entry.help?.controls && entry.controls) {
    entry.help = { ...(entry.help || {}), controls: entry.controls };
  }
  return entry;
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
    expect(report.summary.issueCounts).toEqual({
      total: 0,
      bySeverity: {
        blocker: 0,
        major: 0,
        minor: 0,
        info: 0,
      },
      byCategory: {},
    });
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
      buildGameEntry('troubled-game', {
        title: 'Troubled Fixture',
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

    const markdown = await fixture.readFile('health/report.md');
    expect(markdown).toContain('## Troubled Fixture');
    expect(markdown).toContain('❌ Needs attention');
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

  it('fails when manifest-required assets are missing from disk', async () => {
    fixture = await createGameDoctorFixture('manifest-missing');

    await fixture.writeJson('games.json', [
      buildGameEntry('platformer', {
        title: 'Manifest Platformer',
      }),
    ]);

    await fixture.writeFile('games/platformer/index.html', '<!doctype html><title>Platformer</title>');
    await fixture.writeFile('games/platformer/main.js', '// main logic');
    await fixture.writeFile('games/platformer/net.js', '// net logic');
    await fixture.writeFile('games/platformer/adapter.js', '// adapter');
    await fixture.writeFile('games/platformer/tiles.js', '// tiles');

    await fixture.writeFile('assets/sprites/platformer.png', 'sprite-bytes');
    await fixture.writeFile('assets/audio/platformer.mp3', 'audio-bytes');
    await fixture.writeFile('assets/thumbs/platformer.png', 'thumb-bytes');

    const result = await fixture.runDoctor();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Game doctor found 1 of 1 game(s) with issues');

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 0, failing: 1 });
    const issueCounts = report.summary.issueCounts;
    expect(issueCounts.total).toBeGreaterThanOrEqual(2);
    expect(issueCounts.bySeverity).toMatchObject({
      blocker: expect.any(Number),
      major: expect.any(Number),
      minor: expect.any(Number),
      info: expect.any(Number),
    });
    expect(issueCounts.bySeverity.blocker).toBeGreaterThanOrEqual(1);
    expect(issueCounts.bySeverity.major).toBeGreaterThanOrEqual(1);
    expect(issueCounts.byCategory).toMatchObject({
      'manifest-misconfig': expect.any(Number),
      'missing-asset': expect.any(Number),
    });
    expect(issueCounts.byCategory['manifest-misconfig']).toBeGreaterThanOrEqual(1);
    expect(issueCounts.byCategory['missing-asset']).toBeGreaterThanOrEqual(1);
    expect(report.games[0].slug).toBe('platformer');
    expect(
      report.games[0].issues.some((issue) => issue.message === 'Manifest required asset missing'),
    ).toBe(true);
    expect(
      report.games[0].issues.some((issue) => issue.message === 'Manifest glob matched no files'),
    ).toBe(true);
  });

  it('records headless boot issues when runner reports GAME_ERROR', async () => {
    fixture = await createGameDoctorFixture('headless-error');

    await fixture.writeJson('games.json', [
      buildGameEntry('headless-error', {
        title: 'Headless Error Game',
      }),
    ]);

    await fixture.writeFile('games/headless-error/index.html', '<!doctype html><title>Error Game</title>');
    await fixture.writeFile('assets/sprites/headless-error.png', 'sprite-bytes');
    await fixture.writeFile('assets/audio/headless-error.mp3', 'audio-bytes');
    await fixture.writeFile('assets/thumbs/headless-error.png', 'thumb-bytes');

    await fixture.writeFile(
      'tools/headless-stub.mjs',
      `export async function createHeadlessRunner(){\n  return {\n    async run(_, context){\n      if (context?.slug === 'headless-error'){\n        return { status: 'error', details: { message: 'stub failure' } };\n      }\n      return { status: 'ready', details: {} };\n    },\n    async close(){},\n  };\n}\n`,
    );

    const result = await fixture.runDoctor();

    expect(result.code).toBe(1);
    const report = await fixture.readJson('health/report.json');
    expect(report.games).toHaveLength(1);
    expect(report.games[0].issues.some((issue) => issue.message === 'Headless boot signaled error')).toBe(true);
    expect(report.games[0].runtime?.headless?.status).toBe('error');
  });

  it('records headless boot timeout issues', async () => {
    fixture = await createGameDoctorFixture('headless-timeout');

    await fixture.writeJson('games.json', [
      buildGameEntry('headless-timeout', {
        title: 'Headless Timeout Game',
      }),
    ]);

    await fixture.writeFile('games/headless-timeout/index.html', '<!doctype html><title>Timeout Game</title>');
    await fixture.writeFile('assets/sprites/headless-timeout.png', 'sprite-bytes');
    await fixture.writeFile('assets/audio/headless-timeout.mp3', 'audio-bytes');
    await fixture.writeFile('assets/thumbs/headless-timeout.png', 'thumb-bytes');

    await fixture.writeFile(
      'tools/headless-stub.mjs',
      `export async function createHeadlessRunner(){\n  return {\n    async run(_, context){\n      if (context?.slug === 'headless-timeout'){\n        return { status: 'timeout', details: { waitedMs: 5000 } };\n      }\n      return { status: 'ready', details: {} };\n    },\n    async close(){},\n  };\n}\n`,
    );

    const result = await fixture.runDoctor();

    expect(result.code).toBe(1);
    const report = await fixture.readJson('health/report.json');
    expect(report.games).toHaveLength(1);
    const issues = report.games[0].issues.map((issue) => issue.message);
    expect(issues).toContain('Headless boot timed out');
    expect(report.games[0].runtime?.headless?.status).toBe('timeout');
    expect(report.games[0].runtime?.headless?.waitedMs).toBe(5000);
  });

  it('flags missing /assets/ references discovered in shell sources', async () => {
    fixture = await createGameDoctorFixture('asset-references');

    await fixture.writeJson('games.json', [
      buildGameEntry('asset-check', {
        title: 'Asset Reference Check',
      }),
    ]);

    await fixture.writeFile(
      'games/asset-check/index.html',
      [
        '<!doctype html>',
        '<html>',
        '<head>',
        '  <title>Asset Check</title>',
        '</head>',
        '<body>',
        '  <img src="/assets/sprites/asset-check.png">',
        '  <img src="/assets/sprites/missing.png">',
        '  <script src="./main.js"></script>',
        '</body>',
        '</html>',
      ].join('\n'),
    );

    await fixture.writeFile(
      'games/asset-check/main.js',
      "export const SOUND = '/assets/audio/missing-sound.mp3';\n",
    );

    await fixture.writeFile('assets/sprites/asset-check.png', 'sprite-bytes');
    await fixture.writeFile('assets/audio/asset-check.mp3', 'audio-bytes');
    await fixture.writeFile('assets/thumbs/asset-check.png', 'thumb-bytes');

    const result = await fixture.runDoctor();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Game doctor found 1 of 1 game(s) with issues');

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 0, failing: 1 });

    const gameReport = report.games[0];
    expect(gameReport.slug).toBe('asset-check');

    const referenceIssues = gameReport.issues.filter(
      (issue) => issue.message === 'Asset reference missing on disk',
    );
    expect(referenceIssues).toHaveLength(2);

    const referencedAssets = referenceIssues.map((issue) => issue.context.asset).sort();
    expect(referencedAssets).toEqual([
      '/assets/audio/missing-sound.mp3',
      '/assets/sprites/missing.png',
    ]);

    const htmlIssue = referenceIssues.find(
      (issue) => issue.context.asset === '/assets/sprites/missing.png',
    );
    expect(htmlIssue.context.references).toEqual([
      {
        file: 'games/asset-check/index.html',
        line: 8,
        column: expect.any(Number),
      },
    ]);

    const scriptIssue = referenceIssues.find(
      (issue) => issue.context.asset === '/assets/audio/missing-sound.mp3',
    );
    expect(scriptIssue.context.references).toEqual([
      {
        file: 'games/asset-check/main.js',
        line: 1,
        column: expect.any(Number),
      },
    ]);

    expect(gameReport.assets.references).toMatchObject({ total: 3, missing: 2 });
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
});
