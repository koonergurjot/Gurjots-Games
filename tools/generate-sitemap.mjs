import {readFile, writeFile} from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../games.json', import.meta.url), 'utf8'));

const gamePaths = data.games.map(g => {
  const p = g.path.replace(/^\.\//, '/');
  return p.startsWith('/') ? p : `/${p}`;
});

const urls = ['/', '/stats.html', '/cabinet.html', ...gamePaths];

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n') +
  `\n</urlset>\n`;

await writeFile(new URL('../sitemap.xml', import.meta.url), xml);
