import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
]);

async function collectJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        const nested = await collectJsonFiles(path.join(directory, entry.name));
        files.push(...nested);
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

describe('json syntax validation', () => {
  it('parses every JSON file in the repository', async () => {
    const files = await collectJsonFiles(ROOT_DIR);
    const errors = [];

    for (const file of files) {
      try {
        const contents = await readFile(file, 'utf8');
        JSON.parse(contents);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${path.relative(ROOT_DIR, file)}: ${message}`);
      }
    }

    if (errors.length > 0) {
      const details = errors.join('\n');
      throw new Error(`json-parse-error\n${details}`);
    }
  });
});
