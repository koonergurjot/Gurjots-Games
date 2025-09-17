/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Helper to evaluate a script file in the window context
function runScript(relativePath) {
  const code = fs.readFileSync(path.resolve(relativePath), 'utf8');
  // eslint-disable-next-line no-eval
  window.eval(code);
}

describe('pong canvas loop', () => {
  it('resizes via CSS pixels and exposes controls', () => {
    // Set up DOM with canvas
    document.body.innerHTML = '<canvas id="game" style="width:452px;height:301px"></canvas>';

    window.devicePixelRatio = 1;
    // Stub canvas context methods used by the game
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
      fillStyle: '',
      strokeStyle: '',
      font: '',
      textAlign: ''
    };
    window.HTMLCanvasElement.prototype.getContext = () => ctxStub;

    // Prevent animation loop from continuing
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
    window.ResizeObserver = undefined;

    runScript('js/canvasLoop.global.js');
    window.GG = { incPlays() {}, addXP() {}, setMeta() {}, addAch() {} };

    runScript('games/pong/pauseOverlay.js');
    runScript('games/pong/pong.js');
    const canvas = document.getElementById('game');
    expect({ w: canvas.width, h: canvas.height }).toEqual({ w: 452, h: 301 });

    // Simulate CSS resize and window resize event
    canvas.style.width = '652px';
    canvas.style.height = '435px';
    window.dispatchEvent(new Event('resize'));
    expect({ w: canvas.width, h: canvas.height }).toEqual({ w: 652, h: 435 });

    expect(typeof window.pong.start).toBe('function');
    expect(typeof window.pong.stop).toBe('function');
    expect(typeof window.pong.dispose).toBe('function');

    const overlay = document.querySelector('.pause-overlay[data-game="pong"]');
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('hidden')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(overlay.classList.contains('hidden')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(overlay.classList.contains('hidden')).toBe(true);
  });
});

