import { PointerLockControls } from "./PointerLockControls.js";
import '/js/three-global-shim.js';
import { injectHelpButton, recordLastPlayed, shareScore } from '../../shared/ui.js';
import { emitEvent } from '../../shared/achievements.js';
import { connect } from './net.js';
import { generateMaze, seedRandom } from './generator.js';

async function loadCatalog() {
  const urls = ['/games.json', '/public/games.json'];
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res?.ok) throw new Error(`bad status ${res?.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('catalog unavailable');
}

let games = [];
try {
  games = await loadCatalog();
} catch (err) {
  console.warn('maze3d: catalog fetch failed, using empty list', err);
}

const help = games.find(g => g.id === 'maze3d')?.help || {};
injectHelpButton({ gameId: 'maze3d', ...help });
recordLastPlayed('maze3d');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0f12);
scene.fog = new THREE.Fog(0x0e0f12, 10, 60);

const texLoader = new THREE.TextureLoader();
const wallTexture = texLoader.load('https://threejs.org/examples/textures/brick_diffuse.jpg');
wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
wallTexture.repeat.set(1, 1);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
// minimap
const mapRenderer = new THREE.WebGLRenderer({ antialias: false });
mapRenderer.setSize(200, 200);
mapRenderer.domElement.style.position='fixed'; mapRenderer.domElement.style.right='12px'; mapRenderer.domElement.style.bottom='12px'; mapRenderer.domElement.style.border='1px solid rgba(255,255,255,0.2)'; mapRenderer.domElement.style.borderRadius='6px';
document.body.appendChild(mapRenderer.domElement);
let mapVisible = true;
mapRenderer.domElement.style.display = 'block';

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(10, 20, 10);
dir.castShadow = true;
scene.add(dir);

const playerLight = new THREE.PointLight(0xffffff, 1, 20, 2);
playerLight.castShadow = true;
scene.add(playerLight);

const controls = new PointerLockControls(camera, renderer.domElement);
const player = controls.getObject();
let opponent = { mesh: null };
let timeEl;
let oppTimeEl;
let bestEl;

const diagStateListeners = new Set();
const pointerLockListeners = new Set();
const networkLatencyListeners = new Set();

let diagState = 'init';
let lastStateMeta = { state: diagState, timestamp: Date.now(), reason: 'bootstrap' };
let lastPointerLock = controls.isLocked;
let lastPointerLockMeta = { locked: lastPointerLock, timestamp: Date.now(), source: 'bootstrap' };
let lastNetworkLatency = null;
let lastNetworkMeta = { latency: null, timestamp: Date.now(), source: 'bootstrap' };

function notifyDiagnosticsState(state, meta = {}) {
  const normalized = typeof state === 'string' && state.trim() ? state.trim() : 'unknown';
  const detail = { ...meta, state: normalized, timestamp: Date.now() };
  diagState = normalized;
  lastStateMeta = detail;
  diagStateListeners.forEach((listener) => {
    try {
      listener(normalized, detail);
    } catch (err) {
      console.error('maze3d: diagnostics state listener failed', err);
    }
  });
}

function notifyPointerLockChange(locked, meta = {}) {
  const isLocked = !!locked;
  const detail = { ...meta, locked: isLocked, timestamp: Date.now() };
  lastPointerLock = isLocked;
  lastPointerLockMeta = detail;
  pointerLockListeners.forEach((listener) => {
    try {
      listener(isLocked, detail);
    } catch (err) {
      console.error('maze3d: diagnostics pointer-lock listener failed', err);
    }
  });
}

function notifyNetworkLatency(latency, meta = {}) {
  const numeric = typeof latency === 'number' && Number.isFinite(latency) ? latency : null;
  const detail = { ...meta, latency: numeric, timestamp: Date.now() };
  lastNetworkLatency = numeric;
  lastNetworkMeta = detail;
  networkLatencyListeners.forEach((listener) => {
    try {
      listener(numeric, detail);
    } catch (err) {
      console.error('maze3d: diagnostics network listener failed', err);
    }
  });
}

function createDiagnosticsSubscription(set, currentValue, currentMeta, listener) {
  if (typeof listener !== 'function') return () => {};
  try {
    listener(currentValue, { ...currentMeta, replay: true });
  } catch (err) {
    console.error('maze3d: diagnostics subscription replay failed', err);
  }
  set.add(listener);
  return () => set.delete(listener);
}

function onDiagnosticsStateChange(listener) {
  return createDiagnosticsSubscription(diagStateListeners, diagState, lastStateMeta, listener);
}

function onDiagnosticsPointerLockChange(listener) {
  return createDiagnosticsSubscription(pointerLockListeners, lastPointerLock, lastPointerLockMeta, listener);
}

function onDiagnosticsNetworkLatency(listener) {
  return createDiagnosticsSubscription(networkLatencyListeners, lastNetworkLatency, lastNetworkMeta, listener);
}

function vectorToSnapshot(vec) {
  if (!vec) return null;
  const { x, y, z } = vec;
  return {
    x: Number.isFinite(x) ? Number(x.toFixed(3)) : null,
    y: Number.isFinite(y) ? Number(y.toFixed(3)) : null,
    z: Number.isFinite(z) ? Number(z.toFixed(3)) : null,
  };
}

function parseHudTime(text) {
  if (typeof text !== 'string') return null;
  const value = parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

function getDiagnosticsSnapshot() {
  const hudTime = parseHudTime(timeEl?.textContent ?? '');
  const hudOpponentTime = parseHudTime(oppTimeEl?.textContent ?? '');
  const perf = typeof performance !== 'undefined' ? performance : null;
  let elapsedSeconds = null;
  if (running && !paused && perf && typeof startTime === 'number' && startTime > 0) {
    elapsedSeconds = (perf.now() - startTime) / 1000;
  } else if (typeof myFinish === 'number') {
    elapsedSeconds = myFinish;
  } else if (hudTime != null) {
    elapsedSeconds = hudTime;
  }
  if (elapsedSeconds != null && Number.isFinite(elapsedSeconds)) {
    elapsedSeconds = Number(elapsedSeconds.toFixed(3));
  } else {
    elapsedSeconds = null;
  }
  let opponentSeconds = null;
  if (typeof opponentFinish === 'number') {
    opponentSeconds = opponentFinish;
  } else if (hudOpponentTime != null) {
    opponentSeconds = hudOpponentTime;
  }
  if (opponentSeconds != null && Number.isFinite(opponentSeconds)) {
    opponentSeconds = Number(opponentSeconds.toFixed(3));
  } else {
    opponentSeconds = null;
  }
  const bestSeconds = Number.isFinite(best) && best > 0 ? Number(best) : null;
  const finishSeconds = typeof myFinish === 'number' ? Number(myFinish.toFixed(3)) : null;
  return {
    timestamp: Date.now(),
    state: {
      label: diagState,
      running,
      paused,
      finished: !!myFinish,
      meta: { ...lastStateMeta },
    },
    pointerLock: {
      locked: controls.isLocked,
      meta: { ...lastPointerLockMeta },
    },
    network: {
      latencyMs: lastNetworkLatency,
      meta: { ...lastNetworkMeta },
    },
    timers: {
      elapsedSeconds,
      finishSeconds,
      opponentFinishSeconds: opponentSeconds,
      bestSeconds,
      hudTimeSeconds: hudTime,
      hudOpponentSeconds: hudOpponentTime,
      startTimestamp: typeof startTime === 'number' ? startTime : null,
    },
    player: vectorToSnapshot(player?.position ?? null),
    opponent: vectorToSnapshot(opponent.mesh?.position ?? null),
    mapVisible,
  };
}

notifyDiagnosticsState('init', { reason: 'bootstrap', initial: true });
notifyPointerLockChange(controls.isLocked, { source: 'bootstrap', initial: true });
notifyNetworkLatency(null, { source: 'bootstrap', initial: true });

controls.addEventListener('lock', () => {
  notifyPointerLockChange(true, { source: 'controls', type: 'lock' });
});

controls.addEventListener('unlock', () => {
  notifyPointerLockChange(false, { source: 'controls', type: 'unlock' });
});

const readyListeners = new Set();
let readyNotified = false;

function notifyReadyListeners() {
  if (readyNotified) return;
  readyNotified = true;
  readyListeners.forEach((listener) => {
    try {
      listener({ player, opponent });
    } catch (err) {
      console.error('maze3d: onReady listener failed', err);
    }
  });
  readyListeners.clear();
}

function registerReadyListener(listener) {
  if (typeof listener !== 'function') return () => {};
  if (readyNotified) {
    try {
      listener({ player, opponent });
    } catch (err) {
      console.error('maze3d: onReady listener failed', err);
    }
    return () => {};
  }
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

if (typeof window !== 'undefined') {
  window.Maze3D = {
    start,
    pause,
    resume,
    restart,
    player,
    opponent,
    controls,
    onReady: registerReadyListener,
    onDiagnosticsStateChange,
    onDiagnosticsPointerLockChange,
    onDiagnosticsNetworkLatency,
    getDiagnosticsSnapshot,
  };

  import('./adapter.js').catch((err) => {
    console.warn('maze3d: diagnostics adapter failed to load', err);
  });
}

let overlay = document.getElementById('overlay');
let message = document.getElementById('message');
let startBtn = document.getElementById('startBtn');
let restartBtn = document.getElementById('restartBtn');
let shareBtn = document.getElementById('shareBtn');
timeEl = document.getElementById('time');
oppTimeEl = document.getElementById('oppTime');
bestEl = document.getElementById('best');
let sizeSelect = document.getElementById('mazeSize');
let enemySelect = document.getElementById('enemyCount');
let roomInput = document.getElementById('roomInput');
let connectBtn = document.getElementById('connectBtn');
let rematchBtn = document.getElementById('rematchBtn');

({
  overlay,
  message,
  startBtn,
  restartBtn,
  shareBtn,
  sizeSelect,
  enemySelect,
  roomInput,
  connectBtn,
  rematchBtn
} = ensureOverlayElements({
  overlay,
  message,
  startBtn,
  restartBtn,
  shareBtn,
  sizeSelect,
  enemySelect,
  roomInput,
  connectBtn,
  rematchBtn
}));

({ timeEl, oppTimeEl, bestEl } = ensureHudElements({ timeEl, oppTimeEl, bestEl }));

let running = false;
let paused = true;
let pausedByShell = false;
let shellRenderPaused = false;
let loopRaf = 0;
let startTime = 0;
let best = Number(localStorage.getItem('besttime:maze3d') || 0);
let net = null;
let currentSeed = Math.floor(Math.random()*1e9);
const myId = Math.random().toString(36).slice(2,8);
let opponentFinish = null;
let myFinish = null;
let lastPosSent = 0;
let postedReady=false;
if (roomInput) roomInput.value = Math.random().toString(36).slice(2,7);
if (best) bestEl.textContent = best.toFixed(2);

let trail = []; let lastTrailPos = null;

const keys = {};
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyR') restart();
  if (e.code === 'KeyM' && !e.repeat) toggleMap();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

startBtn?.addEventListener('click', () => start());
restartBtn?.addEventListener('click', () => restart());
sizeSelect?.addEventListener('change', () => restart());
enemySelect?.addEventListener('change', () => restart());
connectBtn?.addEventListener('click', connectMatch);
rematchBtn?.addEventListener('click', () => { opponentFinish = myFinish = null; restart(); start(); if (rematchBtn) rematchBtn.style.display='none'; });

function ensureOverlayElements(elements) {
  let { overlay, message, startBtn, restartBtn, shareBtn, sizeSelect, enemySelect, roomInput, connectBtn, rematchBtn } = elements;
  const doc = document;
  const body = doc.body || doc.documentElement;

  function styleButton(btn) {
    if (!btn) return;
    btn.style.margin = '4px';
    btn.style.padding = '8px 12px';
    btn.style.border = '1px solid #27314b';
    btn.style.background = '#0e1422';
    btn.style.color = '#cfe6ff';
    btn.style.borderRadius = '10px';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = '700';
    btn.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  }

  function ensurePanel(parent) {
    let panel = parent.querySelector('.panel');
    if (!panel) {
      panel = doc.createElement('div');
      panel.className = 'panel';
      panel.style.background = '#111522';
      panel.style.border = '1px solid #27314b';
      panel.style.padding = '18px 22px';
      panel.style.borderRadius = '16px';
      panel.style.textAlign = 'center';
      panel.style.color = '#e6e6e6';
      panel.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
      parent.appendChild(panel);
    }
    return panel;
  }

  if (!overlay) {
    overlay = doc.createElement('div');
    overlay.id = 'overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0,0,0,0.4)';
    overlay.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    overlay.classList.add('hidden');
    body?.appendChild(overlay);
  }
  const panel = ensurePanel(overlay);

  if (!message) {
    message = doc.createElement('div');
    message.id = 'message';
    message.textContent = 'Click Start to play.';
    panel.appendChild(message);
  }

  function ensureSelect(id, labelText, options) {
    let container = panel.querySelector(`[data-for="${id}"]`);
    if (!container) {
      container = doc.createElement('div');
      container.dataset.for = id;
      container.style.marginTop = '10px';
      const label = doc.createElement('label');
      label.setAttribute('for', id);
      label.textContent = labelText;
      container.appendChild(label);
      container.appendChild(doc.createTextNode(' '));
      panel.appendChild(container);
    }
    let select = panel.querySelector(`#${id}`);
    if (!select) {
      select = doc.createElement('select');
      select.id = id;
      for (const [value, text] of options) {
        const opt = doc.createElement('option');
        opt.value = value;
        opt.textContent = text;
        select.appendChild(opt);
      }
      container.appendChild(select);
    }
    return select;
  }

  function ensureButton(id, label) {
    let btn = panel.querySelector(`#${id}`);
    if (!btn) {
      btn = doc.createElement('button');
      btn.id = id;
      btn.textContent = label;
      btn.classList.add('btn');
      styleButton(btn);
    }
    return btn;
  }

  if (!sizeSelect) {
    sizeSelect = ensureSelect('mazeSize', 'Maze Size:', [
      ['8', '8×8'],
      ['12', '12×12'],
      ['16', '16×16']
    ]);
  }

  if (!enemySelect) {
    enemySelect = ensureSelect('enemyCount', 'Enemies:', [
      ['0', '0'],
      ['1', '1'],
      ['2', '2'],
      ['3', '3']
    ]);
  }

  const needsMultiplayerFallback = !roomInput || !connectBtn || !rematchBtn;
  let multiplayerRow = panel.querySelector('#multiplayerRow');
  if (!multiplayerRow && needsMultiplayerFallback) {
    multiplayerRow = doc.createElement('div');
    multiplayerRow.id = 'multiplayerRow';
    multiplayerRow.style.marginTop = '10px';
    panel.appendChild(multiplayerRow);
  }

  if (!roomInput && multiplayerRow) {
    const label = doc.createElement('label');
    label.setAttribute('for', 'roomInput');
    label.textContent = 'Room: ';
    multiplayerRow.appendChild(label);
    roomInput = doc.createElement('input');
    roomInput.id = 'roomInput';
    roomInput.size = 6;
    multiplayerRow.appendChild(roomInput);
  }

  if (!connectBtn && multiplayerRow) {
    connectBtn = ensureButton('connectBtn', 'Connect');
    multiplayerRow.appendChild(connectBtn);
  }

  if (!rematchBtn && multiplayerRow) {
    rematchBtn = ensureButton('rematchBtn', 'Rematch');
    rematchBtn.style.display = 'none';
    multiplayerRow.appendChild(rematchBtn);
  }

  const needsControlsFallback = !startBtn || !restartBtn || !shareBtn;
  let controlsRow = panel.querySelector('#controlsRow');
  if (!controlsRow && needsControlsFallback) {
    controlsRow = doc.createElement('div');
    controlsRow.id = 'controlsRow';
    controlsRow.style.marginTop = '10px';
    panel.appendChild(controlsRow);
  }
  const buttonTarget = controlsRow || panel;

  if (!startBtn) {
    startBtn = ensureButton('startBtn', 'Start');
    buttonTarget.appendChild(startBtn);
  }

  if (!restartBtn) {
    restartBtn = ensureButton('restartBtn', 'Restart');
    restartBtn.style.display = 'none';
    buttonTarget.appendChild(restartBtn);
  }

  if (!shareBtn) {
    shareBtn = ensureButton('shareBtn', 'Share');
    shareBtn.style.display = 'none';
    buttonTarget.appendChild(shareBtn);
  }

  return { overlay, message, startBtn, restartBtn, shareBtn, sizeSelect, enemySelect, roomInput, connectBtn, rematchBtn };
}

function ensureHudElements(elements) {
  let { timeEl, oppTimeEl, bestEl } = elements;
  const doc = document;
  let hud = doc.getElementById('hud');
  if (!hud) {
    hud = doc.createElement('div');
    hud.id = 'hud';
    hud.style.position = 'fixed';
    hud.style.top = '12px';
    hud.style.left = '12px';
    hud.style.background = '#1b1e24c0';
    hud.style.border = '1px solid #27314b';
    hud.style.borderRadius = '10px';
    hud.style.padding = '8px 10px';
    hud.style.color = '#e6e6e6';
    hud.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    hud.style.fontSize = '14px';
    document.body?.appendChild(hud);
  }

  function ensureSpan(id, label, existing, fallbackText) {
    let span = existing || doc.getElementById(id);
    if (!span) {
      span = doc.createElement('span');
      span.id = id;
      span.textContent = fallbackText;
      hud.appendChild(document.createTextNode(label));
      hud.appendChild(span);
    }
    return span;
  }

  if (!timeEl) timeEl = ensureSpan('time', 'Time: ', timeEl, '0.00');
  if (!oppTimeEl) {
    if (!hud.textContent.includes('Opp:')) hud.appendChild(document.createTextNode(' • Opp: '));
    oppTimeEl = ensureSpan('oppTime', '', oppTimeEl, '--');
  }
  if (!bestEl) {
    if (!hud.textContent.includes('Best:')) hud.appendChild(document.createTextNode(' • Best: '));
    bestEl = ensureSpan('best', '', bestEl, '--');
  }

  return { timeEl, oppTimeEl, bestEl };
}

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

let wallBoxes = [];
let exitBox = null;
let floor = null;
let exitMesh = null;
const wallHeight = 4;
const BASE_CELLS = 8;
const BASE_CELL_SIZE = 4;
let MAZE_CELLS = BASE_CELLS;
let cellSize = BASE_CELL_SIZE;
let ENEMY_COUNT = 0;
let enemies = [];
let mazeGrid = [];
let mazeCols = 0;
let mazeRows = 0;
const PATH_RECALC_INTERVAL = 0.25;
let pathRecalcTimer = 0;
let lastPlayerCell = null;
let navCache = null;
const PROFILE_NAV = typeof window !== 'undefined' && typeof performance !== 'undefined' && window.location?.hash?.includes('profile-nav');
const profileStats = { navTime: 0, navCount: 0, enemyTime: 0, enemyCount: 0 };
let profileLogTimer = 0;

function cellsEqual(a, b) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

function updateMazeParams() {
  const sizeValue = sizeSelect?.value ?? String(BASE_CELLS);
  const enemyValue = enemySelect?.value ?? '0';
  MAZE_CELLS = parseInt(sizeValue, 10) || BASE_CELLS;
  ENEMY_COUNT = parseInt(enemyValue, 10) || 0;
  cellSize = (BASE_CELL_SIZE * BASE_CELLS) / MAZE_CELLS;
}

function cellToWorld(x, y, cols, rows) {
  const offsetX = cols * cellSize / 2;
  const offsetZ = rows * cellSize / 2;
  return [x * cellSize - offsetX + cellSize / 2, y * cellSize - offsetZ + cellSize / 2];
}

function worldToCell(x, z, cols, rows) {
  const offsetX = cols * cellSize / 2;
  const offsetZ = rows * cellSize / 2;
  const cx = Math.floor((x + offsetX) / cellSize);
  const cy = Math.floor((z + offsetZ) / cellSize);
  return [cx, cy];
}

function findPath(start, goal, grid, nav) {
  const rows = grid.length;
  const cols = grid[0].length;
  if (nav && nav.parents) {
    const [sx, sy] = start;
    const [gx, gy] = goal;
    if (
      sy < 0 || sy >= nav.parents.length ||
      sx < 0 || sx >= nav.parents[0].length ||
      !Number.isFinite(nav.distances?.[sy]?.[sx])
    ) {
      return null;
    }
    const path = [];
    const visited = new Set();
    let current = [sx, sy];
    while (current) {
      const key = `${current[0]},${current[1]}`;
      if (visited.has(key)) break;
      visited.add(key);
      path.push(current);
      if (current[0] === gx && current[1] === gy) {
        return path;
      }
      const next = nav.parents[current[1]]?.[current[0]];
      if (!next) break;
      current = [next[0], next[1]];
    }
    if (path[path.length - 1]?.[0] === gx && path[path.length - 1]?.[1] === gy) {
      return path;
    }
  }
  const open = [];
  const closed = new Set();
  function key(x,y){return x+','+y;}
  function heuristic(a,b){return Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]);}
  open.push({x:start[0], y:start[1], g:0, h:heuristic(start,goal), parent:null});
  while(open.length){
    open.sort((a,b)=>(a.g+a.h)-(b.g+b.h));
    const current = open.shift();
    if(current.x===goal[0] && current.y===goal[1]){
      const path=[]; let c=current; while(c){path.unshift([c.x,c.y]); c=c.parent;} return path;
    }
    closed.add(key(current.x,current.y));
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){
      const nx=current.x+dx, ny=current.y+dy;
      if(nx<0||ny<0||nx>=cols||ny>=rows) continue;
      if(grid[ny][nx]===1) continue;
      const k=key(nx,ny);
      if(closed.has(k)) continue;
      const g=current.g+1;
      let node=open.find(n=>n.x===nx && n.y===ny);
      const h=heuristic([nx,ny],goal);
      if(!node){open.push({x:nx,y:ny,g,h,parent:current});}
      else if(g<node.g){node.g=g; node.parent=current;}
    }
  }
  return null;
}

function computeNavigation(goal, grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const [gx, gy] = goal;
  if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return null;
  if (grid[gy][gx] === 1) return null;
  const parents = Array.from({ length: rows }, () => Array(cols).fill(null));
  const distances = Array.from({ length: rows }, () => Array(cols).fill(Infinity));
  const queue = [[gx, gy]];
  distances[gy][gx] = 0;
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  let head = 0;
  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (grid[ny][nx] === 1) continue;
      const nextDist = distances[cy][cx] + 1;
      if (distances[ny][nx] <= nextDist) continue;
      distances[ny][nx] = nextDist;
      parents[ny][nx] = [cx, cy];
      queue.push([nx, ny]);
    }
  }
  return { goal: [gx, gy], parents, distances };
}

function ensureNavCache(playerCell) {
  const changed = !cellsEqual(lastPlayerCell, playerCell);
  if (changed || !navCache || pathRecalcTimer <= 0) {
    navCache = computeNavigation(playerCell, mazeGrid);
    lastPlayerCell = [...playerCell];
    pathRecalcTimer = PATH_RECALC_INTERVAL;
    return true;
  }
  return false;
}

function updateEnemies(dt) {
  if (!enemies.length) return;
  const frameStart = PROFILE_NAV ? performance.now() : 0;
  pathRecalcTimer -= dt;
  const playerPos = controls.getObject().position;
  const playerCell = worldToCell(playerPos.x, playerPos.z, mazeCols, mazeRows);
  let navUpdated;
  if (PROFILE_NAV) {
    const navStart = performance.now();
    navUpdated = ensureNavCache(playerCell);
    if (navUpdated) {
      profileStats.navTime += performance.now() - navStart;
      profileStats.navCount += 1;
    }
  } else {
    navUpdated = ensureNavCache(playerCell);
  }
  for (const enemy of enemies) {
    const pos = enemy.mesh.position;
    const enemyCell = worldToCell(pos.x, pos.z, mazeCols, mazeRows);
    let needsNewPath = navUpdated || !enemy.path || !enemy.path.length;
    if (!needsNewPath && !enemy.currentTarget) {
      if (enemy.currentStepIndex >= enemy.path.length - 1) {
        needsNewPath = true;
      } else if (!cellsEqual(enemy.path[enemy.currentStepIndex], enemyCell)) {
        const idx = enemy.path.findIndex(cell => cellsEqual(cell, enemyCell));
        if (idx !== -1) enemy.currentStepIndex = idx;
        else needsNewPath = true;
      }
    }
    if (needsNewPath) {
      enemy.path = findPath(enemyCell, playerCell, mazeGrid, navCache);
      enemy.currentStepIndex = 0;
      enemy.nextStepIndex = null;
      enemy.currentTarget = null;
      if (enemy.path) {
        const idx = enemy.path.findIndex(cell => cellsEqual(cell, enemyCell));
        if (idx > 0) enemy.currentStepIndex = idx;
      }
    }
    if (enemy.path && enemy.path.length > 1) {
      if (!enemy.currentTarget) {
        const nextIndex = enemy.currentStepIndex + 1;
        if (nextIndex < enemy.path.length) {
          const [nx, ny] = enemy.path[nextIndex];
          const [wx, wz] = cellToWorld(nx, ny, mazeCols, mazeRows);
          enemy.currentTarget = {
            world: new THREE.Vector3(wx, pos.y, wz),
            cell: [nx, ny]
          };
          enemy.nextStepIndex = nextIndex;
        }
      }
      if (enemy.currentTarget) {
        const targetPos = enemy.currentTarget.world;
        const dir = new THREE.Vector3(targetPos.x - pos.x, 0, targetPos.z - pos.z);
        const dist = dir.length();
        if (dist > 0.001) {
          dir.normalize();
          const step = 3 * dt;
          if (step < dist) {
            pos.add(dir.multiplyScalar(step));
          } else {
            pos.copy(targetPos);
          }
        }
        if (pos.distanceTo(targetPos) <= 0.01) {
          pos.copy(targetPos);
          enemy.currentStepIndex = enemy.nextStepIndex ?? enemy.currentStepIndex;
          enemy.nextStepIndex = null;
          enemy.currentTarget = null;
        }
      }
    }
    if (pos.distanceTo(playerPos) < 0.6) {
      restart(currentSeed);
      message.textContent = 'Caught by enemy!';
      showOverlay();
      break;
    }
  }
  if (PROFILE_NAV) {
    profileStats.enemyTime += performance.now() - frameStart;
    profileStats.enemyCount += 1;
    profileLogTimer += dt;
    if (profileLogTimer >= 1) {
      const navAvg = profileStats.navCount ? profileStats.navTime / profileStats.navCount : 0;
      const enemyAvg = profileStats.enemyCount ? profileStats.enemyTime / profileStats.enemyCount : 0;
      console.log(`[maze3d] enemy update avg: ${enemyAvg.toFixed(3)}ms | nav recompute avg: ${navAvg.toFixed(3)}ms (${profileStats.navCount} samples)`);
      profileStats.navTime = 0;
      profileStats.enemyTime = 0;
      profileStats.navCount = 0;
      profileStats.enemyCount = 0;
      profileLogTimer = 0;
    }
  }
}

function buildMaze(seed) {
  if (floor) scene.remove(floor);
  if (exitMesh) scene.remove(exitMesh);
  for (const e of enemies) scene.remove(e.mesh);
  enemies = [];
  navCache = null;
  lastPlayerCell = null;
  pathRecalcTimer = 0;
  wallBoxes = [];
  const rand = seedRandom(seed);
  const algorithm = rand() < 0.5 ? 'prim' : 'backtracker';
  mazeGrid = generateMaze(MAZE_CELLS, MAZE_CELLS, { algorithm, seed });
  const grid = mazeGrid;
  mazeRows = grid.length;
  mazeCols = grid[0].length;
  const rows = mazeRows;
  const cols = mazeCols;
  const wallGeo = new THREE.BoxGeometry(cellSize, wallHeight, cellSize);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture });
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] === 1) {
        const mesh = new THREE.Mesh(wallGeo, wallMat);
        const [wx, wz] = cellToWorld(x, y, cols, rows);
        mesh.position.set(wx, wallHeight / 2, wz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        const box = new THREE.Box3().setFromCenterAndSize(mesh.position, new THREE.Vector3(cellSize, wallHeight, cellSize));
        wallBoxes.push(box);
      }
    }
  }
  const floorGeo = new THREE.PlaneGeometry(cols * cellSize, rows * cellSize);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a });
  floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // breadcrumb trail
  trail = [];

  const [sx, sz] = cellToWorld(1,1,cols,rows);
  controls.getObject().position.set(sx, 1.5, sz);

  const [ex, ez] = cellToWorld(cols - 2, rows - 2, cols, rows);
  exitMesh = new THREE.Mesh(new THREE.BoxGeometry(cellSize, wallHeight, cellSize), new THREE.MeshStandardMaterial({ color: 0x00ff00 }));
  exitMesh.position.set(ex, wallHeight / 2, ez);
  exitMesh.castShadow = true;
  exitMesh.receiveShadow = true;
  scene.add(exitMesh);
  exitBox = new THREE.Box3().setFromCenterAndSize(exitMesh.position, new THREE.Vector3(cellSize, wallHeight, cellSize));

  // spawn enemies
  const open = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] === 0 && !(x === 1 && y === 1) && !(x === cols - 2 && y === rows - 2)) {
        open.push([x, y]);
      }
    }
  }
  for (let i = 0; i < ENEMY_COUNT && open.length; i++) {
    const idx = Math.floor(rand() * open.length);
    const [cx, cy] = open.splice(idx, 1)[0];
    const [wx, wz] = cellToWorld(cx, cy, cols, rows);
    const geo = new THREE.SphereGeometry(0.4, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.set(wx, 1.5, wz);
    scene.add(mesh);
    enemies.push({
      mesh,
      path: null,
      currentStepIndex: 0,
      currentTarget: null,
      nextStepIndex: null
    });
  }
}

function start(syncTime) {
  if (!running) {
    running = true;
    startTime = syncTime !== undefined ? syncTime : performance.now();
    emitEvent({ type: 'play', slug: 'maze3d' });
    if (net && syncTime === undefined) {
      const startAt = Date.now();
      net.send('start', { seed: currentSeed, startAt });
    }
  }
  paused = false;
  hideOverlay();
  controls.lock();
  notifyDiagnosticsState('running', {
    reason: syncTime !== undefined ? 'sync-start' : 'local-start',
    sync: syncTime !== undefined,
  });
}

function resume(syncTime) {
  if (!running || paused) {
    start(syncTime);
  }
}

function restart(seed = Math.floor(Math.random()*1e9)) {
  running = false;
  paused = true;
  startTime = 0;
  currentSeed = seed;
  opponentFinish = null;
  myFinish = null;
  updateMazeParams();
  buildMaze(seed);
  timeEl.textContent = '0.00';
  oppTimeEl.textContent = '--';
  message.textContent = 'Click Start to play.';
  startBtn.textContent = 'Start';
  if (restartBtn) restartBtn.style.display = 'none';
  if (shareBtn) shareBtn.style.display = 'none';
  rematchBtn && (rematchBtn.style.display = 'none');
  notifyNetworkLatency(null, { source: 'restart' });
  notifyDiagnosticsState('ready', { reason: 'restart', seed });
  showOverlay();
}

function connectMatch() {
  const room = roomInput?.value?.trim();
  if (!room) return;
  net = connect(room, {
    start: ({ seed, startAt }) => {
      currentSeed = seed;
      restart(seed);
      const offset = Date.now() - startAt;
      start(performance.now() - offset);
    },
    pos: ({ id, x, z, time }) => {
      if (id === myId) return;
      oppTimeEl.textContent = time.toFixed(2);
      if (!opponent.mesh) {
        const geo = new THREE.SphereGeometry(0.4, 16, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        opponent.mesh = new THREE.Mesh(geo, mat);
        opponent.mesh.castShadow = true;
        scene.add(opponent.mesh);
      }
      opponent.mesh.position.set(x, 1.5, z);
    },
    finish: ({ id, time }) => {
      if (id === myId) return;
      opponentFinish = time;
      oppTimeEl.textContent = time.toFixed(2);
      if (myFinish != null) {
        message.textContent += myFinish < opponentFinish ? ' You win!' : ' Opponent wins!';
        rematchBtn && (rematchBtn.style.display = 'inline-block');
      } else {
        message.textContent = `Opponent finished in ${time.toFixed(2)}s`;
        rematchBtn && (rematchBtn.style.display = 'inline-block');
      }
    }
  });
  if (connectBtn) connectBtn.disabled = true;
}

function pause() {
  if (!running || paused) return;
  paused = true;
  controls.unlock();
  message.textContent = 'Paused';
  startBtn.textContent = 'Resume';
  if (restartBtn) restartBtn.style.display = 'inline-block';
  showOverlay();
  notifyDiagnosticsState('paused', { reason: 'pause' });
}

function togglePause() {
  if (!running) return;
  if (paused) resume(); else pause();
}

function toggleMap() {
  mapVisible = !mapVisible;
  mapRenderer.domElement.style.display = mapVisible ? 'block' : 'none';
}

function finish(time) {
  running = false;
  paused = true;
  controls.unlock();
  myFinish = time;
  if (net) net.send('finish', { id: myId, time });
  if (!best || time < best) {
    best = time;
    localStorage.setItem('besttime:maze3d', best.toFixed(2));
    bestEl.textContent = best.toFixed(2);
  }
  message.textContent = `Finished in ${time.toFixed(2)}s`;
  startBtn.textContent = 'Start';
  if (restartBtn) restartBtn.style.display = 'inline-block';
  if (shareBtn) {
    shareBtn.style.display = 'inline-block';
    shareBtn.onclick = () => shareScore('maze3d', time.toFixed(2));
  }
  showOverlay();
  startTime = 0;
  emitEvent({ type: 'game_over', slug: 'maze3d', value: time });
  notifyDiagnosticsState('finished', { reason: 'finish', time });
  if (opponentFinish != null) {
    message.textContent += myFinish < opponentFinish ? ' You win!' : ' Opponent wins!';
    rematchBtn && (rematchBtn.style.display = 'inline-block');
  } else if (net) {
    message.textContent += ' Waiting for opponent...';
  }
}

function update(dt) {
  const speed = 5;
  const prev = controls.getObject().position.clone();
  if (keys['KeyW']) controls.moveForward(speed * dt);
  if (keys['KeyS']) controls.moveForward(-speed * dt);
  if (keys['KeyA']) controls.moveRight(-speed * dt);
  if (keys['KeyD']) controls.moveRight(speed * dt);

  const pos = controls.getObject().position;
  pos.y = 1.5;
  // breadcrumbs
  if (!lastTrailPos || pos.distanceTo(lastTrailPos) > 1.5) {
    trail.push(pos.clone());
    lastTrailPos = pos.clone();
  }
  for (const box of wallBoxes) {
    if (box.containsPoint(pos)) {
      pos.copy(prev);
      break;
    }
  }
  if (exitBox && exitBox.containsPoint(pos)) {
    const time = (performance.now() - startTime) / 1000;
    timeEl.textContent = time.toFixed(2);
    finish(time);
  }
  updateEnemies(dt);
}

function loop() {
  if (shellRenderPaused) {
    loopRaf = 0;
    return;
  }
  const dt = 0.016; // fixed timestep
  if (running && !paused) {
    const now = performance.now();
    const t = (now - startTime) / 1000;
    timeEl.textContent = t.toFixed(2);
    update(dt);
    if (net && now - lastPosSent > 100) {
      const p = controls.getObject().position;
      const latency = lastPosSent ? now - lastPosSent : 0;
      net.send('pos', { id: myId, x: p.x, z: p.z, time: t });
      notifyNetworkLatency(latency, {
        event: 'posSync',
        intervalMs: latency,
        position: vectorToSnapshot(p),
      });
      lastPosSent = now;
    }
  }
  playerLight.position.copy(controls.getObject().position);
  playerLight.position.y += 1.5;
  renderer.render(scene, camera);
  if(!postedReady){
    notifyReadyListeners();
    postedReady=true;
    try { window.parent?.postMessage({ type:'GAME_READY', slug:'maze3d' }, '*'); } catch {}
  }
  if (mapVisible) {
    // render minimap (orthographic top-down)
    const miniCam = new THREE.OrthographicCamera(-cellSize*MAZE_CELLS*1.2, cellSize*MAZE_CELLS*1.2, cellSize*MAZE_CELLS*1.2, -cellSize*MAZE_CELLS*1.2, 0.1, 1000);
    miniCam.position.set(0, 80, 0);
    miniCam.lookAt(new THREE.Vector3(0,0,0));
    // simple overlay: draw player/trail using 2D context on top of mapRenderer after render
    const oldFog = scene.fog;
    scene.fog = null;
    mapRenderer.render(scene, miniCam);
    scene.fog = oldFog;
    const ctx2 = mapRenderer.domElement.getContext('2d');
    ctx2.save();
    ctx2.globalAlpha = 0.9;
    ctx2.fillStyle = 'rgba(255,255,255,0.15)';
    ctx2.fillRect(0,0,200,200);
    ctx2.restore();
    // trail dots
    if (trail.length) {
      ctx2.fillStyle = '#38bdf8';
      for (const p of trail) {
        const u = (p.x/(cellSize*MAZE_CELLS*1.2))*100+100;
        const v = (p.z/(cellSize*MAZE_CELLS*1.2))*100+100;
        ctx2.fillRect(u-1, v-1, 2, 2);
      }
    }
    const p = controls.getObject().position;
    const u = (p.x/(cellSize*MAZE_CELLS*1.2))*100+100;
    const v = (p.z/(cellSize*MAZE_CELLS*1.2))*100+100;
    ctx2.fillStyle = '#eab308';
    ctx2.fillRect(u-2, v-2, 4, 4);
  }
  if (!shellRenderPaused) {
    loopRaf = requestAnimationFrame(loop);
  } else {
    loopRaf = 0;
  }
}

function startRenderLoop() {
  if (!loopRaf) {
    shellRenderPaused = false;
    loopRaf = requestAnimationFrame(loop);
  }
}

function stopRenderLoop() {
  shellRenderPaused = true;
  if (loopRaf) {
    cancelAnimationFrame(loopRaf);
    loopRaf = 0;
  }
}

function pauseForShell() {
  stopRenderLoop();
  if (!running || paused) { pausedByShell = false; return; }
  pausedByShell = true;
  pause();
}

function resumeFromShell() {
  if (document.hidden) return;
  startRenderLoop();
  if (!pausedByShell) return;
  pausedByShell = false;
  if (running && paused) resume();
}

const onShellPause = () => pauseForShell();
const onShellResume = () => resumeFromShell();
const onVisibilityChange = () => { if (document.hidden) pauseForShell(); else resumeFromShell(); };
const onShellMessage = (event) => {
  const data = event && typeof event.data === 'object' ? event.data : null;
  const type = data?.type;
  if (type === 'GAME_PAUSE' || type === 'GG_PAUSE') pauseForShell();
  if (type === 'GAME_RESUME' || type === 'GG_RESUME') resumeFromShell();
};

window.addEventListener('ggshell:pause', onShellPause);
window.addEventListener('ggshell:resume', onShellResume);
document.addEventListener('visibilitychange', onVisibilityChange);
window.addEventListener('message', onShellMessage, { passive: true });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

restart(currentSeed);
startRenderLoop();
