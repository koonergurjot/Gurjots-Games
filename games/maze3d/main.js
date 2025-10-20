import { PointerLockControls } from "./PointerLockControls.js";
import '/js/three-global-shim.js';
import { injectHelpButton, recordLastPlayed, shareScore } from '../../shared/ui.js';
import { gameEvent } from '../../shared/telemetry.js';
import { connect } from './net.js';
import { generateMaze, seedRandom } from './generator.js';

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
    // ignore storage failures
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
  throw lastError || new Error('catalog unavailable');
}

let games = [];
try {
  games = await loadCatalog();
} catch (err) {
  console.warn('maze3d: catalog fetch failed, using empty list', err);
}

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toTrimmedList(value) {
  if (Array.isArray(value)) {
    return value.map(item => toTrimmedString(item)).filter(Boolean);
  }
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
  if (!help.steps.length && fallbackSteps.length) {
    help.steps = fallbackSteps;
  }
  return help;
}

const helpEntry = games.find(g => g?.id === 'maze3d' || g?.slug === 'maze3d');
const help = sanitizeHelp(helpEntry?.help || window.helpData || {});
window.helpData = help;
injectHelpButton({ gameId: 'maze3d', ...help });
recordLastPlayed('maze3d');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0f12);
scene.fog = new THREE.Fog(0x0e0f12, 10, 60);

const texLoader = new THREE.TextureLoader();

const floorTexture = texLoader.load('../../assets/sprites/maze3d/floor.png');
floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
floorTexture.center.set(0.5, 0.5);
floorTexture.rotation = Math.PI / 2;

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
const minimapOverlay = document.createElement('canvas');
minimapOverlay.width = mapRenderer.domElement.width;
minimapOverlay.height = mapRenderer.domElement.height;
minimapOverlay.style.position = 'fixed';
minimapOverlay.style.right = mapRenderer.domElement.style.right;
minimapOverlay.style.bottom = mapRenderer.domElement.style.bottom;
minimapOverlay.style.width = `${mapRenderer.domElement.width}px`;
minimapOverlay.style.height = `${mapRenderer.domElement.height}px`;
minimapOverlay.style.pointerEvents = 'auto';
minimapOverlay.style.cursor = 'crosshair';
minimapOverlay.style.borderRadius = mapRenderer.domElement.style.borderRadius;
minimapOverlay.style.zIndex = '10';
document.body.appendChild(minimapOverlay);
const minimapCtx = minimapOverlay.getContext('2d');
minimapOverlay.style.display = 'block';

const MINIMAP_SIZE = mapRenderer.domElement.width;
const MARKER_COLORS = ['#f97316', '#a855f7', '#22d3ee', '#facc15', '#34d399'];
const MAX_MARKERS = 40;
let minimapMarkers = [];
let markerSequence = 1;

function getMinimapSpan() {
  return cellSize * MAZE_CELLS * 1.2;
}

function worldToMinimap(x, z) {
  const span = getMinimapSpan();
  const u = (x / span) * (MINIMAP_SIZE / 2) + (MINIMAP_SIZE / 2);
  const v = (z / span) * (MINIMAP_SIZE / 2) + (MINIMAP_SIZE / 2);
  return { u, v };
}

function minimapToWorld(u, v) {
  const span = getMinimapSpan();
  const worldX = ((u - MINIMAP_SIZE / 2) / (MINIMAP_SIZE / 2)) * span;
  const worldZ = ((v - MINIMAP_SIZE / 2) / (MINIMAP_SIZE / 2)) * span;
  return { x: worldX, z: worldZ };
}

function addMinimapMarker(position, options = {}) {
  if (!position) return;
  const providedColor = typeof options.color === 'string' ? options.color.trim() : '';
  const color = providedColor || MARKER_COLORS[(markerSequence - 1) % MARKER_COLORS.length];
  const providedLabel = typeof options.label === 'string' ? options.label.trim() : '';
  const label = providedLabel || String(markerSequence);
  const marker = {
    position: new THREE.Vector3(position.x, 0.05, position.z),
    color,
    label,
    timestamp: performance?.now?.() ?? Date.now(),
  };
  minimapMarkers.push(marker);
  if (minimapMarkers.length > MAX_MARKERS) {
    minimapMarkers = minimapMarkers.slice(-MAX_MARKERS);
  }
  markerSequence += 1;
}

function removeNearestMarker(worldX, worldZ) {
  if (!minimapMarkers.length) return;
  let nearestIndex = -1;
  let nearestDistSq = Infinity;
  for (let i = 0; i < minimapMarkers.length; i++) {
    const marker = minimapMarkers[i];
    const dx = marker.position.x - worldX;
    const dz = marker.position.z - worldZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestIndex = i;
    }
  }
  if (nearestIndex >= 0) {
    minimapMarkers.splice(nearestIndex, 1);
  }
}

function clearMinimapMarkers() {
  minimapMarkers = [];
  markerSequence = 1;
}

function handleMinimapPointerEvent(event) {
  if (!minimapOverlay) return;
  const rect = minimapOverlay.getBoundingClientRect();
  const u = ((event.clientX - rect.left) / rect.width) * MINIMAP_SIZE;
  const v = ((event.clientY - rect.top) / rect.height) * MINIMAP_SIZE;
  return minimapToWorld(u, v);
}

function handleMinimapClick(event) {
  const coords = handleMinimapPointerEvent(event);
  if (!coords) return;
  addMinimapMarker(coords);
}

function handleMinimapContextMenu(event) {
  event.preventDefault();
  const coords = handleMinimapPointerEvent(event);
  if (event.shiftKey || !coords) {
    clearMinimapMarkers();
    return;
  }
  removeNearestMarker(coords.x, coords.z);
}

minimapOverlay.addEventListener('click', handleMinimapClick);
minimapOverlay.addEventListener('contextmenu', handleMinimapContextMenu);

function renderMinimapOverlay() {
  if (!minimapCtx) return;
  minimapCtx.clearRect(0, 0, minimapOverlay.width, minimapOverlay.height);
  minimapCtx.save();
  minimapCtx.globalAlpha = 0.9;
  minimapCtx.fillStyle = 'rgba(255,255,255,0.15)';
  minimapCtx.fillRect(0, 0, minimapOverlay.width, minimapOverlay.height);
  minimapCtx.restore();
  if (assistEnabled && assistHeatSamples.length) {
    for (const { vec, weight } of assistHeatSamples) {
      const { u, v } = worldToMinimap(vec.x, vec.z);
      const gradient = minimapCtx.createRadialGradient(u, v, 0, u, v, 12);
      const alpha = 0.08 + 0.35 * (1 - weight);
      gradient.addColorStop(0, `rgba(56,189,248,${alpha})`);
      gradient.addColorStop(1, 'rgba(14,165,233,0)');
      minimapCtx.fillStyle = gradient;
      minimapCtx.beginPath();
      minimapCtx.arc(u, v, 12, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  }
  if (trail.length) {
    minimapCtx.fillStyle = '#38bdf8';
    for (const p of trail) {
      const { u, v } = worldToMinimap(p.x, p.z);
      minimapCtx.fillRect(u - 1, v - 1, 2, 2);
    }
  }
  if (minimapMarkers.length) {
    minimapCtx.save();
    minimapCtx.font = '10px "Segoe UI", sans-serif';
    minimapCtx.textAlign = 'center';
    minimapCtx.textBaseline = 'top';
    for (const marker of minimapMarkers) {
      const { u, v } = worldToMinimap(marker.position.x, marker.position.z);
      minimapCtx.fillStyle = marker.color;
      minimapCtx.beginPath();
      minimapCtx.arc(u, v, 4, 0, Math.PI * 2);
      minimapCtx.fill();
      const label = marker.label;
      const metrics = minimapCtx.measureText(label);
      const padding = 4;
      const rectWidth = Math.ceil(metrics.width) + padding * 2;
      const rectHeight = 12;
      minimapCtx.fillStyle = 'rgba(15,23,42,0.85)';
      minimapCtx.fillRect(u - rectWidth / 2, v + 4, rectWidth, rectHeight);
      minimapCtx.fillStyle = '#f8fafc';
      minimapCtx.fillText(label, u, v + 6);
    }
    minimapCtx.restore();
  }
  const playerPos = controls.getObject().position;
  const { u, v } = worldToMinimap(playerPos.x, playerPos.z);
  minimapCtx.fillStyle = '#eab308';
  minimapCtx.fillRect(u - 2, v - 2, 4, 4);
}

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(10, 20, 10);
dir.castShadow = true;
scene.add(dir);

const playerLight = new THREE.PointLight(0xffffff, 1, 20, 2);
playerLight.castShadow = true;
scene.add(playerLight);

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

const fogPulseColor = new THREE.Color(0x172033);
const lightingState = {
  baseHemiIntensity: hemi.intensity,
  baseDirIntensity: dir.intensity,
  basePlayerIntensity: playerLight.intensity,
  baseFogNear: scene.fog?.near ?? 10,
  baseFogFar: scene.fog?.far ?? 60,
  baseFogColor: scene.fog?.color.clone() ?? new THREE.Color(0x0e0f12),
  nextFlicker: (performance?.now?.() ?? Date.now()) + randomRange(4500, 9000),
  nextFogPulse: (performance?.now?.() ?? Date.now()) + randomRange(7000, 14000),
  flicker: null,
  fogPulse: null,
};
const fogTargetColor = lightingState.baseFogColor.clone();

const controls = new PointerLockControls(camera, renderer.domElement);
const player = controls.getObject();
let opponent = { mesh: null };

function dropMarkerAtPlayerPosition() {
  const pos = controls.getObject().position;
  addMinimapMarker({ x: pos.x, z: pos.z });
}

const isTouchDevice = typeof window !== 'undefined' && (
  window.matchMedia?.('(pointer:coarse)')?.matches ||
  'ontouchstart' in window ||
  (navigator?.maxTouchPoints ?? 0) > 0
);

const playerVelocity = new THREE.Vector2();
const desiredInput = new THREE.Vector2();
const targetVelocity = new THREE.Vector2();
const mobileInput = new THREE.Vector2();
let mobileInputActive = false;
const DEFAULT_DEAD_ZONE = 0.07;
const DEFAULT_SENSITIVITY = 1;
const MIN_DEAD_ZONE = 0;
const MAX_DEAD_ZONE = 0.45;
const MIN_SENSITIVITY = 0.5;
const MAX_SENSITIVITY = 1.6;
function clampNumber(value, min, max, fallback) {
  const numeric = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(numeric)) return fallback;
  return THREE.MathUtils.clamp(numeric, min, max);
}
let mobileDeadZone = clampNumber(loadPreference('maze3d:mobileDeadZone', DEFAULT_DEAD_ZONE), MIN_DEAD_ZONE, MAX_DEAD_ZONE, DEFAULT_DEAD_ZONE);
let mobileSensitivity = clampNumber(loadPreference('maze3d:mobileSensitivity', DEFAULT_SENSITIVITY), MIN_SENSITIVITY, MAX_SENSITIVITY, DEFAULT_SENSITIVITY);
const MOVE_SETTINGS = {
  maxSpeed: 5.5,
  accel: 9,
  decel: 12,
  snapSpeed: 6,
  snapThreshold: 0.45
};

const assistGroup = new THREE.Group();
assistGroup.visible = false;
scene.add(assistGroup);
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
    getSolutionCells: () => mazeSolutionCells.map(([x, y]) => [x, y]),
    getSolutionWorld: () => mazeSolutionWorld.map((vec) => vec.clone()),
    getMazeMetadata: () => ({
      ...(currentMazeMeta || {}),
      rows: mazeRows,
      cols: mazeCols,
    }),
    setAssistMode,
    setInputProfile,
    dropMarker: dropMarkerAtPlayerPosition,
    addMarker: ({ x, z, label, color }) => {
      if (Number.isFinite(x) && Number.isFinite(z)) {
        addMinimapMarker({ x, z }, { label: typeof label === 'string' ? label : undefined, color: typeof color === 'string' ? color : undefined });
      }
    },
    clearMarkers: clearMinimapMarkers,
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
let algorithmSelect = document.getElementById('mazeAlgorithm');
let assistSelect = document.getElementById('assistMode');
let controlSelect = document.getElementById('controlProfile');
let deadZoneSlider = document.getElementById('mobileDeadZone');
let deadZoneValueLabel = document.querySelector('[data-slider-value="mobileDeadZone"]');
let deadZoneContainer = deadZoneSlider?.parentElement || null;
let sensitivitySlider = document.getElementById('mobileSensitivity');
let sensitivityValueLabel = document.querySelector('[data-slider-value="mobileSensitivity"]');
let sensitivityContainer = sensitivitySlider?.parentElement || null;

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
  rematchBtn,
  algorithmSelect,
  assistSelect,
  controlSelect,
  deadZoneSlider,
  deadZoneValueLabel,
  deadZoneContainer,
  sensitivitySlider,
  sensitivityValueLabel,
  sensitivityContainer
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
  rematchBtn,
  algorithmSelect,
  assistSelect,
  controlSelect,
  deadZoneSlider,
  deadZoneValueLabel,
  deadZoneContainer,
  sensitivitySlider,
  sensitivityValueLabel,
  sensitivityContainer
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
let mazeSolutionCells = [];
let mazeSolutionWorld = [];
let assistHeatSamples = [];
let wallMesh = null;
const stickState = { active: false, pointerId: null, radius: 60, centerX: 0, centerY: 0 };

const ASSIST_MODES = new Set(['off', 'heatmap']);
let assistMode = ASSIST_MODES.has(loadPreference('maze3d:assistMode', 'off'))
  ? loadPreference('maze3d:assistMode', 'off')
  : 'off';
let assistEnabled = assistMode !== 'off';
assistGroup.visible = assistEnabled;

const ALGORITHM_OPTIONS = new Set(['auto', 'prim', 'backtracker']);
let algorithmPreference = loadPreference('maze3d:algorithm', 'auto');
if (!ALGORITHM_OPTIONS.has(algorithmPreference)) {
  algorithmPreference = 'auto';
}

const SUPPORTED_PROFILES = new Set(['keyboard', 'stick', 'tilt']);
let inputProfile = loadPreference('maze3d:inputProfile', isTouchDevice ? 'stick' : 'keyboard');
if (!SUPPORTED_PROFILES.has(inputProfile)) {
  inputProfile = isTouchDevice ? 'stick' : 'keyboard';
}
if (!isTouchDevice) {
  inputProfile = 'keyboard';
}

let tiltBaseline = null;
let tiltActive = false;
let virtualStickPad = null;
let virtualStickThumb = null;

const keys = {};
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  const activeElement = document.activeElement;
  const tagName = activeElement?.tagName;
  const typing = activeElement?.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA';
  if (!typing) {
    if (e.code === 'KeyP') togglePause();
    if (e.code === 'KeyR') restart();
    if (e.code === 'KeyM' && !e.repeat) toggleMap();
    if (e.code === 'KeyB' && !e.repeat) dropMarkerAtPlayerPosition();
    if (e.code === 'KeyC' && !e.repeat) clearMinimapMarkers();
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

startBtn?.addEventListener('click', () => start());
restartBtn?.addEventListener('click', () => restart());
sizeSelect?.addEventListener('change', () => restart());
enemySelect?.addEventListener('change', () => restart());
algorithmSelect?.addEventListener('change', () => {
  const value = algorithmSelect.value;
  algorithmPreference = ALGORITHM_OPTIONS.has(value) ? value : 'auto';
  savePreference('maze3d:algorithm', algorithmPreference);
  restart(currentSeed);
});
assistSelect?.addEventListener('change', () => {
  setAssistMode(assistSelect.value);
});
controlSelect?.addEventListener('change', () => {
  setInputProfile(controlSelect.value);
});
deadZoneSlider?.addEventListener('input', (event) => {
  mobileDeadZone = clampNumber(event.target?.value, MIN_DEAD_ZONE, MAX_DEAD_ZONE, mobileDeadZone);
  savePreference('maze3d:mobileDeadZone', mobileDeadZone);
  updateMobileCalibrationUi();
  resetMobileInput();
});
sensitivitySlider?.addEventListener('input', (event) => {
  mobileSensitivity = clampNumber(event.target?.value, MIN_SENSITIVITY, MAX_SENSITIVITY, mobileSensitivity);
  savePreference('maze3d:mobileSensitivity', mobileSensitivity);
  updateMobileCalibrationUi();
});
connectBtn?.addEventListener('click', connectMatch);
rematchBtn?.addEventListener('click', () => { opponentFinish = myFinish = null; restart(); start(); if (rematchBtn) rematchBtn.style.display='none'; });

applyInputProfile();
setAssistMode(assistMode);
updateMobileCalibrationUi();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    resetMobileInput();
    tiltBaseline = null;
  }
});

function ensureOverlayElements(elements) {
  let { overlay, message, startBtn, restartBtn, shareBtn, sizeSelect, enemySelect, roomInput, connectBtn, rematchBtn, algorithmSelect, assistSelect, controlSelect, deadZoneSlider, deadZoneValueLabel, deadZoneContainer, sensitivitySlider, sensitivityValueLabel, sensitivityContainer } = elements;
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

  function ensureSlider(id, labelText, { min, max, step, format }) {
    let container = panel.querySelector(`[data-slider-for="${id}"]`);
    if (!container) {
      container = doc.createElement('div');
      container.dataset.sliderFor = id;
      container.style.marginTop = '10px';
      container.style.textAlign = 'left';
      const labelRow = doc.createElement('div');
      labelRow.style.display = 'flex';
      labelRow.style.alignItems = 'center';
      labelRow.style.justifyContent = 'space-between';
      const label = doc.createElement('label');
      label.setAttribute('for', id);
      label.textContent = labelText;
      const value = doc.createElement('span');
      value.dataset.sliderValue = id;
      value.style.fontVariantNumeric = 'tabular-nums';
      value.style.marginLeft = '12px';
      labelRow.appendChild(label);
      labelRow.appendChild(value);
      const slider = doc.createElement('input');
      slider.type = 'range';
      slider.id = id;
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(step);
      slider.style.width = '100%';
      slider.style.marginTop = '6px';
      container.appendChild(labelRow);
      container.appendChild(slider);
      panel.appendChild(container);
    }
    const slider = container.querySelector(`#${id}`);
    const valueEl = container.querySelector(`[data-slider-value="${id}"]`);
    return { container, slider, valueEl, format };
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

  if (!algorithmSelect) {
    algorithmSelect = ensureSelect('mazeAlgorithm', 'Algorithm:', [
      ['auto', 'Auto (Mixed)'],
      ['prim', "Prim's"],
      ['backtracker', 'Recursive Backtracker']
    ]);
  }
  algorithmSelect.value = algorithmSelect.value || algorithmPreference;
  if (ALGORITHM_OPTIONS.has(algorithmSelect.value)) {
    algorithmPreference = algorithmSelect.value;
  }

  if (!assistSelect) {
    assistSelect = ensureSelect('assistMode', 'Assist Mode:', [
      ['off', 'Off'],
      ['heatmap', 'Breadcrumb Heatmap']
    ]);
  }
  assistSelect.value = assistMode;

  if (!controlSelect) {
    controlSelect = ensureSelect('controlProfile', 'Controls:', [
      ['keyboard', 'Keyboard/Mouse'],
      ['stick', 'Virtual Stick'],
      ['tilt', 'Tilt']
    ]);
  }
  if (!isTouchDevice) {
    controlSelect.value = 'keyboard';
    controlSelect.disabled = true;
  } else {
    controlSelect.disabled = false;
    controlSelect.value = inputProfile;
  }

  const deadZoneParts = ensureSlider('mobileDeadZone', 'Virtual Dead Zone', {
    min: MIN_DEAD_ZONE,
    max: MAX_DEAD_ZONE,
    step: 0.01,
    format: (value) => `${Math.round(value * 100)}%`,
  });
  deadZoneContainer = deadZoneParts.container;
  deadZoneSlider = deadZoneParts.slider;
  deadZoneValueLabel = deadZoneParts.valueEl;

  const sensitivityParts = ensureSlider('mobileSensitivity', 'Virtual Sensitivity', {
    min: MIN_SENSITIVITY,
    max: MAX_SENSITIVITY,
    step: 0.05,
    format: (value) => `${value.toFixed(2)}×`,
  });
  sensitivityContainer = sensitivityParts.container;
  sensitivitySlider = sensitivityParts.slider;
  sensitivityValueLabel = sensitivityParts.valueEl;

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

  return { overlay, message, startBtn, restartBtn, shareBtn, sizeSelect, enemySelect, roomInput, connectBtn, rematchBtn, algorithmSelect, assistSelect, controlSelect, deadZoneSlider, deadZoneValueLabel, deadZoneContainer, sensitivitySlider, sensitivityValueLabel, sensitivityContainer };
}

function applyMobileCalibration(target) {
  const mag = target.length();
  if (mag <= mobileDeadZone || mag === 0) {
    target.set(0, 0);
    return 0;
  }
  const adjusted = (mag - mobileDeadZone) / (1 - mobileDeadZone);
  const scaled = THREE.MathUtils.clamp(adjusted * mobileSensitivity, 0, 1);
  target.multiplyScalar(scaled / mag);
  return scaled;
}

function updateMobileCalibrationUi() {
  if (deadZoneSlider && deadZoneSlider.value !== mobileDeadZone.toFixed(2)) {
    deadZoneSlider.value = mobileDeadZone.toFixed(2);
  }
  if (deadZoneValueLabel) {
    deadZoneValueLabel.textContent = `${Math.round(mobileDeadZone * 100)}%`;
  }
  if (sensitivitySlider && sensitivitySlider.value !== mobileSensitivity.toFixed(2)) {
    sensitivitySlider.value = mobileSensitivity.toFixed(2);
  }
  if (sensitivityValueLabel) {
    sensitivityValueLabel.textContent = `${mobileSensitivity.toFixed(2)}×`;
  }
  const showMobileOptions = isTouchDevice && inputProfile !== 'keyboard';
  if (deadZoneContainer) {
    deadZoneContainer.style.display = showMobileOptions ? 'block' : 'none';
  }
  if (sensitivityContainer) {
    sensitivityContainer.style.display = showMobileOptions ? 'block' : 'none';
  }
}

function resetMobileInput() {
  mobileInput.set(0, 0);
  mobileInputActive = false;
  if (virtualStickThumb) {
    virtualStickThumb.style.transform = 'translate(0px, 0px)';
  }
}

function updateStickGeometryFromDom() {
  if (!virtualStickPad || virtualStickPad.style.display === 'none') return;
  const rect = virtualStickPad.getBoundingClientRect();
  stickState.radius = rect.width / 2;
  stickState.centerX = rect.left + stickState.radius;
  stickState.centerY = rect.top + stickState.radius;
}

function ensureVirtualStickElements() {
  if (virtualStickPad) return;
  const pad = document.createElement('div');
  pad.id = 'virtualStick';
  pad.style.position = 'fixed';
  pad.style.bottom = '24px';
  pad.style.left = '24px';
  pad.style.width = '120px';
  pad.style.height = '120px';
  pad.style.borderRadius = '50%';
  pad.style.background = 'rgba(15,23,42,0.35)';
  pad.style.border = '1px solid rgba(56,189,248,0.6)';
  pad.style.backdropFilter = 'blur(6px)';
  pad.style.touchAction = 'none';
  pad.style.zIndex = '20';
  pad.style.display = 'none';
  const thumb = document.createElement('div');
  thumb.style.position = 'absolute';
  thumb.style.left = '50%';
  thumb.style.top = '50%';
  thumb.style.width = '56px';
  thumb.style.height = '56px';
  thumb.style.marginLeft = '-28px';
  thumb.style.marginTop = '-28px';
  thumb.style.borderRadius = '50%';
  thumb.style.background = 'rgba(56,189,248,0.7)';
  thumb.style.boxShadow = '0 0 12px rgba(56,189,248,0.6)';
  thumb.style.pointerEvents = 'none';
  thumb.style.transform = 'translate(0px, 0px)';
  pad.appendChild(thumb);
  document.body?.appendChild(pad);
  virtualStickPad = pad;
  virtualStickThumb = thumb;
  pad.addEventListener('pointerdown', handleVirtualStickPointerDown, { passive: false });
  window.addEventListener('pointermove', handleVirtualStickPointerMove, { passive: false });
  window.addEventListener('pointerup', handleVirtualStickPointerUp, { passive: false });
  window.addEventListener('pointercancel', handleVirtualStickPointerUp, { passive: false });
  window.addEventListener('resize', updateStickGeometryFromDom);
}

function setVirtualStickVisible(visible) {
  ensureVirtualStickElements();
  if (!virtualStickPad) return;
  virtualStickPad.style.display = visible ? 'block' : 'none';
  if (visible) {
    updateStickGeometryFromDom();
  } else {
    stickState.active = false;
    stickState.pointerId = null;
    resetMobileInput();
  }
}

function updateVirtualStickFromEvent(event) {
  if (!virtualStickPad) return;
  updateStickGeometryFromDom();
  const dx = event.clientX - stickState.centerX;
  const dy = event.clientY - stickState.centerY;
  const radius = stickState.radius || 1;
  let strafe = THREE.MathUtils.clamp(dx / radius, -1, 1);
  let forward = THREE.MathUtils.clamp(-dy / radius, -1, 1);
  const mag = Math.hypot(strafe, forward);
  if (mag > 1) {
    strafe /= mag;
    forward /= mag;
  }
  mobileInput.set(strafe, forward);
  const applied = applyMobileCalibration(mobileInput);
  mobileInputActive = applied > 0;
  if (virtualStickThumb) {
    const offsetX = mobileInput.x * radius * 0.4;
    const offsetY = -mobileInput.y * radius * 0.4;
    virtualStickThumb.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  }
}

function handleVirtualStickPointerDown(event) {
  if (!virtualStickPad) return;
  stickState.active = true;
  stickState.pointerId = event.pointerId;
  virtualStickPad.setPointerCapture?.(event.pointerId);
  updateVirtualStickFromEvent(event);
  event.preventDefault();
}

function handleVirtualStickPointerMove(event) {
  if (!stickState.active || stickState.pointerId !== event.pointerId) return;
  updateVirtualStickFromEvent(event);
  event.preventDefault();
}

function handleVirtualStickPointerUp(event) {
  if (stickState.pointerId !== event.pointerId) return;
  stickState.active = false;
  stickState.pointerId = null;
  virtualStickPad?.releasePointerCapture?.(event.pointerId);
  resetMobileInput();
  event.preventDefault();
}

function handleDeviceOrientation(event) {
  if (!tiltActive) return;
  const { beta, gamma } = event;
  if (beta == null || gamma == null) return;
  if (!tiltBaseline) {
    tiltBaseline = { beta, gamma };
    return;
  }
  const baselineBeta = tiltBaseline.beta;
  const baselineGamma = tiltBaseline.gamma;
  let strafe = THREE.MathUtils.clamp((gamma - baselineGamma) / 22, -1, 1);
  let forward = THREE.MathUtils.clamp((baselineBeta - beta) / 28, -1, 1);
  tiltBaseline.beta = THREE.MathUtils.lerp(baselineBeta, beta, 0.05);
  tiltBaseline.gamma = THREE.MathUtils.lerp(baselineGamma, gamma, 0.05);
  mobileInput.set(strafe, forward);
  const mag = mobileInput.length();
  if (mag > 1) mobileInput.divideScalar(mag);
  const applied = applyMobileCalibration(mobileInput);
  mobileInputActive = applied > 0;
}

function handleTiltPermissionDenied() {
  disableTiltControls();
  if (inputProfile === 'tilt') {
    inputProfile = 'stick';
    savePreference('maze3d:inputProfile', inputProfile);
    if (controlSelect) controlSelect.value = inputProfile;
    applyInputProfile();
  }
}

function enableTiltControls() {
  if (tiltActive) return;
  if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
    handleTiltPermissionDenied();
    return;
  }
  const attach = () => {
    tiltBaseline = null;
    window.addEventListener('deviceorientation', handleDeviceOrientation, true);
    tiltActive = true;
  };
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then((result) => {
      if (result === 'granted') {
        attach();
      } else {
        handleTiltPermissionDenied();
      }
    }).catch(() => {
      handleTiltPermissionDenied();
    });
  } else {
    attach();
  }
}

function disableTiltControls() {
  if (tiltActive) {
    window.removeEventListener('deviceorientation', handleDeviceOrientation, true);
    tiltActive = false;
  }
  tiltBaseline = null;
  if (inputProfile !== 'stick') {
    resetMobileInput();
  }
}

function applyInputProfile() {
  if (inputProfile === 'stick') {
    disableTiltControls();
    setVirtualStickVisible(true);
    resetMobileInput();
  } else if (inputProfile === 'tilt') {
    setVirtualStickVisible(false);
    enableTiltControls();
  } else {
    disableTiltControls();
    setVirtualStickVisible(false);
    resetMobileInput();
  }
  updatePointerLockPreference();
  updateMobileCalibrationUi();
}

function setInputProfile(profile) {
  let normalized = SUPPORTED_PROFILES.has(profile) ? profile : 'keyboard';
  if (!isTouchDevice) normalized = 'keyboard';
  if (normalized === inputProfile) {
    if (controlSelect && controlSelect.value !== normalized) {
      controlSelect.value = normalized;
    }
    return;
  }
  inputProfile = normalized;
  savePreference('maze3d:inputProfile', inputProfile);
  if (controlSelect && controlSelect.value !== inputProfile) {
    controlSelect.value = inputProfile;
  }
  applyInputProfile();
}

function setAssistMode(mode) {
  const normalized = ASSIST_MODES.has(mode) ? mode : 'off';
  assistMode = normalized;
  assistEnabled = normalized !== 'off';
  assistGroup.visible = assistEnabled;
  savePreference('maze3d:assistMode', normalized);
  if (assistSelect && assistSelect.value !== normalized) {
    assistSelect.value = normalized;
  }
}

function shouldUsePointerLock() {
  return !isTouchDevice || inputProfile === 'keyboard';
}

function updatePointerLockPreference() {
  if (!shouldUsePointerLock() && controls.isLocked) {
    controls.unlock();
  }
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

function disposeMesh(mesh) {
  if (!mesh) return;
  if (mesh.geometry?.dispose) mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) {
    for (const mat of mesh.material) {
      mat?.dispose?.();
    }
  } else {
    mesh.material?.dispose?.();
  }
}

function disposeAssistChildren() {
  for (const child of [...assistGroup.children]) {
    assistGroup.remove(child);
    disposeMesh(child);
  }
}

function rebuildAssistVisuals() {
  disposeAssistChildren();
  assistHeatSamples = [];
  if (!mazeSolutionWorld.length) return;
  const crumbSpacing = Math.max(1, Math.floor(mazeSolutionWorld.length / 40));
  const crumbCount = Math.max(1, Math.ceil(mazeSolutionWorld.length / crumbSpacing));
  const crumbGeo = new THREE.SphereGeometry(0.18, 12, 12);
  const crumbMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.55,
    color: 0xffffff,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const crumbs = new THREE.InstancedMesh(crumbGeo, crumbMat, crumbCount);
  crumbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (!crumbs.instanceColor) {
    crumbs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(crumbCount * 3), 3);
  }
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let i = 0; i < crumbCount; i++) {
    const sampleIndex = Math.min(mazeSolutionWorld.length - 1, i * crumbSpacing);
    const pos = mazeSolutionWorld[sampleIndex];
    matrix.makeTranslation(pos.x, 0.2, pos.z);
    crumbs.setMatrixAt(i, matrix);
    const t = mazeSolutionWorld.length <= 1 ? 0 : sampleIndex / (mazeSolutionWorld.length - 1);
    color.setHSL(0.55 - 0.35 * t, 0.8, 0.55);
    crumbs.setColorAt(i, color);
  }
  crumbs.instanceMatrix.needsUpdate = true;
  if (crumbs.instanceColor) crumbs.instanceColor.needsUpdate = true;
  crumbs.renderOrder = 1;
  assistGroup.add(crumbs);
  assistHeatSamples = mazeSolutionWorld.map((vec, index) => ({
    vec,
    weight: mazeSolutionWorld.length <= 1 ? 0 : index / (mazeSolutionWorld.length - 1)
  }));
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
const wallNoiseAmplitude = 0.08;
const BASE_CELLS = 8;
const BASE_CELL_SIZE = 4;
let MAZE_CELLS = BASE_CELLS;
let cellSize = BASE_CELL_SIZE;
let ENEMY_COUNT = 0;
let enemies = [];
let mazeGrid = [];
let mazeCols = 0;
let mazeRows = 0;
let currentMazeMeta = null;
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

function shouldKeepWall(x, y, grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  let openSides = 0;
  if (x > 0 && grid[y][x - 1] === 0) openSides++;
  if (x < cols - 1 && grid[y][x + 1] === 0) openSides++;
  if (y > 0 && grid[y - 1][x] === 0) openSides++;
  if (y < rows - 1 && grid[y + 1][x] === 0) openSides++;
  return openSides > 0;
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

function computeMovementInput() {
  const forward = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
  const strafe = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
  desiredInput.set(strafe, forward);
  if (mobileInputActive) {
    desiredInput.x += mobileInput.x;
    desiredInput.y += mobileInput.y;
  }
  const lenSq = desiredInput.lengthSq();
  if (lenSq > 1) desiredInput.normalize();
  return desiredInput;
}

function applyGridSnap(position, dt) {
  if (!mazeGrid.length || !mazeCols || !mazeRows) return;
  if (desiredInput.lengthSq() > 0.01) return;
  if (playerVelocity.length() > MOVE_SETTINGS.snapThreshold) return;
  const [cx, cy] = worldToCell(position.x, position.z, mazeCols, mazeRows);
  if (cy < 0 || cy >= mazeGrid.length || cx < 0 || cx >= mazeGrid[0].length) return;
  if (mazeGrid[cy][cx] !== 0) return;
  const [wx, wz] = cellToWorld(cx, cy, mazeCols, mazeRows);
  const dx = wx - position.x;
  const dz = wz - position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.001) return;
  const maxStep = MOVE_SETTINGS.snapSpeed * dt;
  const ratio = Math.min(1, maxStep / dist);
  position.x += dx * ratio;
  position.z += dz * ratio;
}

function buildMaze(seed) {
  if (floor) {
    scene.remove(floor);
    disposeMesh(floor);
    floor = null;
  }
  if (exitMesh) {
    scene.remove(exitMesh);
    disposeMesh(exitMesh);
    exitMesh = null;
  }
  if (wallMesh) {
    scene.remove(wallMesh);
    disposeMesh(wallMesh);
    wallMesh = null;
  }
  for (const enemy of enemies) {
    if (enemy.mesh) {
      scene.remove(enemy.mesh);
      disposeMesh(enemy.mesh);
    }
  }
  enemies = [];
  navCache = null;
  lastPlayerCell = null;
  pathRecalcTimer = 0;
  wallBoxes = [];
  trail = [];
  lastTrailPos = null;
  clearMinimapMarkers();
  playerVelocity.set(0, 0);
  mazeSolutionCells = [];
  mazeSolutionWorld = [];
  assistHeatSamples = [];
  currentMazeMeta = null;

  const rand = seedRandom(seed);
  const algorithm = algorithmPreference === 'auto'
    ? (rand() < 0.5 ? 'prim' : 'backtracker')
    : algorithmPreference;
  const { grid, solution, metadata } = generateMaze(MAZE_CELLS, MAZE_CELLS, { algorithm, seed });
  currentMazeMeta = metadata;
  mazeGrid = grid;
  mazeRows = grid.length;
  mazeCols = grid[0].length;
  const rows = mazeRows;
  const cols = mazeCols;
  mazeSolutionCells = solution.map(([cx, cy]) => [cx, cy]);
  mazeSolutionWorld = mazeSolutionCells.map(([cx, cy]) => {
    const [wx, wz] = cellToWorld(cx, cy, cols, rows);
    return new THREE.Vector3(wx, 0.05, wz);
  });
  rebuildAssistVisuals();

  const wallGeo = new THREE.BoxGeometry(cellSize, wallHeight, cellSize);
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x7e8894,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.FrontSide
  });
  wallMat.onBeforeCompile = (shader) => {
    shader.uniforms.wallNoiseAmplitude = { value: wallNoiseAmplitude };
    shader.uniforms.wallHeight = { value: wallHeight };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWallWorldPosition;'
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvWallWorldPosition = worldPosition.xyz;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWallWorldPosition;\nuniform float wallNoiseAmplitude;\nuniform float wallHeight;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      `vec4 diffuseColor = vec4( diffuse, opacity );\n` +
      `float noise = fract(sin(dot(vWallWorldPosition.xz, vec2(12.9898, 78.233))) * 43758.5453);\n` +
      `float grain = (noise - 0.5) * 2.0 * wallNoiseAmplitude;\n` +
      `diffuseColor.rgb = clamp(diffuseColor.rgb * (1.0 + grain), 0.0, 1.0);\n` +
      `float heightNorm = clamp(vWallWorldPosition.y / wallHeight, 0.0, 1.0);\n` +
      `float darken = mix(0.65, 1.0, pow(heightNorm, 0.75));\n` +
      `diffuseColor.rgb *= darken;\n`
    );
  };
  const wallMatrix = new THREE.Matrix4();
  const wallSize = new THREE.Vector3(cellSize, wallHeight, cellSize);
  const wallCenters = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] !== 1) continue;
      if (!shouldKeepWall(x, y, grid)) continue;
      const [wx, wz] = cellToWorld(x, y, cols, rows);
      wallCenters.push([wx, wz]);
      const center = new THREE.Vector3(wx, wallHeight / 2, wz);
      const box = new THREE.Box3().setFromCenterAndSize(center, wallSize);
      wallBoxes.push(box);
    }
  }
  if (wallCenters.length) {
    wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCenters.length);
    wallMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const center = new THREE.Vector3();
    for (let i = 0; i < wallCenters.length; i++) {
      const [wx, wz] = wallCenters[i];
      center.set(wx, wallHeight / 2, wz);
      wallMatrix.makeTranslation(center.x, center.y, center.z);
      wallMesh.setMatrixAt(i, wallMatrix);
    }
    wallMesh.instanceMatrix.needsUpdate = true;
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    scene.add(wallMesh);
  }

  floorTexture.repeat.set(cols, rows);
  floorTexture.needsUpdate = true;
  const floorGeo = new THREE.PlaneGeometry(cols * cellSize, rows * cellSize);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTexture,
    side: THREE.FrontSide
  });
  floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const [sx, sz] = cellToWorld(1, 1, cols, rows);
  controls.getObject().position.set(sx, 1.5, sz);

  const [ex, ez] = cellToWorld(cols - 2, rows - 2, cols, rows);
  exitMesh = new THREE.Mesh(
    new THREE.BoxGeometry(cellSize, wallHeight, cellSize),
    new THREE.MeshStandardMaterial({ color: 0x00ff00, side: THREE.FrontSide })
  );
  exitMesh.position.set(ex, wallHeight / 2, ez);
  exitMesh.castShadow = true;
  exitMesh.receiveShadow = true;
  scene.add(exitMesh);
  exitBox = new THREE.Box3().setFromCenterAndSize(exitMesh.position.clone(), new THREE.Vector3(cellSize, wallHeight, cellSize));

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
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, side: THREE.FrontSide });
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
    gameEvent('play', { slug: 'maze3d' });
    if (net && syncTime === undefined) {
      const startAt = Date.now();
      net.send('start', { seed: currentSeed, startAt });
    }
  }
  paused = false;
  hideOverlay();
  if (shouldUsePointerLock()) {
    controls.lock();
  } else {
    controls.unlock();
  }
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
  minimapOverlay.style.display = mapVisible ? 'block' : 'none';
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
  const durationMs = Math.max(0, Math.round(Number(time) * 1000));
  gameEvent('game_over', {
    slug: 'maze3d',
    value: time,
    durationMs,
  });
  const outcome = opponentFinish != null
    ? (myFinish < opponentFinish ? 'win' : (myFinish > opponentFinish ? 'lose' : null))
    : 'win';
  if (outcome) {
    gameEvent(outcome, {
      slug: 'maze3d',
      meta: {
        myTime: time,
        opponentTime: opponentFinish,
      },
    });
  }
  notifyDiagnosticsState('finished', { reason: 'finish', time });
  if (opponentFinish != null) {
    message.textContent += myFinish < opponentFinish ? ' You win!' : ' Opponent wins!';
    rematchBtn && (rematchBtn.style.display = 'inline-block');
  } else if (net) {
    message.textContent += ' Waiting for opponent...';
  }
}

function updateLighting(now) {
  if (!Number.isFinite(now) || !lightingState) return;
  if (!lightingState.flicker && now >= lightingState.nextFlicker) {
    const duration = randomRange(380, 760);
    lightingState.flicker = {
      start: now,
      end: now + duration,
      seed: Math.random() * Math.PI * 2,
    };
    lightingState.nextFlicker = now + randomRange(5200, 11500);
  }
  if (lightingState.flicker) {
    const { start, end, seed } = lightingState.flicker;
    const span = Math.max(1, end - start);
    const t = THREE.MathUtils.clamp((now - start) / span, 0, 1);
    if (t >= 1) {
      lightingState.flicker = null;
    } else {
      const envelope = 1 - Math.pow(t, 0.45);
      const waveA = Math.sin((now - start) * 0.045 + seed) * 0.35;
      const waveB = Math.sin((now - start) * 0.12 + seed * 2.2) * 0.2;
      const flickerFactor = THREE.MathUtils.clamp(0.7 + envelope * 0.4 + (waveA + waveB) * 0.2, 0.4, 1.6);
      playerLight.intensity = THREE.MathUtils.lerp(playerLight.intensity, lightingState.basePlayerIntensity * flickerFactor, 0.45);
      dir.intensity = THREE.MathUtils.lerp(dir.intensity, lightingState.baseDirIntensity * (0.9 + envelope * 0.2), 0.3);
    }
  } else {
    playerLight.intensity = THREE.MathUtils.lerp(playerLight.intensity, lightingState.basePlayerIntensity, 0.08);
    dir.intensity = THREE.MathUtils.lerp(dir.intensity, lightingState.baseDirIntensity, 0.08);
  }

  if (!lightingState.fogPulse && now >= lightingState.nextFogPulse) {
    const duration = randomRange(2400, 4200);
    lightingState.fogPulse = {
      start: now,
      end: now + duration,
      strength: randomRange(0.15, 0.35),
    };
    lightingState.nextFogPulse = now + randomRange(10000, 18000);
  }

  if (lightingState.fogPulse) {
    const { start, end, strength } = lightingState.fogPulse;
    const span = Math.max(1, end - start);
    const t = THREE.MathUtils.clamp((now - start) / span, 0, 1);
    if (t >= 1) {
      lightingState.fogPulse = null;
    } else {
      const pulse = Math.sin(Math.PI * t);
      if (scene.fog) {
        const nearTarget = lightingState.baseFogNear * (1 - strength * 0.4 * pulse);
        const farTarget = lightingState.baseFogFar * (1 - strength * 0.55 * pulse);
        scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, nearTarget, 0.15);
        scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, farTarget, 0.12);
        fogTargetColor.copy(lightingState.baseFogColor).lerp(fogPulseColor, strength * pulse);
        scene.fog.color.lerp(fogTargetColor, 0.2);
      }
      hemi.intensity = THREE.MathUtils.lerp(hemi.intensity, lightingState.baseHemiIntensity * (1 - strength * 0.25 * pulse), 0.2);
    }
  } else {
    if (scene.fog) {
      scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, lightingState.baseFogNear, 0.05);
      scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, lightingState.baseFogFar, 0.05);
      scene.fog.color.lerp(lightingState.baseFogColor, 0.08);
    }
    hemi.intensity = THREE.MathUtils.lerp(hemi.intensity, lightingState.baseHemiIntensity, 0.08);
  }
}

function update(dt) {
  const prev = controls.getObject().position.clone();
  const input = computeMovementInput();
  const hasInput = input.lengthSq() > 0;
  targetVelocity.copy(input).multiplyScalar(MOVE_SETTINGS.maxSpeed);
  const damping = hasInput ? MOVE_SETTINGS.accel : MOVE_SETTINGS.decel;
  const lerpFactor = THREE.MathUtils.clamp(1 - Math.exp(-damping * dt), 0, 1);
  playerVelocity.lerp(targetVelocity, lerpFactor);
  if (!hasInput && playerVelocity.lengthSq() < 1e-4) {
    playerVelocity.set(0, 0);
  }
  if (playerVelocity.y !== 0) controls.moveForward(playerVelocity.y * dt);
  if (playerVelocity.x !== 0) controls.moveRight(playerVelocity.x * dt);

  const pos = controls.getObject().position;
  pos.y = 1.5;
  let collided = false;
  for (const box of wallBoxes) {
    if (box.containsPoint(pos)) {
      collided = true;
      break;
    }
  }
  if (collided) {
    pos.copy(prev);
    playerVelocity.set(0, 0);
  } else {
    applyGridSnap(pos, dt);
  }

  if (!lastTrailPos || pos.distanceTo(lastTrailPos) > 1.5) {
    trail.push(pos.clone());
    lastTrailPos = pos.clone();
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
  const frameNow = performance.now();
  if (running && !paused) {
    const t = (frameNow - startTime) / 1000;
    timeEl.textContent = t.toFixed(2);
    update(dt);
    if (net && frameNow - lastPosSent > 100) {
      const p = controls.getObject().position;
      const latency = lastPosSent ? frameNow - lastPosSent : 0;
      net.send('pos', { id: myId, x: p.x, z: p.z, time: t });
      notifyNetworkLatency(latency, {
        event: 'posSync',
        intervalMs: latency,
        position: vectorToSnapshot(p),
      });
      lastPosSent = frameNow;
    }
  }
  updateLighting(frameNow);
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
    renderMinimapOverlay();
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
