import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { generateSitemap } from '../tools/generate-sitemap.mjs';

async function createTempDir() {
  const base = tmpdir();
  return mkdtemp(path.join(base, 'sitemap-test-'));
}

describe('generate-sitemap', () => {
  it('generates sitemap output from the current catalog', async () => {
    const dir = await createTempDir();
    const outputPath = path.join(dir, 'sitemap.xml');

    const xml = await generateSitemap({ outputPath });

    expect(xml).toMatch(/<urlset/);
    expect(xml).toMatch(/<loc>\/stats.html<\/loc>/);
    const written = await readFile(outputPath, 'utf8');
    expect(written).toBe(xml);
  });
});
