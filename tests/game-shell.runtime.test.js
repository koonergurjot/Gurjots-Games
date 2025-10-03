/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const importShell = async (options = {}) => {
  const { slug = 'pong', preload = '', moduleScript = false } = options;
  vi.resetModules();
  document.head.innerHTML = '';
  document.body.className = 'game-shell';
  document.body.innerHTML = `
    <main class="game-shell__main">
      <div class="game-shell__surface">
        <canvas id="game"></canvas>
        <div id="hud"><span id="score" data-game-score>0</span></div>
      </div>
    </main>
  `;
  if (moduleScript) {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = new URL('../games/common/game-shell.js', import.meta.url).href;
    script.dataset.game = slug;
    script.dataset.preloadFirst = preload;
    script.dataset.backHref = '/index.html';
    document.head.append(script);
    Object.defineProperty(document, 'currentScript', {
      value: null,
      configurable: true,
    });
  } else {
    Object.defineProperty(document, 'currentScript', {
      value: {
        dataset: {
          game: slug,
          preloadFirst: preload,
          backHref: '/index.html',
        },
      },
      configurable: true,
    });
  }
  const postMessage = vi.fn();
  Object.defineProperty(window, 'parent', {
    value: { postMessage },
    configurable: true,
  });
  window.fitCanvasToParent = vi.fn();
  await import('../games/common/game-shell.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await Promise.resolve();
  await Promise.resolve();
  return { postMessage };
};

describe('game-shell runtime integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('injects a controls overlay when mounted', async () => {
    await importShell();
    const overlay = await vi.waitFor(() => {
      const node = document.querySelector('[data-gg-controls-overlay]');
      expect(node).toBeTruthy();
      return node;
    });
    expect(overlay.querySelector('.game-shell__controls-list')).toBeTruthy();
    expect(window.fitCanvasToParent).toHaveBeenCalled();
  });

  it('emits GAME_SCORE messages when the score node changes', async () => {
    const { postMessage } = await importShell();
    postMessage.mockClear();
    window.GGShellEmitScore(42);
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'GAME_SCORE', slug: 'pong', score: 42 }, '*');
  });

  it('exposes a visibility helper that binds pause/resume listeners', async () => {
    await importShell();
    const pause = vi.fn();
    const resume = vi.fn();
    const dispose = window.GGShellVisibility.bind({ onPause: pause, onResume: resume });
    window.dispatchEvent(new CustomEvent('ggshell:pause'));
    window.dispatchEvent(new CustomEvent('ggshell:resume'));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    dispose();
    window.dispatchEvent(new CustomEvent('ggshell:pause'));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('derives configuration when loaded as a module script', async () => {
    const { postMessage } = await importShell({ slug: 'tetris', moduleScript: true });
    expect(document.body.dataset.gameSlug).toBe('tetris');
    window.dispatchEvent(new Event('load'));
    await vi.waitFor(() => {
      const diagScript = document.querySelector('script[data-shell-diag][data-slug="tetris"]');
      expect(diagScript).toBeTruthy();
    });
    postMessage.mockClear();
    window.GGShellEmitScore(7);
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'GAME_SCORE', slug: 'tetris', score: 7 }, '*');
  });
});
