import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * The auto-signal bootstrap embedded in each game's index.html reports
 * GAME_READY / GAME_ERROR to the parent shell. game.html acts on the last
 * signal it receives, so a fallback GAME_READY emitted after a GAME_ERROR
 * makes a failed boot render as "Ready". These tests run the real shipped
 * block, not a copy.
 */
const GAMES = ['alien-shooter', 'city-runner', 'pixel-platformer'];

async function loadBootstrap(slug) {
  const html = await readFile(path.join(ROOT_DIR, 'games', slug, 'index.html'), 'utf8');
  const match = html.match(/<!-- Auto-signal bootstrap[\s\S]*?<script>([\s\S]*?)<\/script>/);
  expect(match, `no auto-signal bootstrap in games/${slug}/index.html`).not.toBeNull();
  return match[1];
}

/** Minimal window/document stand-ins so the block runs deterministically. */
function runBootstrap(source, { readyState = 'loading' } = {}) {
  const listeners = new Map();
  const posted = [];

  const win = {
    parent: { postMessage: message => posted.push(message) },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
  };
  const doc = { readyState };

  // eslint-disable-next-line no-new-func
  new Function('window', 'document', source)(win, doc);

  const fire = (type, event = {}) => {
    for (const handler of listeners.get(type) || []) handler(event);
  };
  const types = () => posted.map(message => message?.type);
  return { fire, posted, types };
}

/** setTimeout(..., 0) inside the block defers the fallback send. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe.each(GAMES)('auto-signal bootstrap in games/%s', slug => {
  it('does not emit GAME_READY after an error', async () => {
    const { fire, types } = runBootstrap(await loadBootstrap(slug));

    fire('error', { message: 'module load failure' });
    fire('load');
    await flush();

    expect(types()).toEqual(['GAME_ERROR']);
  });

  it('does not emit GAME_READY after an unhandled rejection', async () => {
    const { fire, types } = runBootstrap(await loadBootstrap(slug));

    fire('unhandledrejection', { reason: new Error('boot promise rejected') });
    fire('load');
    await flush();

    expect(types()).toEqual(['GAME_ERROR']);
  });

  it('still emits GAME_READY exactly once on a clean boot', async () => {
    const { fire, types } = runBootstrap(await loadBootstrap(slug));

    fire('load');
    await flush();

    expect(types()).toEqual(['GAME_READY']);
  });

  it('reports the error text to the parent shell', async () => {
    const { fire, posted } = runBootstrap(await loadBootstrap(slug));

    fire('error', { message: 'module load failure' });
    await flush();

    expect(posted[0]).toMatchObject({ type: 'GAME_ERROR', error: 'module load failure' });
  });
});
