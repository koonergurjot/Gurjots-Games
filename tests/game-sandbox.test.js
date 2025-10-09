/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameSandbox } from '../shared/game-sandbox.js';

describe('game sandbox', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="game-root"></div>';
  });

  it('mounts iframe entries without sandbox restrictions', async () => {
    const sandbox = createGameSandbox({ slug: 'test' });
    const { frame, ready } = await sandbox.init({
      mode: 'iframe',
      entry: '/games/test/index.html',
      timeoutMs: 0
    });
    ready.catch(() => {});
    expect(frame).toBeInstanceOf(HTMLIFrameElement);
    expect(frame.getAttribute('src')).toContain('/games/test/index.html');
    expect(frame.getAttribute('sandbox')).toBeNull();
    await sandbox.dispose();
  });

  it('creates module sandboxes via srcdoc wrapper', async () => {
    const sandbox = createGameSandbox({ slug: 'test' });
    const { frame, ready } = await sandbox.init({
      mode: 'module',
      entry: '/games/test/main.js',
      timeoutMs: 0
    });
    ready.catch(() => {});
    const srcdoc = frame.getAttribute('srcdoc') || '';
    expect(srcdoc).toContain('/games/test/main.js');
    expect(srcdoc).toContain('GAME_READY');
    await sandbox.dispose();
  });

  it('forwards pause and resume via postMessage', async () => {
    const sandbox = createGameSandbox({ slug: 'test' });
    const { frame, ready } = await sandbox.init({
      mode: 'iframe',
      entry: '/games/test/index.html',
      timeoutMs: 0
    });
    ready.catch(() => {});
    const postMessage = vi.fn();
    Object.defineProperty(frame, 'contentWindow', {
      value: { postMessage },
      configurable: true
    });
    sandbox.pause();
    sandbox.resume();
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[0][0]).toMatchObject({ type: 'GAME_PAUSE', slug: 'test' });
    expect(postMessage.mock.calls[1][0]).toMatchObject({ type: 'GAME_RESUME', slug: 'test' });
    await sandbox.dispose();
  });
});
