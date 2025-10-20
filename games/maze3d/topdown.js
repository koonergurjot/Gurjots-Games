import { injectHelpButton, recordLastPlayed, shareScore } from '../../shared/ui.js';
import { gameEvent } from '../../shared/telemetry.js';
import { generateMaze, seedRandom } from './generator.js';
import { formatTime, getBestTimeForSeed, setBestTimeForSeed } from './ui.js';

const MathUtils = (typeof window !== 'undefined' && window.THREE?.MathUtils) ? window.THREE.MathUtils : {
  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
};

const markFirstFrame = (() => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    try {
      window.ggFirstFrame?.();
    } catch (_) {
      /* noop */
    }
  };
})();

function loadPreference(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ?? fallback;
  } catch (err) {
    return fallback;
  }
}

function savePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    /* ignore */
  }
}

async function loadCatalog() {
  const urls = ['/games.json', '/public/games.json'];
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res?.ok) throw new Error(`bad status ${res?.status}`);
      const payload = await res.json();
      return Array.isArray(payload?.games) ? payload.games : (Array.isArray(payload) ? payload : []);
    } catch (err) {
      lastError = err;
    }
  }
  console.warn('maze3d: catalog unavailable for fallback view', lastError);
  return [];
}

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toTrimmedList(value) {
  if (Array.isArray(value)) return value.map((item) => toTrimmedString(item)).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function sanitizeHelp(source) {
  const base = source && typeof source === 'object' ? source : {};
  const fallbackSteps = toTrimmedList(window.helpSteps);
  const help = {
    objective: toTrimmedString(base.objective),
    controls: toTrimmedString(base.controls),
    tips: toTrimmedList(base.tips),
    steps: toTrimmedList(base.steps)
  };
  if (!help.steps.length && fallbackSteps.length) help.steps = fallbackSteps;
  return help;
}

function hashSeedFromString(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) % 2147483647;
  }
  hash = (hash + 2147483647) % 2147483647;
  if (hash === 0) hash = 2147483646;
  return hash;
}

function getTodaySeedLabel(date = new Date()) {
  try {
    const iso = new Date(date).toISOString();
    return iso.slice(0, 10);
  } catch (err) {
    return new Date().toISOString().slice(0, 10);
  }
}

function createSeedInfo(mode, overrideSeed) {
  if (overrideSeed !== undefined && overrideSeed !== null) {
    if (Number.isFinite(overrideSeed)) {
      const numeric = Math.max(1, Math.floor(Number(overrideSeed)));
      return {
        value: numeric,
        label: String(numeric),
        display: `#${numeric}`,
        key: `seed:${numeric}`,
        daily: false,
      };
    }
    const normalized = String(overrideSeed).trim();
    if (normalized) {
      const hashed = hashSeedFromString(normalized);
      return {
        value: hashed,
        label: normalized,
        display: normalized,
        key: `seed:${normalized}`,
        daily: false,
      };
    }
  }

  if (mode === 'daily') {
    const label = getTodaySeedLabel();
    const hashed = hashSeedFromString(label);
    return {
      value: hashed,
      label,
      display: `Daily ${label}`,
      key: `daily:${label}`,
      daily: true,
    };
  }

  const randomSeed = Math.max(1, Math.floor(Math.random() * 1e9));
  return {
    value: randomSeed,
    label: `#${randomSeed}`,
    display: `#${randomSeed}`,
    key: `seed:${randomSeed}`,
    daily: false,
  };
}

const MATERIAL_DEFAULTS = {
  floor: {
    baseColor: '#394055',
    accentColor: '#2a3142',
    roughness: 0.78,
    metalness: 0.08,
    normalIntensity: 0.22,
  },
  wall: {
    baseColor: '#7e8894',
    accentColor: '#555e6d',
    roughness: 0.86,
    metalness: 0.06,
    normalIntensity: 0.3,
  }
};

function mergeMaterialSettings(defaults, overrides = {}) {
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (!(key in overrides)) continue;
    const value = overrides[key];
    if (typeof defaults[key] === 'number') {
      const num = Number(value);
      if (Number.isFinite(num)) result[key] = MathUtils.clamp(num, 0, 5);
    } else if (typeof defaults[key] === 'string') {
      if (typeof value === 'string' && value.trim()) result[key] = value.trim();
    }
  }
  return result;
}

async function loadMaterialConfig() {
  try {
    const res = await fetch('../../assets/maze3d/materials.json', { cache: 'no-store' });
    if (!res?.ok) throw new Error(`bad status ${res?.status}`);
    const payload = await res.json();
    const floor = mergeMaterialSettings(MATERIAL_DEFAULTS.floor, payload?.floor || {});
    const wall = mergeMaterialSettings(MATERIAL_DEFAULTS.wall, payload?.wall || {});
    return { floor, wall };
  } catch (err) {
    console.warn('maze3d: failed to load fallback material config, using defaults', err);
    return { ...MATERIAL_DEFAULTS };
  }
}

const SEED_MODES = new Set(['random', 'daily']);
let initialized = false;

export async function startTopDownFallback({ reason } = {}) {
  if (initialized) return;
  initialized = true;

  const materialConfig = await loadMaterialConfig();
  const games = await loadCatalog();
  const helpEntry = games.find((g) => g?.id === 'maze3d' || g?.slug === 'maze3d');
  const help = sanitizeHelp(helpEntry?.help || window.helpData || {});
  window.helpData = help;
  injectHelpButton({ gameId: 'maze3d', ...help });
  recordLastPlayed('maze3d');
  gameEvent('maze3d_renderer_selected', {
    slug: 'maze3d',
    renderer: 'canvas',
    reason: reason?.message || reason?.toString?.() || 'fallback',
  });

  const overlay = document.getElementById('overlay');
  const message = document.getElementById('message');
  const startBtn = document.getElementById('startBtn');
  const restartBtn = document.getElementById('restartBtn');
  const shareBtn = document.getElementById('shareBtn');
  const sizeSelect = document.getElementById('mazeSize');
  const enemySelect = document.getElementById('enemyCount');
  const roomInput = document.getElementById('roomInput');
  const connectBtn = document.getElementById('connectBtn');
  const rematchBtn = document.getElementById('rematchBtn');
  const algorithmSelect = document.getElementById('mazeAlgorithm');
  const assistSelect = document.getElementById('assistMode');
  const controlSelect = document.getElementById('controlProfile');
  const seedModeSelect = document.getElementById('seedMode');
  const noMapToggle = document.getElementById('noMapToggle');
  const timeEl = document.getElementById('time');
  const oppTimeEl = document.getElementById('oppTime');
  const bestEl = document.getElementById('best');
  const seedLabelEl = document.getElementById('seedLabel');

  if (enemySelect) {
    enemySelect.value = '0';
    enemySelect.disabled = true;
  }
  if (assistSelect) {
    assistSelect.value = 'off';
    assistSelect.disabled = true;
  }
  if (controlSelect) {
    controlSelect.disabled = true;
  }
  if (roomInput) {
    roomInput.value = '';
    roomInput.disabled = true;
  }
  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.title = 'Online play unavailable in canvas mode';
  }
  if (rematchBtn) {
    rematchBtn.style.display = 'none';
  }
  if (shareBtn) {
    shareBtn.style.display = 'none';
  }
  if (noMapToggle) {
    noMapToggle.checked = true;
    noMapToggle.disabled = true;
  }
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.display = 'block';
  canvas.style.background = '#0b111c';
  canvas.style.zIndex = '0';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('maze3d: unable to acquire 2D canvas context for fallback renderer');
    if (message) {
      message.textContent = 'Canvas renderer unavailable.';
    }
    showOverlay();
    return;
  }
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  function resizeCanvas() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(height * pixelRatio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function showOverlay() {
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
  }

  const BASE_CELLS = 8;
  if (sizeSelect && sizeSelect.querySelector(`option[value="${BASE_CELLS}"]`)) {
    sizeSelect.value = String(BASE_CELLS);
  }
  const SEED_PREF_KEY = 'maze3d:fallbackSeedMode';
  let seedMode = loadPreference(SEED_PREF_KEY, 'random');
  if (!SEED_MODES.has(seedMode)) seedMode = 'random';
  if (seedModeSelect) seedModeSelect.value = seedMode;
  let currentSeedInfo = createSeedInfo(seedMode);
  let currentSeed = currentSeedInfo.value;
  let currentSeedKey = currentSeedInfo.key;
  let currentSeedLabel = currentSeedInfo.label;
  let currentSeedDisplay = currentSeedInfo.display;
  let currentSeedIsDaily = currentSeedInfo.daily;
  let bestForSeed = getBestTimeForSeed(currentSeedKey);

  const inputState = {
    up: false,
    down: false,
    left: false,
    right: false,
  };

  const keyBindings = {
    up: new Set(['w', 'arrowup']),
    down: new Set(['s', 'arrowdown']),
    left: new Set(['a', 'arrowleft']),
    right: new Set(['d', 'arrowright']),
  };

  window.addEventListener('keydown', (event) => {
    const key = event.key?.toLowerCase?.();
    let handled = false;
    for (const dir of Object.keys(keyBindings)) {
      if (keyBindings[dir].has(key)) {
        inputState[dir] = true;
        handled = true;
      }
    }
    if (handled) {
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    const key = event.key?.toLowerCase?.();
    for (const dir of Object.keys(keyBindings)) {
      if (keyBindings[dir].has(key)) {
        inputState[dir] = false;
      }
    }
  });

  let mazeGrid = [];
  let mazeCols = 0;
  let mazeRows = 0;
  let solutionCells = [];
  let MAZE_CELLS = BASE_CELLS;
  let player = { x: 1, y: 1, vx: 0, vy: 0 };
  let exitCell = { x: 0, y: 0 };
  let trail = [];
  const MAX_TRAIL = 120;
  const PLAYER_RADIUS = 0.32;
  const MOVE_SPEED = 3.6;
  const ACCEL = 10.5;
  const DECEL = 14;

  let running = false;
  let paused = true;
  let startTime = 0;
  let timerOffset = 0;
  let timerRunning = false;
  let finished = false;

  function updateTimerDisplay(seconds) {
    if (timeEl) timeEl.textContent = formatTime(seconds);
  }

  function setBestDisplay(seconds) {
    if (!bestEl) return;
    if (Number.isFinite(seconds) && seconds > 0) {
      bestEl.textContent = formatTime(seconds);
    } else {
      bestEl.textContent = '--';
    }
  }

  function getTimerSeconds(now = performance.now()) {
    if (!timerRunning) return timerOffset / 1000;
    return (timerOffset + Math.max(0, now - startTime)) / 1000;
  }

  function startTimer(now) {
    if (timerRunning) return;
    startTime = now;
    timerRunning = true;
  }

  function stopTimer(now) {
    if (!timerRunning) return timerOffset / 1000;
    timerOffset += Math.max(0, now - startTime);
    timerRunning = false;
    return timerOffset / 1000;
  }

  function resetTimer() {
    startTime = 0;
    timerOffset = 0;
    timerRunning = false;
    updateTimerDisplay(0);
  }

  function updateMazeParams() {
    const sizeValue = sizeSelect?.value ?? String(BASE_CELLS);
    MAZE_CELLS = parseInt(sizeValue, 10) || BASE_CELLS;
  }

  function buildMaze(seed) {
    updateMazeParams();
    const algorithmPref = algorithmSelect?.value || 'auto';
    let algorithm = algorithmPref;
    if (algorithm === 'auto') {
      const rand = seedRandom(seed);
      algorithm = rand() < 0.5 ? 'prim' : 'backtracker';
    }
    const { grid, solution } = generateMaze(MAZE_CELLS, MAZE_CELLS, { algorithm, seed });
    mazeGrid = grid;
    mazeRows = grid.length;
    mazeCols = grid[0].length;
    solutionCells = solution.map(([x, y]) => ({ x, y }));
    exitCell = { x: mazeCols - 2, y: mazeRows - 2 };
    player = { x: 1.5, y: 1.5, vx: 0, vy: 0 };
    trail = [];
    finished = false;
    if (oppTimeEl) oppTimeEl.textContent = '--';
    bestForSeed = getBestTimeForSeed(currentSeedKey);
    setBestDisplay(bestForSeed);
    resetTimer();
  }

  function setSeedInfo(info) {
    currentSeedInfo = info;
    currentSeed = info.value;
    currentSeedKey = info.key;
    currentSeedLabel = info.label;
    currentSeedDisplay = info.display;
    currentSeedIsDaily = info.daily;
    bestForSeed = getBestTimeForSeed(currentSeedKey);
    setBestDisplay(bestForSeed);
    if (seedLabelEl) seedLabelEl.textContent = currentSeedDisplay;
  }

  setSeedInfo(currentSeedInfo);
  buildMaze(currentSeed);

  function computeInputVector() {
    const x = (inputState.right ? 1 : 0) - (inputState.left ? 1 : 0);
    const y = (inputState.down ? 1 : 0) - (inputState.up ? 1 : 0);
    const length = Math.hypot(x, y);
    if (length === 0) return { x: 0, y: 0 };
    return { x: x / length, y: y / length };
  }

  function isBlocked(nx, ny) {
    const samples = [
      [nx - PLAYER_RADIUS, ny - PLAYER_RADIUS],
      [nx + PLAYER_RADIUS, ny - PLAYER_RADIUS],
      [nx - PLAYER_RADIUS, ny + PLAYER_RADIUS],
      [nx + PLAYER_RADIUS, ny + PLAYER_RADIUS],
    ];
    for (const [sx, sy] of samples) {
      const cx = Math.floor(sx);
      const cy = Math.floor(sy);
      if (cy < 0 || cy >= mazeRows || cx < 0 || cx >= mazeCols) return true;
      if (mazeGrid[cy][cx] !== 0) return true;
    }
    return false;
  }

  function updatePlayer(dt) {
    const desired = computeInputVector();
    const hasInput = desired.x !== 0 || desired.y !== 0;
    const accel = hasInput ? ACCEL : DECEL;
    const targetVx = desired.x * MOVE_SPEED;
    const targetVy = desired.y * MOVE_SPEED;
    player.vx += (targetVx - player.vx) * Math.min(1, accel * dt);
    player.vy += (targetVy - player.vy) * Math.min(1, accel * dt);
    if (!hasInput && Math.hypot(player.vx, player.vy) < 0.01) {
      player.vx = 0;
      player.vy = 0;
    }
    let nx = player.x + player.vx * dt;
    let ny = player.y + player.vy * dt;
    if (isBlocked(nx, player.y)) {
      nx = player.x;
      player.vx = 0;
    }
    if (isBlocked(player.x, ny)) {
      ny = player.y;
      player.vy = 0;
    }
    player.x = nx;
    player.y = ny;
    trail.push({ x: player.x, y: player.y });
    if (trail.length > MAX_TRAIL) trail.shift();
  }

  function checkWin(now) {
    if (finished) return;
    const dx = player.x - exitCell.x - 0.5;
    const dy = player.y - exitCell.y - 0.5;
    if (Math.hypot(dx, dy) < 0.45) {
      finished = true;
      running = false;
      paused = true;
      const elapsed = stopTimer(now);
      updateTimerDisplay(elapsed);
      const previousBest = Number.isFinite(bestForSeed) ? bestForSeed : null;
      if (previousBest == null || elapsed < previousBest) {
        const stored = setBestTimeForSeed(currentSeedKey, elapsed);
        bestForSeed = Number.isFinite(stored) ? stored : elapsed;
      }
      setBestDisplay(bestForSeed);
      if (message) {
        message.innerHTML = `Finished in <strong>${formatTime(elapsed)}</strong>s`;
      }
      if (restartBtn) restartBtn.style.display = 'inline-block';
      if (shareBtn) {
        shareBtn.style.display = 'inline-block';
        shareBtn.disabled = false;
      }
      showOverlay();
      const durationMs = Math.round(elapsed * 1000);
      gameEvent('end', {
        slug: 'maze3d',
        durationMs,
        meta: {
          renderer: 'canvas',
          seed: currentSeed,
          seedKey: currentSeedKey,
          daily: currentSeedIsDaily,
          mode: 'fallback',
        },
      });
      gameEvent('game_over', {
        slug: 'maze3d',
        outcome: 'win',
        meta: {
          renderer: 'canvas',
          seed: currentSeed,
          seedKey: currentSeedKey,
          daily: currentSeedIsDaily,
          time: elapsed,
          mode: 'fallback',
        },
      });
    }
  }

  function draw() {
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.save();
    ctx.scale(pixelRatio, pixelRatio);
    ctx.clearRect(0, 0, width / pixelRatio, height / pixelRatio);

    const padding = 32;
    const viewWidth = (width / pixelRatio) - padding * 2;
    const viewHeight = (height / pixelRatio) - padding * 2;
    const cellSize = Math.min(viewWidth / mazeCols, viewHeight / mazeRows);
    const offsetX = ((width / pixelRatio) - cellSize * mazeCols) / 2;
    const offsetY = ((height / pixelRatio) - cellSize * mazeRows) / 2;

    ctx.fillStyle = materialConfig.wall.accentColor;
    ctx.fillRect(offsetX, offsetY, cellSize * mazeCols, cellSize * mazeRows);

    ctx.fillStyle = materialConfig.floor.baseColor;
    for (let y = 0; y < mazeRows; y++) {
      for (let x = 0; x < mazeCols; x++) {
        if (mazeGrid[y][x] !== 0) continue;
        const px = offsetX + x * cellSize;
        const py = offsetY + y * cellSize;
        ctx.fillRect(px, py, cellSize, cellSize);
      }
    }

    if (solutionCells.length && !running) {
      ctx.strokeStyle = 'rgba(56,189,248,0.45)';
      ctx.lineWidth = Math.max(1.5, cellSize * 0.15);
      ctx.beginPath();
      for (let i = 0; i < solutionCells.length; i++) {
        const { x, y } = solutionCells[i];
        const cx = offsetX + (x + 0.5) * cellSize;
        const cy = offsetY + (y + 0.5) * cellSize;
        if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    ctx.fillStyle = '#22d3ee';
    ctx.shadowColor = 'rgba(34,211,238,0.45)';
    ctx.shadowBlur = cellSize * 0.6;
    ctx.beginPath();
    ctx.arc(offsetX + (exitCell.x + 0.5) * cellSize, offsetY + (exitCell.y + 0.5) * cellSize, cellSize * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (trail.length > 8) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
      for (let i = 0; i < trail.length; i += 3) {
        const { x, y } = trail[i];
        const alpha = i / trail.length;
        ctx.globalAlpha = Math.min(0.4, alpha + 0.15);
        ctx.beginPath();
        ctx.arc(offsetX + x * cellSize, offsetY + y * cellSize, cellSize * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(1, cellSize * 0.1);
    ctx.beginPath();
    ctx.arc(offsetX + player.x * cellSize, offsetY + player.y * cellSize, cellSize * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
    markFirstFrame();
  }

  function restartGame(newSeedInfo) {
    setSeedInfo(newSeedInfo || currentSeedInfo);
    buildMaze(currentSeed);
    running = false;
    paused = true;
    finished = false;
    if (message) {
      message.innerHTML = 'Canvas fallback active.<br/>Use WASD or arrow keys to move.';
    }
    if (startBtn) startBtn.textContent = 'Start';
    if (restartBtn) restartBtn.style.display = 'none';
    if (shareBtn) shareBtn.style.display = 'none';
    updateTimerDisplay(0);
    showOverlay();
  }

  restartGame(currentSeedInfo);

  function startGame() {
    if (finished) {
      restartGame(currentSeedInfo);
    }
    running = true;
    paused = false;
    const now = performance.now();
    startTimer(now);
    hideOverlay();
    if (startBtn) startBtn.textContent = 'Pause';
    gameEvent('start', {
      slug: 'maze3d',
      meta: {
        renderer: 'canvas',
        seed: currentSeed,
        seedKey: currentSeedKey,
        daily: currentSeedIsDaily,
        mode: 'fallback',
      },
    });
  }

  function pauseGame() {
    if (!running || paused) return;
    paused = true;
    const now = performance.now();
    const elapsed = stopTimer(now);
    updateTimerDisplay(elapsed);
    if (message) message.textContent = 'Paused';
    showOverlay();
    if (startBtn) startBtn.textContent = 'Resume';
  }

  startBtn?.addEventListener('click', () => {
    if (!running || finished) {
      startGame();
    } else if (paused) {
      paused = false;
      startTimer(performance.now());
      hideOverlay();
      if (startBtn) startBtn.textContent = 'Pause';
    } else {
      pauseGame();
    }
  });

  restartBtn?.addEventListener('click', () => {
    restartGame(currentSeedInfo);
  });

  shareBtn?.addEventListener('click', async () => {
    const elapsed = getTimerSeconds();
    try {
      await shareScore({
        gameId: 'maze3d',
        title: '3D Maze (Canvas Mode)',
        text: `I cleared the maze in ${formatTime(elapsed)}s!`,
        url: window.location?.href,
      });
    } catch (err) {
      console.warn('maze3d: share failed', err);
    }
  });

  seedModeSelect?.addEventListener('change', () => {
    const value = seedModeSelect.value;
    if (!SEED_MODES.has(value)) return;
    seedMode = value;
    savePreference(SEED_PREF_KEY, seedMode);
    const info = createSeedInfo(seedMode);
    restartGame(info);
  });

  sizeSelect?.addEventListener('change', () => {
    restartGame(currentSeedInfo);
  });

  algorithmSelect?.addEventListener('change', () => {
    restartGame(currentSeedInfo);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'p' || event.key === 'P') {
      if (!running) return;
      if (paused) {
        paused = false;
        startTimer(performance.now());
        hideOverlay();
        if (startBtn) startBtn.textContent = 'Pause';
      } else {
        pauseGame();
      }
    }
    if (event.key === 'r' || event.key === 'R') {
      restartGame(currentSeedInfo);
    }
  });

  if (message) {
    const fallbackReason = reason?.message || reason?.toString?.();
    const details = fallbackReason ? ` (${fallbackReason})` : '';
    message.innerHTML = `Canvas fallback active${details}.<br/>Use WASD or arrow keys to move.`;
  }
  showOverlay();

  let lastFrame = performance.now();
  function loop(now) {
    const dt = Math.min(0.2, (now - lastFrame) / 1000);
    lastFrame = now;
    if (running && !paused && !finished) {
      updatePlayer(dt);
      updateTimerDisplay(getTimerSeconds(now));
      checkWin(now);
    }
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
