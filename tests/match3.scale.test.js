// Regression: after the shell shrinks the canvas (backing = CSS x DPR), Gem Match
// must still draw where it hit-tests. Before the fix the board was drawn at DPR
// scale while clicks were mapped through BASE/CSS, so the first rendered gem
// selected the one diagonally down-right of it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

function load({ cssW, cssH, backingW, backingH }) {
  const listeners = {};
  const highlights = [];
  const transforms = [];
  const ctx = new Proxy({
    fillStyle: '',
    setTransform(...v) { transforms.push(v); },
    fillRect(...v) { if (this.fillStyle === 'rgba(250, 204, 21, 0.25)') highlights.push(v); },
  }, { get(o, k) { return k in o ? o[k] : () => {}; } });
  const canvas = {
    width: backingW, height: backingH, dataset: {}, style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: cssW, height: cssH }),
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  let redraw;
  let seed = 17;
  const math = Object.create(Math);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const nodes = new Map();
  const win = { devicePixelRatio: 2, innerWidth: cssW, innerHeight: cssH, addEventListener() {}, matchMedia: () => ({ matches: true }) };
  const sandbox = {
    document: { readyState: 'complete', getElementById(id) { if (id === 'game') return canvas; if (!nodes.has(id)) nodes.set(id, { addEventListener() {} }); return nodes.get(id); } },
    window: win, Math: math, console, setTimeout,
    MutationObserver: class { constructor(fn) { redraw = fn; } observe() {} },
    playSfx() {}, gameEvent() {}, send() {}, drawBootPlaceholder() {}, showErrorOverlay() {},
  };
  const file = path.resolve(__dirname, '../games/match3/main.js');
  const source = fs.readFileSync(file, 'utf8').replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(source, sandbox, { filename: file });
  redraw();
  return { click: (x, y) => listeners.click({ clientX: x, clientY: y }), highlights, transforms };
}

describe('match3 canvas scaling', () => {
  // [css width, css height, backing multiple]. 260x250 css at DPR 2 is the case the shell produces on a phone.
  for (const [cssW, cssH, dpr] of [[260, 250, 2], [520, 500, 1], [390, 375, 3], [780, 750, 2]]) {
    it(`draws and hit-tests the same cell at ${cssW}x${cssH} css, DPR ${dpr}`, () => {
      const g = load({ cssW, cssH, backingW: cssW * dpr, backingH: cssH * dpr });
      const scaleX = cssW / 520, scaleY = cssH / 500;
      // Centre of the first gem as it appears on screen (logical 64,48).
      g.click(64 * scaleX, 48 * scaleY);
      // Highlight is drawn inset 2px inside cell [0,0]: (GRID_X+2, GRID_Y+2, 52, 52).
      expect(g.highlights.at(-1)).toEqual([38, 22, 52, 52]);
      const t = g.transforms.at(-1);
      expect(t[0]).toBeCloseTo((cssW * dpr) / 520);
      expect(t[3]).toBeCloseTo((cssH * dpr) / 500);
    });
  }
});
