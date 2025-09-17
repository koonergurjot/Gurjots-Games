import { promises as fs } from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const gamesDir = path.join(root, 'games');
const exts = new Set(['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg']);

async function main() {
  const games = await fs.readdir(gamesDir);
  const files = [];
  for (const game of games) {
    const dirPath = path.join(gamesDir, game);
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) continue;
    const entries = await fs.readdir(dirPath);
    for (const entry of entries) {
      const ext = path.extname(entry);
      if (entry === 'index.html' || exts.has(ext)) {
        files.push('/' + path.posix.join('games', game, entry));
      }
    }
  }
  files.sort();
  const out = `self.__PRECACHE_MANIFEST = ${JSON.stringify(files, null, 2)};\n`;
  await fs.writeFile(path.join(root, 'precache-manifest.js'), out);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
