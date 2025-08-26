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

describe('pong canvas resizing', () => {
  it('defines fitCanvasToParent before pong.js executes and resizes on load and resize', () => {
    // Set up DOM with canvas
    document.body.innerHTML =
      '<div class="wrap"><canvas id="game" width="900" height="600" data-basew="900" data-baseh="600"></canvas></div>';

    // Mock window dimensions
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 500 });
    Object.defineProperty(window, 'innerHeight', { writable: true, value: 400 });
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
    window.requestAnimationFrame = () => {};

    runScript('js/resizeCanvas.global.js');
    expect(typeof window.fitCanvasToParent).toBe('function');

    runScript('games/pong/pong.js');
    const canvas = document.getElementById('game');
    expect({ w: canvas.width, h: canvas.height }).toEqual({ w: 452, h: 301 });

    // Simulate window resize
    window.innerWidth = 700;
    window.innerHeight = 600;
    window.dispatchEvent(new Event('resize'));
    expect({ w: canvas.width, h: canvas.height }).toEqual({ w: 652, h: 435 });
  });
});

