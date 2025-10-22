import { createBoard } from "./board.js";
import { mountInputWrapper } from "./input.js";
import { createPieces, applySnapshot, animateMove, update as updatePieces } from "./pieces.js";
import { mountHUD } from "./ui/hud.js";
import { mountThemePicker } from "./ui/themePicker.js";
import { mountCameraPresets } from "./ui/cameraPresets.js";
import { mountEvalMood } from "./ui/evalMood.js";
import { mountFallbackBoard } from "./ui/fallbackBoard.js";
import { log, warn } from '../../tools/reporters/console-signature.js';
import { injectHelpButton } from '../../shared/ui.js';
import { pushEvent } from "/games/common/diag-adapter.js";
import { gameEvent } from '../../shared/telemetry.js';
import * as logic from "./logic.js";

const ASSET_BASE_URL = new URL('../../', import.meta.url);

function resolveAsset(path) {
  if (!path) return path;
  try {
    const normalized = path.startsWith('/') ? path.slice(1) : path;
    return new URL(normalized, ASSET_BASE_URL).href;
  } catch (_) {
    return path;
  }
}

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

const rulesBridge = {
  getLegalMoves: (square) => logic.getLegalMoves(square),
  move: ({ from, to, promotion }) => logic.applyMove({ from, to, promotion }),
  turn: () => logic.turn(),
};

let renderLoopId = 0;
let renderLoopPaused = false;
let shellLoopAutoPaused = false;
let shellClockAutoPaused = false;
let handleShellPause = () => {};
let handleShellResume = () => {};
let fallbackController = null;
let fallbackActive = false;
let stageRef = null;
let statusRef = null;
let coordsRef = null;

function configureRenderer(renderer, THREE) {
  if (!renderer || !THREE) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  if (renderer.shadowMap) {
    renderer.shadowMap.enabled = true;
    if (THREE.PCFSoftShadowMap !== undefined) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
  }
  if ('physicallyCorrectLights' in renderer) {
    renderer.physicallyCorrectLights = true;
  } else if ('useLegacyLights' in renderer) {
    renderer.useLegacyLights = false;
  }
  if ('toneMapping' in renderer && THREE.ACESFilmicToneMapping !== undefined) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }
  if ('toneMappingExposure' in renderer) {
    renderer.toneMappingExposure = 1.15;
  }
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace !== undefined) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
}

function activateFallback(options = {}) {
  if (fallbackActive) {
    if (options.rulesBridge && fallbackController?.setRulesApi) {
      fallbackController.setRulesApi(options.rulesBridge);
    }
    if (options.snapshot && fallbackController?.updateSnapshot) {
      fallbackController.updateSnapshot(options.snapshot);
    }
    return;
  }
  fallbackActive = true;
  const { reason = 'unknown', renderer, controls, message, snapshot } = options;
  try { stopRenderLoopImpl?.(); } catch (_) {}
  try { controls?.dispose?.(); } catch (_) {}
  try { renderer?.dispose?.(); } catch (_) {}
  const fallbackMessage = message || 'WebGL renderer unavailable. Showing 2D board.';
  if (renderer?.domElement?.parentNode) {
    try { renderer.domElement.parentNode.removeChild(renderer.domElement); } catch (_) {}
  }
  if (stageRef) {
    Array.from(stageRef.children).forEach((child) => {
      if (child !== coordsRef) {
        stageRef.removeChild(child);
      }
    });
    stageRef.style.pointerEvents = 'auto';
  }
  if (coordsRef) {
    coordsRef.style.display = 'none';
  }
  if (statusRef) {
    statusRef.textContent = fallbackMessage;
  }
  try {
    warn('chess3d', `[Chess3D] activating fallback mode (${reason})`);
  } catch (_) {}
  if (stageRef) {
    fallbackController = mountFallbackBoard({
      container: stageRef,
      message: fallbackMessage,
    });
    if (fallbackController?.setRulesApi) {
      fallbackController.setRulesApi(options.rulesBridge || rulesBridge);
    }
    if (snapshot && fallbackController?.updateSnapshot) {
      fallbackController.updateSnapshot(snapshot);
    }
  }
}

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
const VICTORY_AUDIO_SRC = resolveAsset('/assets/audio/victory.wav');
const audioSupported = typeof Audio !== 'undefined';
let audioReady = typeof window === 'undefined';
let audioUnlockAttached = false;
let victorySound = null;
let victorySoundFailed = false;

function ensureAudioUnlock() {
  if (audioReady || audioUnlockAttached || typeof window === 'undefined') return;
  audioUnlockAttached = true;
  const unlock = () => {
    audioReady = true;
    prepareVictorySound();
  };
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
}

function prepareVictorySound() {
  if (!audioReady || victorySound || victorySoundFailed || !audioSupported) return;
  try {
    victorySound = new Audio(VICTORY_AUDIO_SRC);
    victorySound.preload = 'auto';
  } catch (err) {
    victorySoundFailed = true;
    console.warn('[chess3d] failed to prepare victory audio', err);
  }
}

function getVictorySound() {
  if (!audioReady) {
    ensureAudioUnlock();
    return null;
  }
  if (!victorySound && !victorySoundFailed) {
    prepareVictorySound();
  }
  return victorySound;
}

ensureAudioUnlock();
if (audioReady) {
  prepareVictorySound();
}
stage.style.position = 'relative';
stage.appendChild(coordsEl);
coordsEl.style.position = 'absolute';
coordsEl.style.left = '0';
coordsEl.style.top = '0';
coordsEl.style.width = '100%';
coordsEl.style.height = '100%';
coordsEl.style.pointerEvents = 'none';
stageRef = stage;
statusRef = statusEl;
coordsRef = coordsEl;

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
let runStartTime = 0;
let gameOverSent = false;
const stateListeners = new Set();
const globalScope = typeof window !== 'undefined' ? window : undefined;
let victoryPlayed = false;

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now());

runStartTime = now();

const FAST_MATE_WINDOW_MS = 30_000;
const OPENING_UNKNOWN_LABEL = 'Unknown Opening';

let gameStartTimestamp = runStartTime;
let fastMateEventSent = false;

const OPENING_BUCKETS = [
  {
    key: 'italian',
    label: 'Italian Game',
    eco: 'C50-C54',
    patterns: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'],
    ],
  },
  {
    key: 'ruy-lopez',
    label: 'Ruy Lopez',
    eco: 'C60-C99',
    patterns: [
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'],
    ],
  },
  {
    key: 'sicilian',
    label: 'Sicilian Defence',
    eco: 'B20-B99',
    patterns: [
      ['e4', 'c5'],
      ['e4', 'c5', 'Nf3', 'd6'],
      ['e4', 'c5', 'Nf3', 'Nc6'],
      ['e4', 'c5', 'Nf3', 'e6'],
    ],
  },
  {
    key: 'french',
    label: 'French Defence',
    eco: 'C00-C19',
    patterns: [
      ['e4', 'e6'],
      ['e4', 'e6', 'd4', 'd5'],
    ],
  },
  {
    key: 'caro-kann',
    label: 'Caro-Kann Defence',
    eco: 'B10-B19',
    patterns: [
      ['e4', 'c6'],
      ['e4', 'c6', 'd4', 'd5'],
    ],
  },
  {
    key: 'scandinavian',
    label: 'Scandinavian Defence',
    eco: 'B01',
    patterns: [
      ['e4', 'd5'],
    ],
  },
  {
    key: 'queens-gambit',
    label: "Queen's Gambit",
    eco: 'D06-D69',
    patterns: [
      ['d4', 'd5', 'c4'],
      ['d4', 'd5', 'c4', 'e6'],
      ['d4', 'd5', 'c4', 'c6'],
    ],
  },
  {
    key: 'slav',
    label: 'Slav Defence',
    eco: 'D10-D19',
    patterns: [
      ['d4', 'd5', 'c4', 'c6'],
    ],
  },
  {
    key: 'kings-indian',
    label: "King's Indian Defence",
    eco: 'E60-E99',
    patterns: [
      ['d4', 'Nf6', 'c4', 'g6'],
      ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'],
    ],
  },
  {
    key: 'english',
    label: 'English Opening',
    eco: 'A10-A39',
    patterns: [
      ['c4'],
      ['c4', 'e5'],
      ['c4', 'c5'],
    ],
  },
  {
    key: 'reti',
    label: 'Réti Opening',
    eco: 'A04-A09',
    patterns: [
      ['Nf3'],
      ['Nf3', 'd5'],
      ['Nf3', 'Nf6'],
    ],
  },
  {
    key: 'london',
    label: 'London System',
    eco: 'D02-D03',
    patterns: [
      ['d4', 'Nf6', 'Bf4'],
      ['d4', 'Nf6', 'Nf3', 'd5', 'Bf4'],
    ],
  },
  {
    key: 'benoni',
    label: 'Benoni Defence',
    eco: 'A60-A79',
    patterns: [
      ['d4', 'Nf6', 'c4', 'c5'],
    ],
  },
  {
    key: 'modern',
    label: 'Modern Defence',
    eco: 'B06',
    patterns: [
      ['e4', 'g6'],
    ],
  },
];

const OPENING_DEFAULT = { key: 'unknown', label: OPENING_UNKNOWN_LABEL, eco: '', matchLength: 0 };

let currentOpeningInfo = { ...OPENING_DEFAULT };
let openingLabelUpdater = () => {};

function createOpeningInfo(base = {}) {
  const key = typeof base.key === 'string' && base.key.trim() ? base.key.trim() : OPENING_DEFAULT.key;
  const label = typeof base.label === 'string' && base.label.trim() ? base.label.trim() : OPENING_UNKNOWN_LABEL;
  const eco = typeof base.eco === 'string' && base.eco.trim() ? base.eco.trim() : '';
  const matchLength = typeof base.matchLength === 'number' && Number.isFinite(base.matchLength)
    ? Math.max(0, base.matchLength)
    : 0;
  return { key, label, eco, matchLength };
}

function formatOpeningDisplay(info) {
  const payload = info && typeof info === 'object' ? info : OPENING_DEFAULT;
  const name = payload.label || OPENING_UNKNOWN_LABEL;
  return payload.eco ? `${name} (${payload.eco})` : name;
}

function updateOpeningLabelDisplay() {
  if (typeof openingLabelUpdater === 'function') {
    openingLabelUpdater(formatOpeningDisplay(currentOpeningInfo));
  }
}

function resetOpeningTracker() {
  currentOpeningInfo = createOpeningInfo(OPENING_DEFAULT);
  updateOpeningLabelDisplay();
}

function normalizeSanMove(move) {
  if (typeof move !== 'string') return '';
  const raw = move.trim();
  if (!raw) return '';
  const castle = raw.replace(/0/g, 'O');
  if (/^O-O(-O)?[+#?!]*$/i.test(castle)) {
    return castle.toUpperCase().startsWith('O-O-O') ? 'O-O-O' : 'O-O';
  }
  let sanitized = raw.replace(/[+#?!]/g, '');
  sanitized = sanitized.replace(/x/g, '');
  sanitized = sanitized.replace(/=.*/g, '');
  return sanitized;
}

function matchOpeningFromMoves(sanMoves = []) {
  if (!Array.isArray(sanMoves) || !sanMoves.length) {
    return createOpeningInfo(OPENING_DEFAULT);
  }
  const normalized = sanMoves.slice(0, 10).map(normalizeSanMove);
  let best = null;
  for (const bucket of OPENING_BUCKETS) {
    const patterns = Array.isArray(bucket.patterns) ? bucket.patterns : [];
    for (const pattern of patterns) {
      const sequence = Array.isArray(pattern) ? pattern : [];
      const length = sequence.length;
      if (!length || normalized.length < length) continue;
      let matches = true;
      for (let i = 0; i < length; i += 1) {
        if (normalized[i] !== sequence[i]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        if (!best || length > best.matchLength) {
          best = createOpeningInfo({ ...bucket, matchLength: length });
        }
      }
    }
  }
  if (best) return best;

  const first = normalized[0] || '';
  const second = normalized[1] || '';
  if (!first) return createOpeningInfo(OPENING_DEFAULT);
  if (first === 'e4' && second === 'e5') {
    return createOpeningInfo({ key: 'open-game', label: 'Open Game', eco: 'C20-C99', matchLength: 2 });
  }
  if (first === 'e4') {
    return createOpeningInfo({ key: 'kings-pawn', label: "King's Pawn Opening", eco: 'B00-C99', matchLength: 1 });
  }
  if (first === 'd4' && second === 'd5') {
    return createOpeningInfo({ key: 'queens-pawn', label: "Queen's Pawn Game", eco: 'D00-D69', matchLength: 2 });
  }
  if (first === 'd4') {
    return createOpeningInfo({ key: 'indian-game', label: 'Indian Defence', eco: 'E00-E99', matchLength: 1 });
  }
  if (first === 'c4') {
    return createOpeningInfo({ key: 'english', label: 'English Opening', eco: 'A10-A39', matchLength: 1 });
  }
  if (first === 'Nf3') {
    return createOpeningInfo({ key: 'reti', label: 'Réti Opening', eco: 'A04-A09', matchLength: 1 });
  }
  return createOpeningInfo(OPENING_DEFAULT);
}

function updateOpeningFromMoves(moves) {
  const candidate = matchOpeningFromMoves(moves);
  if (!candidate) return;
  const currentLength = currentOpeningInfo?.matchLength || 0;
  if (candidate.key === currentOpeningInfo.key) {
    if (candidate.matchLength !== currentLength) {
      currentOpeningInfo = candidate;
      updateOpeningLabelDisplay();
    }
    return;
  }
  if (candidate.matchLength > currentLength || currentOpeningInfo.key === OPENING_DEFAULT.key) {
    currentOpeningInfo = candidate;
    updateOpeningLabelDisplay();
  }
}

function getOpeningMetaPayload() {
  if (!currentOpeningInfo) return undefined;
  const meta = {
    key: currentOpeningInfo.key,
    name: currentOpeningInfo.label,
  };
  if (currentOpeningInfo.eco) meta.eco = currentOpeningInfo.eco;
  if (typeof currentOpeningInfo.matchLength === 'number') {
    meta.movesMatched = currentOpeningInfo.matchLength;
  }
  return meta;
}

function markFastMateIfEligible() {
  if (fastMateEventSent) return;
  const baseline = typeof gameStartTimestamp === 'number' ? gameStartTimestamp : runStartTime;
  const elapsed = Math.max(0, now() - (baseline || now()));
  if (elapsed < FAST_MATE_WINDOW_MS) {
    pushEvent('score_event', { name: 'fast_mate_30s' });
    fastMateEventSent = true;
  }
}

function notifyStateChange(nextState, details = {}) {
  const normalized = typeof nextState === 'string' ? nextState.trim() : '';
  if (!normalized) return;
  const previous = currentState;
  const reason = typeof details?.reason === 'string' ? details.reason : '';
  const playRequestedWhileActive = normalized === 'play' && previous === 'play' && reason === 'new-game';
  if (normalized === previous && !details?.force && !playRequestedWhileActive) return;
  currentState = normalized;
  const payload = Object.assign({ previous, state: normalized }, details || {});
  if (normalized === 'play') {
    runStartTime = now();
    gameStartTimestamp = runStartTime;
    gameOverSent = false;
    fastMateEventSent = false;
    const openingMeta = getOpeningMetaPayload();
    const meta = {
      reason: payload.reason || '',
    };
    if (openingMeta) meta.opening = openingMeta;
    gameEvent('play', {
      slug: 'chess3d',
      meta,
    });
  } else if (normalized === 'gameover' && !gameOverSent) {
    gameOverSent = true;
    const durationMs = Math.max(0, Math.round(now() - (runStartTime || now())));
    const message = String(payload.message || '').toLowerCase();
    let result = 'draw';
    if (message.includes('white wins')) result = 'win';
    else if (message.includes('black wins')) result = 'lose';
    const value = result === 'win' ? 1 : result === 'lose' ? 0 : 0.5;
    const openingMeta = getOpeningMetaPayload();
    const meta = {
      message: payload.message || '',
      reason: payload.reason || '',
    };
    if (openingMeta) meta.opening = openingMeta;
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
  if (gameState?.inCheckmate) {
    markFastMateIfEligible();
    endGame(`${gameState.turn === 'w' ? 'Black' : 'White'} wins by checkmate`);
  } else if (gameState?.inStalemate) {
    endGame('Draw by stalemate');
  }
  if (autoRotate) flipCamera();
}


function toggleCoords(show) {
  localStorage.setItem('chess3d.coords', show ? '1' : '0');
  if (fallbackActive) {
    coordsEl.hidden = true;
    coordsEl.innerHTML = '';
    return;
  }
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

const hudControls = mountHUD({
  onNew: () => {
    victoryPlayed = false;
    const audio = getVictorySound();
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_) {}
    }
    gameOver = false;
    stage.style.pointerEvents = 'auto';
    resetOpeningTracker();
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

if (hudControls && typeof hudControls.setOpeningLabel === 'function') {
  openingLabelUpdater = (label) => {
    hudControls.setOpeningLabel(label);
  };
  updateOpeningLabelDisplay();
}

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
    activateFallback({
      reason: 'missing-three',
      message: '3D engine missing. Showing 2D fallback board.',
      rulesBridge,
    });
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
  let renderer = null;
  let controls = null;
  let helpers = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (error) {
    warn('chess3d', '[Chess3D] WebGLRenderer init failed', error);
    activateFallback({
      reason: 'webgl-init',
      message: 'WebGL unavailable. Showing 2D fallback board.',
      rulesBridge,
    });
  }

  if (!fallbackActive && renderer) {
    configureRenderer(renderer, THREE);
    const width = stage.clientWidth || window.innerWidth;
    const height = stage.clientHeight || window.innerHeight;
    renderer.setSize(width, height);
    stage.appendChild(renderer.domElement);

    const handleResize = () => {
      const w = stage.clientWidth || window.innerWidth;
      const h = stage.clientHeight || window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    controls = new Controls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minPolarAngle = Math.PI * 0.18;
    controls.minDistance = 6;
    controls.maxDistance = 16;
    controls.enablePan = false;
    controls.target.set(0, 0, 0);
    controls.update();

    renderer.domElement.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        activateFallback({
          reason: 'context-lost',
          renderer,
          controls,
          message: 'Graphics context lost. Switching to 2D board.',
          rulesBridge,
        });
        renderer = null;
        controls = null;
      },
      { passive: false }
    );

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

    helpers = await createBoard(scene, THREE);
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
    mountInputWrapper({
      THREE,
      scene,
      camera,
      renderer,
      controls,
      boardHelpers: helpers,
      rulesApi: rulesBridge,
    });
  } else {
    renderer = null;
    mountThemePicker(document.getElementById('hud'));
    activateFallback({ reason: 'webgl-init:fallback', rulesBridge });
  }

  const handleLogicUpdate = (snapshot) => {
    const previous = gameState;
    gameState = snapshot;
    const reason = typeof snapshot.reason === 'string' ? snapshot.reason : '';
    const shouldReset = !previous || ['init', 'new-game', 'load-fen', 'undo'].includes(reason);
    if (fallbackActive) {
      fallbackController?.updateSnapshot?.(snapshot);
      if (shouldReset) {
        resetOpeningTracker();
      }
      updateStatus();
      if (reason === 'move' && snapshot.lastMove) {
        try {
          if (snapshot.inCheck) {
            window.SFX?.seq?.([[880,0.08,0.25],[440,0.10,0.25]]);
          } else {
            window.SFX?.beep?.({ freq: 660, dur: 0.06, vol: 0.2 });
          }
        } catch (_) {}
        handlePostMove();
        updateOpeningFromMoves(logic.historySAN());
        maybeAIMove();
      } else if (shouldReset) {
        handlePostMove();
        updateOpeningFromMoves(logic.historySAN());
      } else {
        updateOpeningFromMoves(logic.historySAN());
      }
      return;
    }

    if (shouldReset) {
      applySnapshot(snapshot.pieces);
      try { lastMoveHelper?.clear?.(); } catch (_) {}
      evalMoodEffect?.update(lastEvaluation);
      resetOpeningTracker();
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
      updateOpeningFromMoves(logic.historySAN());
      maybeAIMove();
    } else if (shouldReset) {
      handlePostMove();
      updateOpeningFromMoves(logic.historySAN());
    } else {
      updateOpeningFromMoves(logic.historySAN());
    }
  };

  logic.onUpdate(handleLogicUpdate);
  await logic.init();
  notifyStateChange('play', { reason: 'boot:ready' });

  const renderFrame = () => {
    if (renderLoopPaused || fallbackActive || !renderer) {
      renderLoopId = 0;
      return;
    }
    controls?.update?.();
    if(!postedReady){
      postedReady=true;
      try { window.parent?.postMessage({ type:'GAME_READY', slug:'chess3d' }, '*'); } catch {}
    }
    updatePieces(performance.now());
    try {
      renderer.render(scene, camera);
    } catch (err) {
      warn('chess3d', '[Chess3D] render failed', err);
      activateFallback({ reason: 'render-failed', renderer, controls, rulesBridge });
      renderer = null;
      controls = null;
      return;
    }
    markFirstFrame();
    renderLoopId = requestAnimationFrame(renderFrame);
  };
  startRenderLoopImpl = () => {
    if (renderLoopId) return;
    if (fallbackActive || !renderer) return;
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
      const audio = getVictorySound();
      if (audio) {
        try {
          audio.currentTime = 0;
          const playback = audio.play();
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
      const audio = getVictorySound();
      if (audio) {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch (_) {}
      }
    });
  }
});
