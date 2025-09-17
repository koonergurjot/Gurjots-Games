import { GameEngine } from '../../shared/gameEngine.js';
import { createParticleSystem } from '../../shared/fx/canvasFx.js';
import getThemeTokens from '../../shared/skins/index.js';
import '../../shared/ui/hud.js';

const hud = document.querySelector('.hud');
hud.innerHTML = `Arrows/WASD or swipe • R restart • P pause
  <label><input type="checkbox" id="dailyToggle"/> Daily</label>
  <ol id="dailyScores" style="margin:4px 0 0 0;padding-left:20px;font-size:14px"></ol>
  <label>Snake <select id="snakeSkin"></select></label>
  <label>Fruit <select id="fruitSkin"></select></label>
  <label>Board <select id="boardSkin"></select></label>
  <label>Size <select id="sizeSel">
      <option value="16">16×16</option>
      <option value="24">24×24</option>
      <option value="32">32×32</option>
    </select></label>
  <label>Boundary <select id="wrapSel">
      <option value="1">Wrap</option>
      <option value="0">No Wrap</option>
    </select></label>
`;

const params = new URLSearchParams(location.search);
const DAILY_SEED = new Date().toISOString().slice(0, 10);
const DAILY_MODE = params.get('daily') === '1';
const toggle = document.getElementById('dailyToggle');
toggle.checked = DAILY_MODE;
function renderScores(){
  const box = document.getElementById('dailyScores');
  if(!box) return;
  if(!DAILY_MODE){
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  const lb = window.LB;
  if(!lb || typeof lb.getTopScores !== 'function'){
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = '';
  const scores = lb.getTopScores('snake', DAILY_SEED, 5) || [];
  box.innerHTML = scores.map(s=>`<li>${s.score}</li>`).join('');
}
window.renderScores = renderScores;
renderScores();
toggle.onchange = ()=>{ params.set('daily', toggle.checked ? '1':'0'); location.search = params.toString(); };
const sizeSel = document.getElementById('sizeSel');
const wrapSel = document.getElementById('wrapSel');
const N = parseInt(params.get('size') || '32');
const WRAP = params.get('wrap') !== '0';
sizeSel.value = String(N);
wrapSel.value = WRAP ? '1' : '0';
sizeSel.onchange = ()=>{ params.set('size', sizeSel.value); location.search = params.toString(); };
wrapSel.onchange = ()=>{ params.set('wrap', wrapSel.value); location.search = params.toString(); };

const c = document.getElementById('c');
fitCanvasToParent(c, 900, 900, 24);
addEventListener('resize', () => fitCanvasToParent(c, 900, 900, 24));
const ctx = c.getContext('2d');
let CELL = c.width / N;
let dir = { x: 1, y: 0 };
let lastDir = { x: 1, y: 0 };
let snake = [
  { x: 5, y: 16 },
  { x: 4, y: 16 },
  { x: 3, y: 16 }
];
let lastSnake = snake.map(s => ({ ...s }));
let speedMs = 120;
let score = 0;
let bestScore = Number(localStorage.getItem('snake:best') || 0);
let dead = false;
let deadHandled = false;
const GAME_ID = 'snake';
GG.incPlays();
const tokens = getThemeTokens('snake');
const SNAKE_SKINS = [
  { id: 'default', name: 'Purple', color: tokens['snake-purple'] || '#8b5cf6', unlock: p => true },
  { id: 'gold', name: 'Gold', color: tokens['snake-gold'] || '#fcd34d', unlock: p => p.best >= 10 },
  { id: 'emerald', name: 'Emerald', color: tokens['snake-emerald'] || '#10b981', unlock: p => p.plays >= 5 }
];
const FRUIT_SKINS = [
  { id: 'classic', name: 'Classic', icons: ['🍎','🍌','🍇','🍒','🍊','🍉'], color: tokens['fruit-classic'] || '#22d3ee', unlock: p => true },
  { id: 'gems', name: 'Gems', icons: ['💎','🔶','🔷'], color: tokens['fruit-gems'] || '#eab308', unlock: p => p.best >= 15 }
];
const BOARD_THEMES = [
  { id: 'dark', name: 'Dark', colors: [tokens['board-dark1'] || '#111623', tokens['board-dark2'] || '#0f1320'], unlock: p => true },
  { id: 'light', name: 'Light', colors: [tokens['board-light1'] || '#f3f4f6', tokens['board-light2'] || '#e5e7eb'], unlock: p => p.plays >= 3 }
];
let FRUITS = ['🍎', '🍌', '🍇', '🍒', '🍊', '🍉'];
const PROGRESS_KEY = 'snake:progress';
const SKIN_KEY = 'snake:skin';
let progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{"plays":0,"best":0}');
function saveProgress() { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); }
progress.plays++;
saveProgress();
let selected = JSON.parse(localStorage.getItem(SKIN_KEY) || '{}');
let snakeSkinId = selected.snake || 'default';
let fruitSkinId = selected.fruit || 'classic';
let boardSkinId = selected.board || 'dark';
function ensureUnlocked(id, arr) {
  const s = arr.find(t => t.id === id);
  return s && s.unlock(progress) ? id : arr[0].id;
}
snakeSkinId = ensureUnlocked(snakeSkinId, SNAKE_SKINS);
fruitSkinId = ensureUnlocked(fruitSkinId, FRUIT_SKINS);
boardSkinId = ensureUnlocked(boardSkinId, BOARD_THEMES);
function saveSkinSelection() {
  localStorage.setItem(SKIN_KEY, JSON.stringify({ snake: snakeSkinId, fruit: fruitSkinId, board: boardSkinId }));
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
let boardColors = ['#111623', '#0f1320'];
let snakeColorHead = '#8b5cf6';
let snakeColorRGB = { r: 139, g: 92, b: 246 };
let fruitColor = '#22d3ee';
let obstacles = [];
const SPECIAL_FOOD = [
  { icon: '⭐', color: '#fbbf24', points: 5, chance: 0.1 },
  { icon: '💎', color: '#60a5fa', points: 10, chance: 0.03 }
];
function applySkin() {
  const s = SNAKE_SKINS.find(t => t.id === snakeSkinId);
  const f = FRUIT_SKINS.find(t => t.id === fruitSkinId);
  const b = BOARD_THEMES.find(t => t.id === boardSkinId);
  boardColors = b.colors;
  snakeColorHead = s.color;
  snakeColorRGB = hexToRgb(s.color);
  FRUITS = f.icons;
  fruitColor = f.color;
  saveSkinSelection();
}
function populateSkinSelects() {
  const ss = document.getElementById('snakeSkin');
  const fs = document.getElementById('fruitSkin');
  const bs = document.getElementById('boardSkin');
  function fill(sel, arr, cur, set) {
    if (!sel) return;
    sel.innerHTML = '';
    arr.forEach(t => {
      const opt = document.createElement('option');
      const unlocked = t.unlock(progress);
      opt.value = t.id;
      opt.textContent = t.name + (unlocked ? '' : ' (locked)');
      opt.disabled = !unlocked;
      if (t.id === cur) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => { set(sel.value); applySkin(); populateSkinSelects(); };
  }
  fill(ss, SNAKE_SKINS, snakeSkinId, v => snakeSkinId = v);
  fill(fs, FRUIT_SKINS, fruitSkinId, v => fruitSkinId = v);
  fill(bs, BOARD_THEMES, boardSkinId, v => boardSkinId = v);
}
let paused = false;
let level = 1;

let rand = Math.random;
if (DAILY_MODE) {
  let s = 0;
  for (let i = 0; i < DAILY_SEED.length; i++) s = (s * 31 + DAILY_SEED.charCodeAt(i)) >>> 0;
  rand = function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  window.SNAKE_SEED = DAILY_SEED;
}

applySkin();
populateSkinSelects();

let food = spawnFood();
let fruitSpawnTime = performance.now();
let turnBuffer = [];
const MAX_TURN_BUFFER = 2;

function togglePause() { paused = !paused; }
document.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'p') togglePause(); });

(function () {
  let start = null;
  c.addEventListener('touchstart', e => { start = e.touches[0]; });
  c.addEventListener('touchmove', e => {
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.clientX, dy = t.clientY - start.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 24) {
      if (Math.abs(dx) > Math.abs(dy)) dir = { x: Math.sign(dx), y: 0 };
      else dir = { x: 0, y: Math.sign(dy) };
      start = t;
    }
    e.preventDefault();
  }, { passive: false });
  c.addEventListener('touchend', () => start = null);
})();

function spawnFood() {
  const r = rand();
  let type = null;
  let acc = 0;
  for (const t of SPECIAL_FOOD) {
    acc += t.chance;
    if (r < acc) { type = t; break; }
  }
  if (!type) {
    type = { icon: FRUITS[Math.floor(rand() * FRUITS.length)], color: fruitColor, points: 1 };
  }
  while (true) {
    const f = { x: (rand() * N) | 0, y: (rand() * N) | 0 };
    if (!snake.some(s => s.x === f.x && s.y === f.y) &&
        !obstacles.some(o => o.x === f.x && o.y === f.y)) return { ...f, ...type };
  }
}

function addObstacleRow() {
  const y = Math.floor(rand() * N);
  for (let x = 4; x < N - 4; x++) obstacles.push({ x, y });
}

function maybeLevelUp() {
  level = 1 + Math.floor(score / 5);
  const best = JSON.parse(localStorage.getItem('gg:lb:' + GAME_ID) || '[]')[0]?.score || score;
  GG.setMeta(GAME_ID, 'Best: ' + best + ' • Lv ' + level);
}

const fx = createParticleSystem(ctx);
let lastTickTime = performance.now();
let moveAcc = 0;

function spawnFruitBurst(x, y, color) {
  for (let i = 0; i < 20; i++) {
    fx.add(x, y, { speed: rand() * 2 + 1, direction: rand() * Math.PI * 2, color, life: 20 });
  }
}

function step() {
  if (turnBuffer.length) {
    const next = turnBuffer.shift();
    if (!(next.x === -lastDir.x && next.y === -lastDir.y)) dir = next;
  }
  lastSnake = snake.map(s => ({ ...s }));
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  lastDir = { ...dir };
  if (WRAP) {
    if (head.x < 0) head.x = N - 1;
    if (head.x >= N) head.x = 0;
    if (head.y < 0) head.y = N - 1;
    if (head.y >= N) head.y = 0;
  } else {
    if (head.x < 0 || head.x >= N || head.y < 0 || head.y >= N) {
      dead = true;
      deadHandled = false;
    }
  }
  if (!dead && (obstacles.some(o => o.x === head.x && o.y === head.y) ||
      snake.some((s, i) => i > 0 && s.x === head.x && s.y === head.y))) {
    dead = true;
    deadHandled = false;
  }
  if (dead) return;
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    score += food.points;
    GG.addXP(food.points);
    SFX.beep({ freq: 660, dur: 0.05 });
    spawnFruitBurst((food.x + 0.5) * CELL, (food.y + 0.5) * CELL, food.color);
    speedMs = Math.max(60, speedMs - food.points * 2);
    food = spawnFood();
    fruitSpawnTime = performance.now();
    maybeLevelUp();
  } else {
    snake.pop();
  }
  lastTickTime = performance.now();
}

function render() {
  const time = performance.now();
  CELL = c.width / N;

  // background with alternating tints
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      ctx.fillStyle = (x + y) % 2 ? boardColors[0] : boardColors[1];
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }

  fx.update();
  fx.draw();

  // fruit with spawn animation
  const ft = Math.min((time - fruitSpawnTime) / 300, 1);
  ctx.save();
  ctx.translate((food.x + 0.5) * CELL, (food.y + 0.5) * CELL);
  ctx.scale(ft, ft);
  ctx.globalAlpha = ft;
  ctx.fillStyle = food.color;
  ctx.fillRect(-CELL / 2, -CELL / 2, CELL, CELL);
  ctx.font = '24px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(food.icon, 0, 4);
  ctx.restore();
  ctx.globalAlpha = 1;

  // snake interpolation
  const t = Math.min((time - lastTickTime) / speedMs, 1);
  snake.forEach((s, idx) => {
    const prev = lastSnake[idx] || lastSnake[lastSnake.length - 1];
    const x = (prev.x + (s.x - prev.x) * t) * CELL;
    const y = (prev.y + (s.y - prev.y) * t) * CELL;
    const fade = 0.8 - (idx / snake.length) * 0.5;
    ctx.fillStyle = idx === 0 ? snakeColorHead : `rgba(${snakeColorRGB.r},${snakeColorRGB.g},${snakeColorRGB.b},${fade})`;
    ctx.fillRect(x, y, CELL, CELL);
  });

  // obstacles
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  obstacles.forEach(o => ctx.fillRect(o.x * CELL, o.y * CELL, CELL, CELL));

  // HUD
  ctx.fillStyle = '#e6e7ea';
  ctx.font = 'bold 20px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Score: ${score} (Best: ${bestScore}) • Lv ${level}`, 16, 28);

  if (score > 0 && score % 10 === 0 && obstacles.length < Math.floor(score / 10) * (N / 2)) addObstacleRow();

  if (paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#e6e7ea';
    ctx.font = 'bold 32px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Paused — P to resume', c.width / 2, c.height / 2);
  } else if (dead) {
    if (!deadHandled) {
      SFX.seq([[200, 0.08, 0.25], [140, 0.1, 0.25]]);
      saveScore(score);
      deadHandled = true;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#e6e7ea';
    ctx.font = 'bold 42px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('You crashed! Press R', c.width / 2, c.height / 2);
  }

}

function saveScore(s) {
  const key = 'gg:lb:' + GAME_ID;
  const lb = JSON.parse(localStorage.getItem(key) || '[]');
  lb.push({ score: s, at: Date.now() });
  lb.sort((a, b) => b.score - a.score);
  const top = lb.slice(0, 5);
  localStorage.setItem(key, JSON.stringify(top));
  const best = top[0]?.score || 0;
  GG.setMeta(GAME_ID, 'Best: ' + best);
  if (s > bestScore) {
    bestScore = s;
    localStorage.setItem('snake:best', bestScore);
  }
  progress.best = Math.max(progress.best, s);
  saveProgress();
  populateSkinSelects();
  if (window.LB) {
    LB.submitScore(GAME_ID, s, DAILY_MODE ? DAILY_SEED : null);
    try { renderScores(); } catch { }
  }
  if (s >= 20) GG.addAch(GAME_ID, 'Fruit Feast');
}

document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'r' && dead) {
    dir = { x: 1, y: 0 };
    lastDir = { x: 1, y: 0 };
    turnBuffer = [];
    snake = [{ x: 5, y: 16 }, { x: 4, y: 16 }, { x: 3, y: 16 }];
    lastSnake = snake.map(s => ({ ...s }));
    food = spawnFood();
    fruitSpawnTime = performance.now();
    speedMs = 120;
    score = 0;
    dead = false;
    deadHandled = false;
    level = 1;
    lastTickTime = performance.now();
    progress.plays++;
    saveProgress();
    populateSkinSelects();
    moveAcc = 0;
    return;
  }
  const map = {
    'arrowup': { x: 0, y: -1 }, 'w': { x: 0, y: -1 },
    'arrowdown': { x: 0, y: 1 }, 's': { x: 0, y: 1 },
    'arrowleft': { x: -1, y: 0 }, 'a': { x: -1, y: 0 },
    'arrowright': { x: 1, y: 0 }, 'd': { x: 1, y: 0 }
  };
  if (map[k]) {
    const nd = map[k];
    if (!(nd.x === -dir.x && nd.y === -dir.y)) {
      if (turnBuffer.length < MAX_TURN_BUFFER) turnBuffer.push(nd);
    }
  }
});

const engine = new GameEngine();
engine.update = dt => {
  if (dead || paused) return;
  moveAcc += dt * 1000;
  while (moveAcc >= speedMs) {
    moveAcc -= speedMs;
    step();
  }
};
engine.render = render;
engine.start();
if (typeof reportReady === 'function') reportReady('snake');
