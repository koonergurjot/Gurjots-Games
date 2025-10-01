import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

import { normalizeCatalogEntries } from '../shared/game-catalog-core.js';
import { buildIndexPath } from '../shared/game-path-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function toSitemapUrl(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(str)) return str;
  let normalized = str.replace(/^\.\//, '');
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  return normalized;
}

export async function generateSitemap({
  catalogPath = path.join(rootDir, 'games.json'),
  outputPath = path.join(rootDir, 'sitemap.xml')
} = {}) {
  const data = JSON.parse(await readFile(catalogPath, 'utf8'));
  const entries = Array.isArray(data) ? data : data.games ?? [];
  const games = normalizeCatalogEntries(entries);

  const gamePaths = games
    .map(game => toSitemapUrl(game?.playUrl || game?.playPath || (game?.basePath ? buildIndexPath(game.basePath) : null)))
    .filter(Boolean);

  const urls = Array.from(new Set(['/', '/stats.html', '/cabinet.html', ...gamePaths]));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')
    + `\n</urlset>\n`;

  await writeFile(outputPath, xml);
  return xml;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateSitemap().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
