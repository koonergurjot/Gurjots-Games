import { promises as fs } from 'node:fs';
import { describe, it } from 'vitest';

const SUPPORT_DIRECTORIES = new Set([
  'common',
  'box-core',
]);

async function listDirectories(rootUrl){
  const dirents = await fs.readdir(rootUrl, { withFileTypes: true });
  return dirents.filter(entry => entry.isDirectory()).map(entry => entry.name);
}

describe('games playable entry validation', () => {
  it('ensures each game directory exposes an entry point', async () => {
    const gamesRoot = new URL('../games/', import.meta.url);
    const gameDirectories = await listDirectories(gamesRoot);
    const missingEntries = [];

    for (const dir of gameDirectories){
      if (SUPPORT_DIRECTORIES.has(dir)){
        continue;
      }

      const gameDirUrl = new URL(`../games/${dir}/`, import.meta.url);
      const files = await fs.readdir(gameDirUrl);

      const hasMain = files.includes('main.js');
      const hasIndex = files.includes('index.html');
      const hasManifest = files.some(name => name === 'manifest' || name.startsWith('manifest.'));

      if (!hasMain && !hasIndex && !hasManifest){
        missingEntries.push(dir);
      }
    }

    if (missingEntries.length > 0){
      throw new Error(
        `Playable entry missing for: ${missingEntries.sort().join(', ')}`,
      );
    }
  });
});
