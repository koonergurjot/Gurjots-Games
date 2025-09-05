import * as THREE from './lib/three.module.js';
import { OrbitControls } from './lib/OrbitControls.js';
import * as board from './board.js';
import {
  placeInitialPosition,
  movePiece,
  getPieceBySquare,
  capturePiece,
  resetPieces,
} from './pieces.js';
import { initInput } from './input.js';
import {
  init as initRules,
  move as applyMove,
  fen,
  history,
  turn,
  inCheckmate,
  inStalemate,
} from './engine/rules.js';
import { initEngine, requestBestMove, cancel } from './ai/ai.js';

console.log('[chess3d] boot');

// basic three.js scene setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0f12);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(6, 8, 8);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.update();

board.createBoard(scene);
placeInitialPosition(scene, board);

// status element
const statusEl = document.createElement('div');
statusEl.id = 'status';
Object.assign(statusEl.style, {
  position: 'absolute',
  top: '12px',
  left: '12px',
  color: '#e6e7ea',
  font: '600 14px/1.2 Inter,system-ui',
});
document.body.appendChild(statusEl);

const thinkingEl = document.createElement('div');
thinkingEl.textContent = 'Engine thinking…';
Object.assign(thinkingEl.style, {
  position: 'absolute',
  bottom: '12px',
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(0,0,0,0.6)',
  color: '#e6e7ea',
  padding: '4px 8px',
  borderRadius: '6px',
  font: '500 14px/1 Inter,system-ui',
  display: 'none',
});
document.body.appendChild(thinkingEl);

// game state
const params = new URL(location.href).searchParams;
const modeKey = 'chess3d:mode';
const diffKey = 'chess3d:difficulty';
let mode = params.get('mode') || localStorage.getItem(modeKey) || 'pvp'; // 'pvp' | 'ai-white' | 'ai-black'
localStorage.setItem(modeKey, mode);
let difficulty = parseInt(
  params.get('depth') || params.get('difficulty') || localStorage.getItem(diffKey) || '2',
  10,
);
localStorage.setItem(diffKey, String(difficulty));
let isAIMove = false;
let aiToken = 0;
let lastHistoryLen = 0;

function invalidateSearch() {
  cancel();
  aiToken++;
}

async function maybeAIMove() {
  if (mode === 'pvp') return;
  const aiColor = mode === 'ai-black' ? 'b' : 'w';
  if (turn() !== aiColor) return;
  if (inCheckmate() || inStalemate()) {
    invalidateSearch();
    return;
  }

  const token = ++aiToken;
  const currentFen = fen();
  thinkingEl.style.display = 'block';
  try {
    const best = await requestBestMove(currentFen, { depth: difficulty });
    if (token !== aiToken || !best) return;
    const uci = typeof best === 'string' ? best : best.bestmove || best.move || '';
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    let promotion = uci[4];
    const piece = getPieceBySquare(from);
    if (!piece) return;
    const needsPromotion =
      piece.type === 'P' &&
      ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));
    if (!promotion && needsPromotion) promotion = 'q';

    isAIMove = true;
    input.setEnabled(false);
    const result = applyMove({ from, to, promotion });
    if (!result) return;

    let captureSquare = to;
    if (result.flags && result.flags.includes('e')) {
      const dir = piece.color === 'w' ? -1 : 1;
      captureSquare = to[0] + (parseInt(to[1], 10) + dir);
    }
    const victim = getPieceBySquare(captureSquare);
    const anims = [];
    if (victim && victim.color !== piece.color) anims.push(capturePiece(victim.id));

    anims.push(movePiece(piece.id, result.to));
    if (result.flags && (result.flags.includes('k') || result.flags.includes('q'))) {
      const rookFrom = result.flags.includes('k')
        ? (piece.color === 'w' ? 'h1' : 'h8')
        : (piece.color === 'w' ? 'a1' : 'a8');
      const rookTo = result.flags.includes('k')
        ? (piece.color === 'w' ? 'f1' : 'f8')
        : (piece.color === 'w' ? 'd1' : 'd8');
      const rook = getPieceBySquare(rookFrom);
      if (rook) anims.push(movePiece(rook.id, rookTo));
    }
    if (result.promotion) piece.type = result.promotion.toUpperCase();
    input.updateStatus();
    await Promise.all(anims);
  } finally {
    thinkingEl.style.display = 'none';
    isAIMove = false;
    input.setEnabled(true);
  }
}

function reset() {
  invalidateSearch();
  initRules();
  resetPieces(scene);
  input.reset();
  lastHistoryLen = history().length;
  maybeAIMMoveAfterReset();
}

function maybeAIMMoveAfterReset() {
  // allow AI to move first if needed
  if (mode !== 'pvp' && turn() === (mode === 'ai-black' ? 'b' : 'w')) {
    maybeAIMove();
  }
}

const input = initInput({
  scene,
  camera,
  renderer,
  controls,
  onStatus: (t) => {
    statusEl.textContent = t;
    const len = history().length;
    if (inCheckmate() || inStalemate()) {
      lastHistoryLen = len;
      invalidateSearch();
      return;
    }
    if (!isAIMove && len !== lastHistoryLen) {
      lastHistoryLen = len;
      maybeAIMove();
    } else {
      lastHistoryLen = len;
    }
  },
});

function setMode(newMode) {
  if (mode === newMode) return;
  mode = newMode;
  localStorage.setItem(modeKey, mode);
  invalidateSearch();
  input.updateStatus();
  maybeAIMove();
}

function setDifficulty(newDepth) {
  const nd = parseInt(newDepth, 10);
  if (Number.isNaN(nd) || difficulty === nd) return;
  difficulty = nd;
  localStorage.setItem(diffKey, String(difficulty));
  invalidateSearch();
  maybeAIMove();
}

globalThis.chess3d = { setMode, setDifficulty, newGame: reset };

globalThis.HUD?.create({ title: 'Chess 3D', onRestart: reset });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

await initEngine();
lastHistoryLen = history().length;
maybeAIMMoveAfterReset();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

