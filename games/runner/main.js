import { Controls } from '../../src/runtime/controls.js';

const state = {
  started: false,
  running: false,
  score: 0,
  finalScore: 0,
  collisionTimer: Infinity,
  baseCollisionTimer: Infinity,
  raf: 0
};

const ui = {
  canvas: null,
  score: null,
  share: null,
  pause: null,
  restart: null
};

export function boot() {
  if (state.started) return;
  state.started = true;

  ui.canvas = document.getElementById('game');
  ui.score = document.getElementById('score');
  ui.share = document.getElementById('shareBtn');
  ui.pause = document.getElementById('pauseBtn');
  ui.restart = document.getElementById('restartBtn');

  if (!(ui.canvas instanceof HTMLCanvasElement)) {
    console.error('[runner] missing #game canvas');
    return;
  }

  Controls.init();

  attachHudListeners();
  resetRun(Infinity);
  loop();

  window.loadRunnerLevel = function loadRunnerLevel(level) {
    const frames = computeCollisionFrames(level);
    resetRun(frames);
  };

  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(state.raf);
  });
}

function attachHudListeners() {
  if (ui.pause) {
    ui.pause.addEventListener('click', () => {
      state.running = !state.running;
    });
  }
  if (ui.restart) {
    ui.restart.addEventListener('click', () => {
      resetRun(state.baseCollisionTimer);
    });
  }
}

function loop() {
  update();
  state.raf = requestAnimationFrame(loop);
}

function update() {
  if (!state.running) return;
  state.score += 1;
  updateScoreDisplay();

  if (Number.isFinite(state.collisionTimer)) {
    state.collisionTimer -= 1;
    if (state.collisionTimer <= 0) {
      finishRun();
    }
  }
}

function resetRun(collisionFrames) {
  state.score = 0;
  state.finalScore = 0;
  state.collisionTimer = collisionFrames;
  state.baseCollisionTimer = collisionFrames;
  state.running = true;
  updateScoreDisplay();
  if (ui.share) ui.share.hidden = true;
}

function finishRun() {
  state.running = false;
  state.finalScore = state.score;
  if (ui.share) ui.share.hidden = false;
}

function updateScoreDisplay() {
  if (ui.score) ui.score.textContent = String(state.score);
}

function computeCollisionFrames(level) {
  const obstacles = Array.isArray(level?.obstacles) ? level.obstacles : [];
  if (!obstacles.length) return Infinity;
  const first = obstacles.reduce((min, obs) => (obs && typeof obs.x === 'number' && obs.x < min.x ? obs : min), obstacles[0]);
  const distance = typeof first.x === 'number' ? first.x : 180;
  return clamp(Math.floor(distance / 2) || 60, 45, 180);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

boot();
