import { createBoard } from "./board.js";
import { mountInputWrapper } from "./input.js";
import { createPieces, applySnapshot, animateMove, update as updatePieces } from "./pieces.js";
import { mountHUD } from "./ui/hud.js";
import { mountThemePicker } from "./ui/themePicker.js";
import { mountCameraPresets } from "./ui/cameraPresets.js";
import { mountEvalMood } from "./ui/evalMood.js";
import { log, warn } from '../../tools/reporters/console-signature.js';
import { injectHelpButton } from '../../shared/ui.js';
import { pushEvent } from "/games/common/diag-adapter.js";
import { gameEvent } from '../../shared/telemetry.js';
import * as logic from "./logic.js";

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
} catch (error) {
  warn('chess3d', '[Chess3D] failed to load catalog', error);
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

let renderLoopId = 0;
let renderLoopPaused = false;
let shellLoopAutoPaused = false;
let shellClockAutoPaused = false;
let handleShellPause = () => {};
let handleShellResume = () => {};

(function installShellAutoPause(){
  const onPause = () => handleShellPause();
  const onResume = () => handleShellResume();
  window.addEventListener('ggshell:pause', onPause);
  window.addEventListener('ggshell:resume', onResume);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) handleShellPause();
    else handleShellResume();
  });
  window.addEventListener('message', (event) => {
    const data = event && typeof event.data === 'object' ? event.data : null;
    const type = data?.type;
    if (type === 'GAME_PAUSE' || type === 'GG_PAUSE') handleShellPause();
    if (type === 'GAME_RESUME' || type === 'GG_RESUME') handleShellResume();
  }, { passive: true });
})();

log('chess3d', '[Chess3D] booting');

const helpEntry = games?.find?.((g) => g.id === 'chess3d');
const help = sanitizeHelp(helpEntry?.help || window.helpData || {});
window.helpData = help;
injectHelpButton({ gameId: 'chess3d', ...help });

const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const coordsEl = document.getElementById('coords');
const thinkingEl = document.getElementById('thinking');
const difficultyEl = document.getElementById('difficulty');
const victorySound = typeof Audio !== 'undefined'
  ? new Audio('../../assets/audio/victory.wav')
  : null;
if (victorySound) victorySound.preload = 'auto';
stage.style.position = 'relative';
stage.appendChild(coordsEl);
coordsEl.style.position = 'absolute';
coordsEl.style.left = '0';
coordsEl.style.top = '0';
coordsEl.style.width = '100%';
coordsEl.style.height = '100%';
coordsEl.style.pointerEvents = 'none';

let currentCamera;
let searchToken = 0;
let evalBar;
let lastMoveHelper;
let evalMoodEffect;
let autoRotate = localStorage.getItem('chess3d.rotate') === '1';
let postedReady=false;
let lastEvaluation = null;
let evaluationToken = 0;
let gameState = null;
let startRenderLoopImpl = () => {};
let stopRenderLoopImpl = () => {};
let currentState = 'menu';
let runStartTime = now();
let gameOverSent = false;
const stateListeners = new Set();
const globalScope = typeof window !== 'undefined' ? window : undefined;
let victoryPlayed = false;

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now());

function notifyStateChange(nextState, details = {}) {
  const normalized = typeof nextState === 'string' ? nextState.trim() : '';
  if (!normalized) return;
  const previous = currentState;
  if (normalized === previous && !details?.force) return;
  currentState = normalized;
  const payload = Object.assign({ previous, state: normalized }, details || {});
  if (normalized === 'play') {
    runStartTime = now();
    gameOverSent = false;
    gameEvent('play', {
      slug: 'chess3d',
      meta: {
        reason: payload.reason || '',
      },
    });
  } else if (normalized === 'gameover' && !gameOverSent) {
    gameOverSent = true;
    const durationMs = Math.max(0, Math.round(now() - (runStartTime || now())));
    const message = String(payload.message || '').toLowerCase();
    let result = 'draw';
    if (message.includes('white wins')) result = 'win';
    else if (message.includes('black wins')) result = 'lose';
    const value = result === 'win' ? 1 : result === 'lose' ? 0 : 0.5;
    const meta = {
      message: payload.message || '',
      reason: payload.reason || '',
    };
    gameEvent('game_over', {
      slug: 'chess3d',
      value,
      durationMs,
      meta,
    });
    if (result === 'win' || result === 'lose') {
      gameEvent(result, {
        slug: 'chess3d',
        meta,
      });
    }
  }
  if (!stateListeners.size) return;
  stateListeners.forEach((listener) => {
    try {
      listener(normalized, payload);
    } catch (err) {
      warn('chess3d', '[Chess3D] state listener failed', err);
    }
  });
}

const chess3dController = {
  startRenderLoop: () => startRenderLoopImpl(),
  stopRenderLoop: () => stopRenderLoopImpl(),
  getAIDepth: () => getDepth(),
  setAIDepth(value) {
    return setAIDepth(value);
  },
  get camera() {
    return currentCamera || null;
  },
  get lastEvaluation() {
    return lastEvaluation;
  },
  get state() {
    return currentState;
  },
  onStateChange(listener) {
    if (typeof listener !== 'function') return () => {};
    stateListeners.add(listener);
    try {
      listener(currentState, { previous: null, state: currentState, initial: true });
    } catch (err) {
      warn('chess3d', '[Chess3D] state listener failed', err);
    }
    return () => stateListeners.delete(listener);
  },
  transitionTo(state, details) {
    notifyStateChange(state, details);
  },
};

if (globalScope) {
  globalScope.Chess3D = chess3dController;
}

notifyStateChange('menu', { reason: 'boot:init', initial: true, force: true });

function handlePostMove(){
  try{ moveList?.refresh(); moveList?.setIndex(logic.historySAN().length); }catch(_){ }
  try{
    if (clockPaused){ clocks?.resume(); clockPaused = false; }
    clocks?.startTurn?.(logic.turn());
  }catch(_){ }
  try{
    const depth = getDepth();
    const token = ++evaluationToken;
    logic.requestEvaluation(depth).then((result)=>{
      if (token !== evaluationToken || !result) return;
      const { cp, mate, pv } = result;
      const line = mate ? `Mate in ${mate}` : (pv || '');
      try{ evalBar?.update(cp, line); }catch(_){ }
      lastEvaluation = {
        cp: typeof cp === 'number' ? cp : null,
        mate: typeof mate === 'number' ? mate : null,
        pv: pv || '',
        depth,
        fen: logic.fen(),
        timestamp: Date.now(),
      };
      evalMoodEffect?.update(lastEvaluation);
    }).catch((err) => {
      if (token === evaluationToken) {
        warn('chess3d', '[Chess3D] evaluation failed', err);
        evalMoodEffect?.update(null);
      }
    });
  }catch(_){ }
  if (gameState?.inCheckmate) endGame(`${gameState.turn === 'w' ? 'Black' : 'White'} wins by checkmate`);
  else if (gameState?.inStalemate) endGame('Draw by stalemate');
  if (autoRotate) flipCamera();
}


function toggleCoords(show) {
  localStorage.setItem('chess3d.coords', show ? '1' : '0');
  if (show) {
    coordsEl.hidden = false;
    coordsEl.innerHTML = '';
    const files = 'ABCDEFGH';
    const ranks = '12345678';

    const top = document.createElement('div');
    top.style.position = 'absolute';
    top.style.top = '0';
    top.style.left = '0';
    top.style.right = '0';
    top.style.display = 'flex';
    top.style.justifyContent = 'space-between';
    files.split('').forEach((ch) => {
      const span = document.createElement('span');
      span.textContent = ch;
      top.appendChild(span);
    });
    const bottom = top.cloneNode(true);
    bottom.style.top = '';
    bottom.style.bottom = '0';
    coordsEl.appendChild(top);
    coordsEl.appendChild(bottom);

    const left = document.createElement('div');
    left.style.position = 'absolute';
    left.style.top = '0';
    left.style.bottom = '0';
    left.style.left = '0';
    left.style.display = 'flex';
    left.style.flexDirection = 'column';
    left.style.justifyContent = 'space-between';
    ranks.split('').forEach((ch) => {
      const span = document.createElement('span');
      span.textContent = ch;
      left.appendChild(span);
    });
    const right = left.cloneNode(true);
    right.style.left = '';
    right.style.right = '0';
    coordsEl.appendChild(left);
    coordsEl.appendChild(right);
  } else {
    coordsEl.hidden = true;
    coordsEl.innerHTML = '';
  }
}

function updateStatus() {
  if (!gameState) return;
  const side = gameState.turn === 'w' ? 'White' : 'Black';
  let text = `${side} to move`;
  if (gameState.inCheck) text += ' — Check';
  statusEl.textContent = text;
}

function getDepth(){
  const val = parseInt(difficultyEl?.value || '1', 10);
  return Math.max(1, val);
}

function setAIDepth(value) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return getDepth();
  const depth = Math.max(1, numeric);
  if (difficultyEl) {
    const current = parseInt(difficultyEl.value || '1', 10);
    if (current !== depth) {
      difficultyEl.value = String(depth);
    }
    let dispatched = false;
    if (typeof Event === 'function') {
      try {
        difficultyEl.dispatchEvent(new Event('change', { bubbles: true }));
        dispatched = true;
      } catch (_) {}
    }
    if (!dispatched) {
      try {
        const legacy = difficultyEl.ownerDocument?.createEvent?.('Event');
        if (legacy) {
          legacy.initEvent('change', true, true);
          difficultyEl.dispatchEvent(legacy);
          dispatched = true;
        }
      } catch (_) {}
    }
    if (!dispatched) {
      try { difficultyEl.onchange?.({ type: 'change' }); } catch (_) {}
    }
  }
  return depth;
}

async function maybeAIMove(){
  if (!gameState || gameState.turn !== 'b') return;
  if (gameOver) return;
  const token = ++searchToken;
  thinkingEl.hidden = false;
  const depth = getDepth();
  const startTime = now();
  try {
    const res = await logic.playAIMove(depth);
    if (token !== searchToken || !res?.ok) return;
  } finally {
    thinkingEl.hidden = true;
    const duration = Math.max(0, now() - startTime);
    pushEvent('probe', { type: 'ai', depth, duration: Math.round(duration) });
  }
}

function flipCamera() {
  if (!currentCamera) return;
  const startX = currentCamera.position.x;
  const startZ = currentCamera.position.z;
  const endX = -startX;
  const endZ = -startZ;
  const y = currentCamera.position.y;
  const duration = 500;
  const startTime = performance.now();
  function animate(time) {
    const t = Math.min((time - startTime) / duration, 1);
    currentCamera.position.x = startX + (endX - startX) * t;
    currentCamera.position.z = startZ + (endZ - startZ) * t;
    currentCamera.position.y = y;
    currentCamera.lookAt(0, 0, 0);
    if (t < 1) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

mountHUD({
  onNew: () => {
    victoryPlayed = false;
    if (victorySound) {
      try {
        victorySound.pause();
        victorySound.currentTime = 0;
      } catch (_) {}
    }
    gameOver = false;
    stage.style.pointerEvents = 'auto';
    logic.startNewGame();
    updateStatus();
    searchToken++;
    thinkingEl.hidden = true;
    lastEvaluation = null;
    evaluationToken++;
    evalMoodEffect?.update(null);
    notifyStateChange('play', { reason: 'new-game' });
    maybeAIMove();
  },
  onFlip: flipCamera,
  onCoords: toggleCoords,
  onRotate: (val) => { autoRotate = val; },
});

difficultyEl?.addEventListener('change', () => {
  logic.stopSearch();
  searchToken++;
  thinkingEl.hidden = true;
  evalMoodEffect?.update(null);
  maybeAIMove();
});

async function boot(){
  let THREE, Controls;
  try {
    THREE = await import('./lib/three.module.js');
    ({ OrbitControls: Controls } = await import('./lib/OrbitControls.js'));
  } catch (e) {
    statusEl.textContent = 'Three.js vendor files missing. Add them to games/chess3d/lib.';
    warn('chess3d', '[Chess3D] missing vendor libs', e);
    return;
  }

  statusEl.textContent = 'Initializing…';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f1a);
  scene.fog = new THREE.Fog(0x0b0f1a, 18, 36);
  const camera = new THREE.PerspectiveCamera(
    50,
    (stage.clientWidth || window.innerWidth) /
      (stage.clientHeight || window.innerHeight),
    0.1,
    1000
  );
  camera.position.set(6, 10, 6);
  camera.lookAt(0, 0, 0);
  currentCamera = camera;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const width = stage.clientWidth || window.innerWidth;
  const height = stage.clientHeight || window.innerHeight;
  renderer.setSize(width, height);
  try { renderer.shadowMap.enabled = true; } catch(_) {}
  try { renderer.shadowMap.type = THREE.PCFSoftShadowMap ?? THREE.BasicShadowMap; } catch(_) {}
  try { renderer.toneMapping = THREE.ACESFilmicToneMapping ?? THREE.ReinhardToneMapping ?? 0; } catch(_) {}
  try { renderer.toneMappingExposure = 1.15; } catch(_) {}
  try { renderer.outputColorSpace = THREE.SRGBColorSpace; } catch(_) { try { renderer.outputEncoding = THREE.sRGBEncoding; } catch(_){} }
  stage.appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  const controls = new Controls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minPolarAngle = Math.PI * 0.18;
  controls.minDistance = 6;
  controls.maxDistance = 16;
  controls.enablePan = false;
  controls.target.set(0, 0, 0);
  controls.update();

  mountCameraPresets(document.getElementById('hud'), camera, controls);
  evalMoodEffect = mountEvalMood(stage, () => currentCamera);
  evalMoodEffect?.update(null);

  const amb = new THREE.HemisphereLight(0xbfd4ff, 0x1a1e29, 0.8);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(8, 12, 6);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024,1024);
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 40;
  dir.shadow.camera.left = -10;
  dir.shadow.camera.right = 10;
  dir.shadow.camera.top = 10;
  dir.shadow.camera.bottom = -10;
  dir.shadow.bias = -0.0005;
  dir.shadow.normalBias = 0.02;
  scene.add(dir);

  // Fill light for softer contrast
  const fill = new THREE.DirectionalLight(0x8bb2ff, 0.25);
  fill.position.set(-6, 6, -8);
  scene.add(fill);

  // Soft ground shadow outside the board
  const GroundMat = THREE.ShadowMaterial ? new THREE.ShadowMaterial({ opacity: 0.18 }) : new THREE.MeshPhongMaterial({ color: 0x000000, transparent: true, opacity: 0.15 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40,40), GroundMat);
  ground.rotation.x = -Math.PI/2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  scene.add(ground);

  statusEl.textContent = 'Scene ready';

  const helpers = await createBoard(scene, THREE);
  toggleCoords(true);
  const savedCoords = localStorage.getItem('chess3d.coords');
  if (savedCoords !== null) toggleCoords(savedCoords === '1');
  statusEl.textContent = 'Board ready';

  await createPieces(scene, THREE, helpers);
  mountThemePicker(document.getElementById('hud'));
  // Eval bar
  import('./ui/evalBar.js').then(({ mountEvalBar })=>{
    evalBar = mountEvalBar(document.getElementById('hud'));
  });
  // Last move arrow
  import('./ui/lastMove.js').then(({ initLastMove })=>{
    lastMoveHelper = initLastMove(scene, helpers, THREE);
  });
  const rulesBridge = {
    getLegalMoves: (square) => logic.getLegalMoves(square),
    move: ({ from, to, promotion }) => logic.applyMove({ from, to, promotion }),
    turn: () => logic.turn(),
  };
  mountInputWrapper({
    THREE,
    scene,
    camera,
    renderer,
    controls,
    boardHelpers: helpers,
    rulesApi: rulesBridge,
  });

  const handleLogicUpdate = (snapshot) => {
    const previous = gameState;
    gameState = snapshot;
    const reason = typeof snapshot.reason === 'string' ? snapshot.reason : '';
    const shouldReset = !previous || ['init', 'new-game', 'load-fen', 'undo'].includes(reason);
    if (shouldReset) {
      applySnapshot(snapshot.pieces);
      try { lastMoveHelper?.clear?.(); } catch (_) {}
      evalMoodEffect?.update(lastEvaluation);
    }
    updateStatus();
    if (reason === 'move' && snapshot.lastMove) {
      animateMove(snapshot.lastMove);
      try { lastMoveHelper?.show(snapshot.lastMove.from, snapshot.lastMove.to); } catch (_) {}
      try {
        if (snapshot.inCheck) {
          window.SFX?.seq?.([[880,0.08,0.25],[440,0.10,0.25]]);
        } else {
          window.SFX?.beep?.({ freq: 660, dur: 0.06, vol: 0.2 });
        }
      } catch (_) {}
      handlePostMove();
      maybeAIMove();
    } else if (shouldReset) {
      handlePostMove();
    }
  };

  logic.onUpdate(handleLogicUpdate);
  await logic.init();
  notifyStateChange('play', { reason: 'boot:ready' });

  const renderFrame = () => {
    if (renderLoopPaused) {
      renderLoopId = 0;
      return;
    }
    controls.update();
    if(!postedReady){
      postedReady=true;
      try { window.parent?.postMessage({ type:'GAME_READY', slug:'chess3d' }, '*'); } catch {}
    }
    updatePieces(performance.now());
    renderer.render(scene, camera);
    renderLoopId = requestAnimationFrame(renderFrame);
  };
  startRenderLoopImpl = () => {
    if (renderLoopId) return;
    renderLoopPaused = false;
    renderLoopId = requestAnimationFrame(renderFrame);
  };
  stopRenderLoopImpl = () => {
    renderLoopPaused = true;
    if (renderLoopId) {
      cancelAnimationFrame(renderLoopId);
      renderLoopId = 0;
    }
  };
  startRenderLoopImpl();

  handleShellPause = () => {
    const wasRunning = !!renderLoopId && !renderLoopPaused;
    stopRenderLoopImpl();
    shellLoopAutoPaused = wasRunning;
    if (!gameOver && clocks && typeof clocks.pause === 'function') {
      try {
        clocks.pause();
        shellClockAutoPaused = true;
      } catch (_) {
        shellClockAutoPaused = false;
      }
    } else {
      shellClockAutoPaused = false;
    }
  };
  handleShellResume = () => {
    if (document.hidden) return;
    if (shellClockAutoPaused && !gameOver && clocks && typeof clocks.resume === 'function') {
      try { clocks.resume(); } catch (_) {}
      shellClockAutoPaused = false;
    }
    if (shellLoopAutoPaused && !renderLoopId) {
      shellLoopAutoPaused = false;
      startRenderLoopImpl();
    } else if (!renderLoopId && !renderLoopPaused) {
      startRenderLoopImpl();
    }
  };

  try{ window.__Chess3DBooted = true; }catch(_){}
}

const bootPromise = boot();

bootPromise
  .then(() => import('./adapter.js'))
  .catch((error) => {
    warn('chess3d', '[Chess3D] diagnostics adapter failed', error);
  });

let gameOver = false;
let clockPaused = false;
let clocks;
let moveList;

function endGame(text){
  gameOver = true;
  stage.style.pointerEvents = 'none';
  logic.stopSearch();
  searchToken++;
  thinkingEl.hidden = true;
  if (text) {
    statusEl.textContent = text;
    if (!victoryPlayed && /white wins/i.test(text)) {
      victoryPlayed = true;
      if (victorySound) {
        try {
          victorySound.currentTime = 0;
          const playback = victorySound.play();
          if (playback?.catch) playback.catch(() => {});
        } catch (err) {
          warn('chess3d', '[Chess3D] failed to play victory sound', err);
        }
      }
    }
  }
  notifyStateChange('gameover', { reason: 'game-over', message: text || '' });
}

const origMaybeAIMove = maybeAIMove;
maybeAIMove = async function(){
  if (gameOver) return;
  await origMaybeAIMove();
  moveList?.setIndex(logic.historySAN().length);
};

// Do not mutate ESM exports; call handlePostMove() at call sites instead

async function jumpToPly(ply){
  clockPaused = true;
  clocks?.pause();
  logic.stopSearch();
  searchToken++;
  thinkingEl.hidden = true;
  evaluationToken++;
  lastEvaluation = null;
  const mod = await import('../chess/engine/chess.min.js');
  const ChessCtor = mod.default || mod.Chess || mod;
  const temp = new ChessCtor();
  const moves = logic.historySAN();
  const limit = Math.min(ply, moves.length);
  for (let i = 0; i < limit; i += 1) {
    const san = moves[i];
    if (!san) break;
    const move = temp.move(san);
    if (!move) break;
  }
  const targetFen = temp.fen();
  logic.loadFEN(targetFen);
  updateStatus();
  moveList?.setIndex(ply);
  moveList?.refresh();
  gameOver = false;
  stage.style.pointerEvents = 'auto';
}

import('./ui/clocks.js').then(({ mountClocks }) => {
  clocks = mountClocks(document.getElementById('hud'), {
    onFlag: (side) => {
      const winner = side === 'w' ? 'Black' : 'White';
      endGame(`${winner} wins on time`);
    },
  });
  import('./modes/analysis.js').then(({ mountAnalysis }) => {
    mountAnalysis(document.getElementById('hud'), { clocks });
  });
});

import('./ui/movelist.js').then(({ mountMoveList }) => {
  moveList = mountMoveList(document.getElementById('hud'), { onJump: jumpToPly });
});

import('./ui/hud.js').then(({ addGameButtons }) => {
  addGameButtons({
    onResign: () => {
      const loser = logic.turn();
      const winner = loser === 'w' ? 'Black' : 'White';
      endGame(`${winner} wins by resignation`);
    },
    onDraw: () => endGame('Draw agreed'),
  });
  const hud = document.getElementById('hud');
  const btnNew = hud && hud.querySelector('button');
  if (btnNew) {
    btnNew.addEventListener('click', () => {
      gameOver = false;
      stage.style.pointerEvents = 'auto';
      clocks?.reset();
      moveList?.refresh();
      moveList?.setIndex(logic.historySAN().length);
      victoryPlayed = false;
      if (victorySound) {
        try {
          victorySound.pause();
          victorySound.currentTime = 0;
        } catch (_) {}
      }
    });
  }
});
