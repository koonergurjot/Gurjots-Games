import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'vitest';
import { createGameDoctorFixture } from './fixtures/game-doctor-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const BASE_ENTRY = {
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
};

let schemaPromise;

async function loadCatalogSchema() {
  if (!schemaPromise) {
    const schemaPath = path.join(REPO_ROOT, 'tools', 'schemas', 'games.schema.json');
    schemaPromise = fs
      .readFile(schemaPath, 'utf8')
      .then((raw) => JSON.parse(raw));
  }
  return schemaPromise;
}

function mergeDeep(base, overrides) {
  if (overrides === undefined) {
    return base;
  }

  if (Array.isArray(base) || Array.isArray(overrides)) {
    return overrides;
  }

  if (base && typeof base === 'object' && overrides && typeof overrides === 'object') {
    const result = { ...base };
    for (const [key, value] of Object.entries(overrides)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = mergeDeep(result[key] ?? {}, value);
      } else if (value !== undefined) {
        result[key] = value;
      } else {
        delete result[key];
      }
    }
    return result;
  }

  return overrides;
}

function filterBySchema(value, schema, pointer = 'root') {
  if (!schema) {
    return value;
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    const itemSchema = schema.items ?? null;
    if (!itemSchema) {
      return value;
    }
    return value.map((item, index) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return filterBySchema(item, itemSchema, `${pointer}[${index}]`);
      }
      return item;
    });
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    const result = {};

    for (const [key, entryValue] of Object.entries(value)) {
      if (!properties[key]) {
        continue;
      }
      result[key] = filterBySchema(entryValue, properties[key], `${pointer}.${key}`);
    }

    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in result)) {
        throw new Error(
          `Test catalog entry helper needs a value for required property "${requiredKey}" at ${pointer}.`,
        );
      }
    }

    return result;
  }

  return value;
}

async function createCatalogEntry(overrides = {}) {
  const schema = await loadCatalogSchema();
  const merged = mergeDeep(BASE_ENTRY, overrides);
  return filterBySchema(merged, schema.items ?? {}, 'root');
}

async function materializeAssets(fixture, entry) {
  const spriteList = entry.firstFrame?.sprites ?? [];
  for (const sprite of spriteList) {
    if (typeof sprite === 'string' && sprite.startsWith('/')) {
      await fixture.writeFile(sprite.replace(/^\//, ''), 'sprite-bytes');
    }
  }

  const audioList = entry.firstFrame?.audio ?? [];
  for (const audio of audioList) {
    if (typeof audio === 'string' && audio.startsWith('/')) {
      await fixture.writeFile(audio.replace(/^\//, ''), 'audio-bytes');
    }
  }
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

    const healthyEntry = await createCatalogEntry();
    const healthySlug = healthyEntry.slug ?? healthyEntry.id ?? 'healthy-game';

    await fixture.writeJson('games.json', [healthyEntry]);

    await fixture.writeFile(
      `games/${healthySlug}/index.html`,
      '<!doctype html><title>Healthy</title>',
    );
    await materializeAssets(fixture, healthyEntry);
    await fixture.writeFile('assets/thumbs/healthy-game.png', 'thumb-bytes');

    const result = await fixture.runDoctor();

    expect(result.code).toBe(0);
    expect(result.stderr.trim()).toBe('');
    expect(result.stdout).toContain('Game doctor: all 1 game(s) look healthy!');

    const report = await fixture.readJson('health/report.json');
    expect(report.summary).toMatchObject({ total: 1, passing: 1, failing: 0 });
    expect(report.games).toHaveLength(1);
    expect(report.games[0].slug).toBe(healthySlug);
    expect(report.games[0].ok).toBe(true);

    const markdown = await fixture.readFile('health/report.md');
    expect(markdown).toContain(`## ${healthyEntry.title}`);
    expect(markdown).toContain('- Status: ✅ Healthy');
  });

  it('fails strict mode when regressions are introduced', async () => {
    fixture = await createGameDoctorFixture('regression');

    const regressionEntry = await createCatalogEntry({
      id: 'troubled-game',
      slug: 'troubled-game',
      title: 'Troubled Fixture',
      short: 'A game with issues.',
      tags: ['Adventure'],
      difficulty: 'medium',
      playUrl: '/games/troubled-game/',
      firstFrame: {
        sprites: ['/assets/sprites/missing.png'],
        audio: undefined,
      },
      help: {
        objective: 'Solve the troubles.',
        controls: 'Use mouse clicks.',
        tips: ['Beware of bugs.'],
        steps: ['Attempt to play.'],
      },
    });
    const regressionSlug = regressionEntry.slug ?? regressionEntry.id ?? 'troubled-game';

    await fixture.writeJson('games.json', [regressionEntry]);

    await fixture.writeJson('health/baseline.json', {
      games: [
        {
          slug: regressionSlug,
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
    expect(markdown).toContain(`## ${regressionEntry.title}`);
    expect(markdown).toContain('❌ Needs attention');
  });
});
