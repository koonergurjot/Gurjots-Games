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
});
