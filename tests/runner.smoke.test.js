/* @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = global.fetch;

let rafQueue;
let nextFrameId;
let currentTime;

function defineWindowMetric(prop, value) {
  Object.defineProperty(window, prop, {
    configurable: true,
    get: () => value,
  });
}

function installCanvasStub() {
  const ctxStub = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    strokeRect: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    globalAlpha: 1,
    translate: vi.fn(),
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxStub);
}

function installAnimationMocks() {
  rafQueue = new Map();
  nextFrameId = 1;
  currentTime = 0;

  vi.spyOn(global, 'requestAnimationFrame').mockImplementation(cb => {
    const id = nextFrameId++;
    rafQueue.set(id, cb);
    return id;
  });
  vi.spyOn(global, 'cancelAnimationFrame').mockImplementation(id => {
    rafQueue.delete(id);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => currentTime);
}

function stepFrame(ms = 16) {
  const entry = rafQueue.entries().next();
  if (entry.done) return false;
  const [id, cb] = entry.value;
  rafQueue.delete(id);
  currentTime += ms;
  cb(currentTime);
  return true;
}

function advanceFrames(count, ms = 16) {
  for (let i = 0; i < count; i++) {
    if (!stepFrame(ms)) break;
  }
}

function advanceUntil(predicate, maxFrames = 240, ms = 16) {
  for (let i = 0; i < maxFrames; i++) {
    if (predicate()) return;
    if (!stepFrame(ms)) return;
  }
}

describe('runner gameplay smoke test', () => {
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();

    document.body.innerHTML = `
      <canvas id="game"></canvas>
      <div class="hud">
        <span id="score">0</span>
        <span id="mission"></span>
        <button id="pauseBtn"></button>
        <button id="restartBtn"></button>
        <button id="shareBtn" hidden></button>
        <label>
          <select id="diffSel" name="diffSel">
            <option value="easy">Easy</option>
            <option value="med" selected>Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
      </div>
    `;

    defineWindowMetric('innerWidth', 800);
    defineWindowMetric('innerHeight', 450);
    defineWindowMetric('devicePixelRatio', 1);

    installCanvasStub();
    installAnimationMocks();

    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([{ id: 'runner', help: {} }]),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('launches the game, increments score, and stops on collision', async () => {
    const readyPromise = new Promise(resolve => {
      const bridge = window.Runner || (window.Runner = {});
      const queue = Array.isArray(bridge.onReady) ? bridge.onReady : [];
      if (!Array.isArray(bridge.onReady)) bridge.onReady = queue;
      queue.push(game => resolve(game));
    });

    await import('../games/runner/main.js');
    const runner = await readyPromise;

    runner?.applyResume?.({ emitEvent: false });
    runner?.start?.();

    const scoreEl = document.getElementById('score');
    const shareBtn = document.getElementById('shareBtn');

    advanceUntil(() => Number(scoreEl.textContent) > 0, 180);
    expect(Number(scoreEl.textContent)).toBeGreaterThan(0);
    expect(shareBtn.hidden).toBe(true);

    runner?.loadLevel?.({
      background: { clouds: [], buildings: [], foreground: [] },
      obstacles: [
        { x: 120, y: 0, w: 30, h: 120 },
      ],
    }, { resetScore: true, silent: false, autoStart: true });

    expect(Number(scoreEl.textContent)).toBe(0);

    advanceUntil(() => shareBtn.hidden === false, 240);
    expect(shareBtn.hidden).toBe(false);
    const finalScore = Number(scoreEl.textContent);
    expect(finalScore).toBeGreaterThan(0);

    advanceFrames(5);
    expect(Number(scoreEl.textContent)).toBe(finalScore);
  });
});
