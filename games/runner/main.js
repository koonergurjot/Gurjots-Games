import { Controls } from '../../src/runtime/controls.js';

function formatScore(value) {
  return Math.floor(value).toString();
}

export function boot() {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) {
    console.error('[runner] missing #game canvas');
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('[runner] unable to acquire 2d context');
    return;
  }

  const scoreEl = document.getElementById('score');
  const shareBtn = document.getElementById('shareBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const restartBtn = document.getElementById('restartBtn');
  const difficultySelect = document.getElementById('diffSel');

  if (!scoreEl || !shareBtn || !pauseBtn || !restartBtn) {
    console.error('[runner] required HUD elements missing');
    return;
  }

  let raf = 0;
  let lastTime = performance.now();
  let running = true;
  let paused = false;
  let score = 0;
  let collisionTimer = Infinity;
  let currentLevel = { obstacles: [] };
  let speed = 120;

  const controls = Controls.init({
    map: {
      up: ['ArrowUp', 'Space'],
      down: ['ArrowDown', 'KeyS'],
      a: ['Space'],
      pause: ['KeyP', 'Escape'],
      restart: ['KeyR', 'Enter']
    },
    touch: false
  });

  function setDifficulty(diff) {
    if (diff === 'easy') speed = 90;
    else if (diff === 'hard') speed = 160;
    else speed = 120;
  }

  function updateScoreDisplay() {
    scoreEl.textContent = formatScore(score);
  }

  function triggerCollision() {
    if (!running) return;
    running = false;
    shareBtn.hidden = false;
    updateScoreDisplay();
  }

  function loadLevel(data = { obstacles: [] }) {
    currentLevel = { obstacles: Array.isArray(data.obstacles) ? data.obstacles : [] };
    score = 0;
    running = true;
    paused = false;
    collisionTimer = currentLevel.obstacles.length ? 1.2 : Infinity;
    shareBtn.hidden = true;
    updateScoreDisplay();
  }

  window.loadRunnerLevel = loadLevel;

  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.12);
    lastTime = now;

    if (running && !paused) {
      score += speed * dt;
      if (collisionTimer !== Infinity) {
        collisionTimer -= dt;
        if (collisionTimer <= 0) triggerCollision();
      }
      updateScoreDisplay();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    raf = requestAnimationFrame(loop);
  }

  function togglePause() {
    paused = !paused;
  }

  function restart() {
    loadLevel(currentLevel);
  }

  pauseBtn.addEventListener('click', togglePause);
  restartBtn.addEventListener('click', restart);
  controls.on('pause', togglePause);
  controls.on('restart', restart);

  difficultySelect?.addEventListener('change', () => setDifficulty(difficultySelect.value));
  setDifficulty(difficultySelect?.value || 'med');

  loadLevel(currentLevel);
  updateScoreDisplay();

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round((rect.width || window.innerWidth || 960) * ratio);
    const height = Math.round((rect.height || window.innerHeight || 540) * ratio);
    canvas.width = width;
    canvas.height = height;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  window.addEventListener('resize', resize);
  resize();

  raf = requestAnimationFrame(loop);
  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(raf);
    controls.dispose?.();
    window.removeEventListener('resize', resize);
  }, { once: true });
}

boot();
