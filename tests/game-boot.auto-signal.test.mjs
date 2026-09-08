import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * The auto-signal bootstrap embedded in most game pages reports GAME_READY /
 * GAME_ERROR to the parent shell. game.html acts on the last signal it
 * receives, so a fallback GAME_READY emitted after a GAME_ERROR makes a
 * failed boot render as "Ready". These tests run the real shipped block, not
 * a copy.
 *
 * This used to check three games only (the ones written most recently, which
 * happened to carry a fixed version of the shim). Every other page still
 * shipped an older shim where the fallback's own "signalled" flag was set by
 * watching for a message event that a postMessage to window.parent never
 * actually triggers on the sending window -- so the flag never really
 * updated, and the fallback fired GAME_READY after a GAME_ERROR on 11 of the
 * 15 pages that ship this block. tetris/index.html has no shim at all: it
 * self-reports GAME_READY directly and intentionally has no fallback path.
 */
const PAGES = {
  '2048': 'games/2048/index.html',
  asteroids: 'games/asteroids/index.html',
  breakout: 'games/breakout/index.html',
  chess: 'games/chess/index.html',
  chess3d: 'games/chess3d/index.html',
  maze3d: 'games/maze3d/index.html',
  platformer: 'games/platformer/index.html',
  'platformer (practice mode)': 'games/platformer/practice.html',
  pong: 'games/pong/index.html',
  runner: 'games/runner/index.html',
  'runner (night rush mode)': 'games/runner/night.html',
  shooter: 'games/shooter/index.html',
  'shooter (arena mode)': 'games/shooter/arena.html',
  snake: 'games/snake/index.html',
  solitaire: 'games/solitaire/index.html',
  'tetris (replay lobby)': 'games/tetris/lobby.html',
  'word-puzzle': 'games/word-puzzle/index.html',
};
const GAMES = Object.keys(PAGES);

async function loadBootstrap(slug) {
  const html = await readFile(path.join(ROOT_DIR, PAGES[slug]), 'utf8');
  const match = html.match(/<!-- Auto-signal bootstrap[\s\S]*?<script>([\s\S]*?)<\/script>/);
  expect(match, `no auto-signal bootstrap in ${PAGES[slug]}`).not.toBeNull();
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
