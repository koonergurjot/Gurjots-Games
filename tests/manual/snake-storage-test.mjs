import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
  <div class="wrap"></div>
  <div id="score"></div>
</body></html>`, {
  url: 'https://example.com/game.html',
  pretendToBeVisual: true,
});

const { window } = dom;
const { document } = window;

// Expose globals expected by the game code.
globalThis.window = window;
globalThis.document = document;
globalThis.location = window.location;
globalThis.DOMRect = window.DOMRect;
globalThis.HTMLElement = window.HTMLElement;
globalThis.navigator = window.navigator;
globalThis.CustomEvent = window.CustomEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

// Performance + RAF stubs.
const now = () => Date.now();
if (!window.performance) {
  window.performance = { now };
}
window.performance.now = now;
globalThis.performance = window.performance;

window.requestAnimationFrame = (cb) => setTimeout(() => cb(window.performance.now()), 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;

// Canvas context stub.
function createCtx() {
  const gradient = { addColorStop() {} };
  return {
    _fillStyle: '#000',
    _font: '10px sans-serif',
    _textAlign: 'left',
    _textBaseline: 'alphabetic',
    _globalAlpha: 1,
    clearRect() {},
    fillRect() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    drawImage() {},
    fillText() {},
    createRadialGradient() { return gradient; },
    set fillStyle(v) { this._fillStyle = v; },
    get fillStyle() { return this._fillStyle; },
    set font(v) { this._font = v; },
    get font() { return this._font; },
    set textAlign(v) { this._textAlign = v; },
    get textAlign() { return this._textAlign; },
    set textBaseline(v) { this._textBaseline = v; },
    get textBaseline() { return this._textBaseline; },
    set globalAlpha(v) { this._globalAlpha = v; },
    get globalAlpha() { return this._globalAlpha; },
  };
}

window.HTMLCanvasElement.prototype.getContext = function getContext() {
  return createCtx();
};

// Local storage stub that throws.
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  get() {
    throw new window.DOMException('blocked', 'SecurityError');
  }
});

// Minimal global stubs used by the game.
window.GG = {
  incPlays() {},
  setMeta() {},
  addXP() {},
  addAch() {},
};
globalThis.GG = window.GG;
window.SFX = {
  beep() {},
  seq() {},
};
globalThis.SFX = window.SFX;
window.LB = {
  getTopScores() { return []; },
  submitScore() {},
};
globalThis.LB = window.LB;
window.GGDiagAdapters = { registerGameDiagnostics: () => {} };

const snakePath = path.resolve(projectRoot, 'games/snake/snake.js');

try {
  await import(snakePath);
} catch (err) {
  console.error('Snake import failed:', err);
  process.exitCode = 1;
  throw err;
}

const notice = document.querySelector('.hud-notice');
if (!notice) {
  console.error('Expected HUD notice when storage disabled.');
  process.exitCode = 1;
}

if (!window.Snake) {
  console.error('Snake API missing after init.');
  process.exitCode = 1;
}

console.log('Snake bootstrapped with storage-disabled stub.');

if (window.Snake?.engine?.stop) {
  window.Snake.engine.stop();
}
const watchdogs = window.__bootStatus?.watchdogs;
if (watchdogs) {
  for (const key of Object.keys(watchdogs)) {
    const entry = watchdogs[key];
    if (entry && entry.interval != null) {
      clearInterval(entry.interval);
    }
  }
}

setTimeout(() => process.exit(0), 0);
