import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'vitest';
import { createGameDoctorFixture } from './fixtures/game-doctor-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'games.json');
const MANIFEST_PATH = path.join(REPO_ROOT, 'tools', 'reporters', 'game-doctor-manifest.json');

let catalogPromise;
let manifestPromise;

async function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fs
      .readFile(CATALOG_PATH, 'utf8')
      .then((raw) => JSON.parse(raw));
  }
  return structuredClone(await catalogPromise);
}

async function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fs
      .readFile(MANIFEST_PATH, 'utf8')
      .then((raw) => JSON.parse(raw));
  }
  return structuredClone(await manifestPromise);
}

async function loadCatalogEntry(slug) {
  const catalog = await loadCatalog();
  if (slug) {
    const match = catalog.find((entry) => entry.slug === slug);
    if (!match) {
      throw new Error(`Unable to locate catalog entry with slug "${slug}"`);
    }
    return match;
  }
  if (catalog.length === 0) {
    throw new Error('Repository catalog is empty; tests require at least one entry.');
  }
  return catalog[0];
}

async function materializeCatalogEntry(fixture, entry, { includeShell = true } = {}) {
  const slug = entry.slug ?? entry.id;
  if (!slug) {
    throw new Error('Catalog entry must include a slug or id');
  }

  const manifest = await loadManifest();
  const manifestEntry = manifest.requirements?.[slug];

  if (includeShell) {
    await fixture.writeFile(`games/${slug}/index.html`, '<!doctype html><title>Playable shell</title>');

    if (manifestEntry && typeof manifestEntry === 'object') {
      await materializeManifestRequirements(fixture, slug, manifestEntry);
    }
  }

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

  await fixture.writeFile(`assets/thumbs/${slug}.png`, 'thumb-bytes');
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

async function materializeManifestRequirements(fixture, slug, manifestEntry) {
  const shellDir = path.posix.join('games', slug);

  const pathRequirements = Array.isArray(manifestEntry.paths) ? manifestEntry.paths : [];
  for (const raw of pathRequirements) {
    if (typeof raw !== 'string') {
      continue;
    }
    const normalized = raw.trim();
    if (!normalized || path.isAbsolute(normalized)) {
      continue;
    }
    const target = path.posix.join(shellDir, toPosix(normalized));
    await fixture.writeFile(target, '// manifest requirement placeholder');
  }

  const globRequirements = Array.isArray(manifestEntry.globs) ? manifestEntry.globs : [];
  for (const [index, raw] of globRequirements.entries()) {
    if (typeof raw !== 'string') {
      continue;
    }
    const normalized = raw.trim();
    if (!normalized || path.isAbsolute(normalized)) {
      continue;
    }
    const posixPattern = toPosix(normalized);
    const segments = posixPattern.split('/');
    const fileName = segments.pop() ?? '';

    const candidateName = fileName.includes('*')
      ? fileName.replace(/\*/g, `fixture-${index}`)
      : fileName || `fixture-${index}.asset`;

    if (candidateName.includes('*')) {
      continue;
    }

    const relativeDir = segments.join('/');
    const relativePath = relativeDir
      ? path.posix.join(shellDir, relativeDir, candidateName)
      : path.posix.join(shellDir, candidateName);

    await fixture.writeFile(relativePath, '// manifest glob placeholder');
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

    const healthyEntry = await loadCatalogEntry();
    const healthySlug = healthyEntry.slug ?? healthyEntry.id ?? 'healthy-game';

    await fixture.writeJson('games.json', [healthyEntry]);

    await materializeCatalogEntry(fixture, healthyEntry);

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

    const regressionEntry = await loadCatalogEntry();
    const regressionSlug = regressionEntry.slug ?? regressionEntry.id ?? 'regression-game';

    await fixture.writeJson('games.json', [regressionEntry]);

    await materializeCatalogEntry(fixture, regressionEntry, { includeShell: false });

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
