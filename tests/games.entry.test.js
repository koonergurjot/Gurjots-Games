import { promises as fs } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createFindFirstReachable } from '../shared/find-first-reachable.js';

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

describe('findFirstReachable helper', () => {
  it('returns the lowest-index reachable candidate even if slower than later probes', async () => {
    const started = [];
    const aborted = [];
    const resolvers = new Map();

    const probe = (candidate, { signal }) => {
      started.push(candidate);
      return new Promise((resolve, reject) => {
        resolvers.set(candidate, resolve);
        if (signal){
          signal.addEventListener('abort', () => {
            aborted.push(candidate);
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          }, { once: true });
        }
      });
    };

    const findFirstReachable = createFindFirstReachable({ probe, concurrency: 2 });
    let resolvedEntry;
    const pending = findFirstReachable('speedy-slug', 'module', ['slow', 'fast', 'later']).then(result => {
      resolvedEntry = result;
      return result;
    });

    await Promise.resolve();

    expect(started).toEqual(['slow', 'fast']);

    resolvers.get('fast')?.(true);

    await Promise.resolve();
    await Promise.resolve();

    expect(resolvedEntry).toBeUndefined();
    expect(started).not.toContain('later');

    resolvers.get('slow')?.(true);

    const entry = await pending;
    expect(entry).toBe('slow');
    expect(resolvedEntry).toBe('slow');
    expect(aborted).toEqual([]);
  });

  it('cancels slower probes once the preferred reachable candidate is confirmed', async () => {
    const started = [];
    const aborted = [];
    const resolvers = new Map();

    const probe = (candidate, { signal }) => {
      started.push(candidate);
      return new Promise((resolve, reject) => {
        resolvers.set(candidate, resolve);
        if (signal){
          signal.addEventListener('abort', () => {
            aborted.push(candidate);
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          }, { once: true });
        }
      });
    };

    const findFirstReachable = createFindFirstReachable({ probe, concurrency: 2 });
    const pending = findFirstReachable('fallback-slug', 'module', ['first', 'second', 'third']);

    await Promise.resolve();

    expect(started).toEqual(['first', 'second']);

    resolvers.get('first')?.(false);

    await Promise.resolve();

    expect(started).toEqual(['first', 'second', 'third']);

    resolvers.get('second')?.(true);

    const entry = await pending;
    expect(entry).toBe('second');
    expect(aborted).toContain('third');
  });

  it('memoizes successful results per slug and type', async () => {
    let probeCalls = 0;
    const probe = candidate => {
      probeCalls += 1;
      return candidate === 'live-entry';
    };

    const findFirstReachable = createFindFirstReachable({ probe });

    const first = await findFirstReachable('memo-slug', 'iframe', ['dead-entry', 'live-entry']);
    expect(first).toBe('live-entry');
    expect(probeCalls).toBe(2);

    const second = await findFirstReachable('memo-slug', 'iframe', ['another-entry']);
    expect(second).toBe('live-entry');
    expect(probeCalls).toBe(2);
  });
});
