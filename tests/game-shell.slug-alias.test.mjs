import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * game.html resolves two different paths per game: the modern wrapper under
 * gameshells/ and the legacy fallback under games/. A game whose wrapper
 * directory is named differently from its catalog slug (2048 -> g2048) used to
 * have both built from one rewritten variable, which pointed the legacy
 * fallback at games/g2048/ -- a directory that does not exist.
 */
async function readShellAliases() {
  const source = await readFile(path.join(ROOT_DIR, 'game.html'), 'utf8');
  const match = source.match(/const SHELL_SLUG_ALIASES = (\{[^}]*\});/);
  expect(match, 'SHELL_SLUG_ALIASES not found in game.html').not.toBeNull();
  return JSON.parse(match[1]);
}

async function readCatalogSlugs() {
  const raw = await readFile(path.join(ROOT_DIR, 'games.json'), 'utf8');
  const data = JSON.parse(raw);
  const entries = Array.isArray(data) ? data : data.games ?? [];
  return entries.map(entry => entry.slug).filter(Boolean);
}

describe('game.html shell slug resolution', () => {
  it('normalizes direct links so uppercase slugs still launch', async () => {
    const source = await readFile(path.join(ROOT_DIR, 'game.html'), 'utf8');
    expect(source).toContain('trim().toLowerCase()');
  });

  it('resolves a legacy shell for every catalog slug', async () => {
    // Every catalogued game must have games/<slug>/index.html: it is the
    // fallback game.html uses whenever the modern wrapper probe fails, and for
    // games that never got a gameshells/ wrapper it is the only shell there is.
    const slugs = await readCatalogSlugs();
    expect(slugs.length).toBeGreaterThan(0);

    const missing = slugs.filter(
      slug => !existsSync(path.join(ROOT_DIR, 'games', slug, 'index.html')),
    );
    expect(missing).toEqual([]);
  });

  it('resolves the modern wrapper wherever one exists', async () => {
    // A missing gameshells/ wrapper is fine -- game.html falls back to legacy.
    // A wrapper that exists under a name the page will never ask for is not.
    const aliases = await readShellAliases();
    const slugs = await readCatalogSlugs();

    const unreachable = [];
    for (const slug of slugs) {
      const shellSlug = aliases[slug] || slug;
      const wrapperForSlug = existsSync(path.join(ROOT_DIR, 'gameshells', slug, 'index.html'));
      const wrapperForShell = existsSync(path.join(ROOT_DIR, 'gameshells', shellSlug, 'index.html'));
      if (wrapperForSlug && !wrapperForShell) {
        unreachable.push(`gameshells/${slug} exists but game.html asks for gameshells/${shellSlug}`);
      }
    }

    expect(unreachable).toEqual([]);
  });

  it('builds the legacy path from the catalog slug, not the shell alias', async () => {
    const source = await readFile(path.join(ROOT_DIR, 'game.html'), 'utf8');
    // The regression: both paths were built from one variable that had already
    // been rewritten to the shell alias.
    expect(source).toContain('const modernSrc = `./gameshells/${shellSlug}/index.html`;');
    expect(source).toContain('const legacySrc = `./games/${catalogSlug}/index.html`;');
    expect(source).not.toContain('const legacySrc = `./games/${shellSlug}/index.html`;');
  });

  it('keys every alias to a real gameshells directory', async () => {
    const aliases = await readShellAliases();
    for (const [catalogSlug, shellSlug] of Object.entries(aliases)) {
      expect(
        existsSync(path.join(ROOT_DIR, 'gameshells', shellSlug, 'index.html')),
        `alias ${catalogSlug} -> ${shellSlug} has no gameshells directory`,
      ).toBe(true);
      expect(
        existsSync(path.join(ROOT_DIR, 'games', catalogSlug, 'index.html')),
        `alias ${catalogSlug} has no legacy games directory`,
      ).toBe(true);
    }
  });
});
