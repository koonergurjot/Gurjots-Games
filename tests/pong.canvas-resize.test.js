/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('pong canvas loop', () => {
  let originalGetContext;
  let originalRequestAnimationFrame;
  let originalCancelAnimationFrame;
  let cleanup;

  const ctxStub = {
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
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
  };

  beforeEach(() => {
    document.body.innerHTML = '<canvas id="game" style="width:452px;height:301px"></canvas>';
    cleanup = undefined;

    originalGetContext = window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext = () => ctxStub;

    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    if (typeof cleanup === 'function') {
      cleanup();
    }
    document.body.innerHTML = '';
    window.HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    if (window.__pongTest) delete window.__pongTest;
  });

  it('resizes via CSS pixels and exposes controls', async () => {
    const { boot } = await import('../games/pong/main.js');
    boot();
    cleanup = window.__pongTest?.cleanup;

    const canvas = document.getElementById('game');
    expect(canvas).toBeTruthy();
    expect({ w: canvas.width, h: canvas.height }).toEqual({ w: 452, h: 301 });

    canvas.style.width = '652px';
    canvas.style.height = '435px';
    window.dispatchEvent(new Event('resize'));
    expect({ w: canvas.width, h: canvas.height }).toEqual({ w: 652, h: 435 });

    expect(typeof window.__pongTest?.handleScore).toBe('function');
    expect(typeof window.__pongTest?.startNewMatch).toBe('function');

    const state = window.__pongTest?.getState?.();
    expect(state).toBeTruthy();
    expect(state).toMatchObject({ leftScore: 0, rightScore: 0, matchOver: false });
  });
});

