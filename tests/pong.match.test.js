/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ctxFactory = () => ({
  setTransform() {},
  clearRect() {},
  fillRect() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  setLineDash() {},
  fill() {},
  arc() {},
  fillText() {},
  save() {},
  restore() {},
  measureText(text = '') {
    return { width: text.length * 10 };
  },
  globalAlpha: 1,
  fillStyle: '#000',
  strokeStyle: '#000',
  font: '',
  textAlign: 'left',
  textBaseline: 'alphabetic',
});

describe('pong match configuration', () => {
  let originalGetContext;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;
  let frameQueue;
  let cleanup;

  function stepFrames(count = 1) {
    for (let i = 0; i < count; i += 1) {
      const cb = frameQueue.shift();
      if (!cb) break;
      cb();
    }
  }

  beforeEach(() => {
    frameQueue = [];
    cleanup = undefined;
    document.body.innerHTML = '<canvas id="game"></canvas>';

    const ctxStub = ctxFactory();
    originalGetContext = window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext = () => ctxStub;

    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      frameQueue.push(cb);
      return frameQueue.length;
    };
    window.cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    if (typeof cleanup === 'function') {
      cleanup();
    }
    frameQueue = [];
    document.body.innerHTML = '';
    window.HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    if (window.__pongTest) {
      delete window.__pongTest;
    }
  });

  it('honors target score and win-by-two configuration', async () => {
    const { boot } = await import('../games/pong/main.js');
    boot({ targetScore: 3, winByTwo: true });
    stepFrames(1);

    const hooks = window.__pongTest;
    cleanup = hooks.cleanup;

    expect(hooks.config.targetScore).toBe(3);
    expect(hooks.config.winByTwo).toBe(true);

    hooks.handleScore('left');
    hooks.handleScore('left');
    hooks.handleScore('right');
    hooks.handleScore('right');

    let state = hooks.getState();
    expect(state.leftScore).toBe(2);
    expect(state.rightScore).toBe(2);
    expect(state.matchOver).toBe(false);

    hooks.handleScore('left');
    state = hooks.getState();
    expect(state.leftScore).toBe(3);
    expect(state.matchOver).toBe(false);

    hooks.handleScore('left');
    state = hooks.getState();
    expect(state.leftScore).toBe(4);
    expect(state.matchOver).toBe(true);
    expect(state.winner).toBe('left');
    expect(state.paused).toBe(true);
  });

  it('resets match state for consecutive wins', async () => {
    const { boot } = await import('../games/pong/main.js');
    boot({ targetScore: 2, winByTwo: false });
    stepFrames(1);

    let hooks = window.__pongTest;
    cleanup = hooks.cleanup;

    hooks.handleScore('right');
    hooks.handleScore('right');

    let state = hooks.getState();
    expect(state.matchOver).toBe(true);
    expect(state.winner).toBe('right');
    expect(state.rightScore).toBe(2);

    hooks.startNewMatch();
    state = hooks.getState();
    expect(state.matchOver).toBe(false);
    expect(state.leftScore).toBe(0);
    expect(state.rightScore).toBe(0);
    expect(state.winner).toBe(null);
    expect(state.paused).toBe(false);
    expect(state.servePending).toBe(true);

    hooks.handleScore('left');
    hooks.handleScore('left');
    state = hooks.getState();
    expect(state.matchOver).toBe(true);
    expect(state.winner).toBe('left');

    // Ensure cleanup removes hooks for subsequent tests
    cleanup();
    cleanup = undefined;
    hooks = window.__pongTest;
    expect(hooks).toBeUndefined();
  });
});
