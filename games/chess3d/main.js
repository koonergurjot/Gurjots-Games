import { createBoard } from "./board.js";
import * as rules from "../chess/engine/rules.js";
import { mountInput } from "./input.js";
import { createPieces, placeInitialPosition, movePieceByUci } from "./pieces.js";
import { mountHUD } from "./ui/hud.js";
import { bestMove, evaluate, cancel } from "./ai/simpleEngine.js";
import { mountThemePicker } from "./ui/themePicker.js";
import { mountCameraPresets } from "./ui/cameraPresets.js";
import { envDataUrl } from "./textures/env.js";
import { log, warn } from '../../tools/reporters/console-signature.js';
import { injectHelpButton } from '../../shared/ui.js';
import games from '../../games.json' assert { type: 'json' };

log('chess3d', '[Chess3D] booting');

const help = games.find(g => g.id === 'chess3d')?.help || {};
injectHelpButton({ gameId: 'chess3d', ...help });

const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const coordsEl = document.getElementById('coords');
const thinkingEl = document.getElementById('thinking');
const difficultyEl = document.getElementById('difficulty');
stage.style.position = 'relative';
stage.appendChild(coordsEl);
coordsEl.style.position = 'absolute';
coordsEl.style.left = '0';
coordsEl.style.top = '0';
coordsEl.style.width = '100%';
coordsEl.style.height = '100%';
coordsEl.style.pointerEvents = 'none';

let squareToPosition, positionToSquare, tileSize;
let currentCamera;
let searchToken = 0;
let evalBar;
let lastMoveHelper;
let autoRotate = localStorage.getItem('chess3d.rotate') === '1';

function handlePostMove(){
  try{ moveList?.refresh(); moveList?.setIndex(rules.historySAN().length); }catch(_){ }
  try{ if (clockPaused){ clocks?.resume(); clockPaused = false; } clocks?.startTurn(rules.turn()); }catch(_){ }
  try{
    evaluate(rules.fen(), { depth: getDepth() }).then(({ cp, mate, pv })=>{
      const line = mate ? `Mate in ${mate}` : pv || '';
      try{ evalBar?.update(cp, line); }catch(_){ }
    });
  }catch(_){ }
  if (rules.inCheckmate()) endGame(`${rules.turn()==='w'?'Black':'White'} wins by checkmate`);
  else if (rules.inStalemate()) endGame('Draw by stalemate');
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
  const side = rules.turn() === 'w' ? 'White' : 'Black';
  let text = `${side} to move`;
  if (rules.inCheck()) text += ' — Check';
  statusEl.textContent = text;
}

function getDepth(){
  const val = parseInt(difficultyEl?.value || '1', 10);
  return Math.max(1, val);
}

async function maybeAIMove(){
  const turn = rules.turn();
  if (turn !== 'b') return; // AI plays black
  const token = ++searchToken;
  thinkingEl.hidden = false;
  const depth = getDepth();
  const { uci } = await bestMove(rules.fen(), depth);
  thinkingEl.hidden = true;
  if (token !== searchToken || !uci) return;
  const from = uci.slice(0,2);
  const to = uci.slice(2,4);
  let promotion;
  if (uci.length > 4) {
    promotion = uci.slice(4).toLowerCase();
  }
  const res = rules.move({ from, to, promotion });
  if (res?.ok) {
    const uciMove = from + to + (promotion ? '=' + promotion : '');
    await movePieceByUci(uciMove);
    updateStatus();
    try{ lastMoveHelper?.show(from,to); }catch(_){ }
    handlePostMove();
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
    rules.loadFEN(null);
    placeInitialPosition();
    updateStatus();
    cancel();
    searchToken++;
    thinkingEl.hidden = true;
    maybeAIMove();
  },
  onFlip: flipCamera,
  onCoords: toggleCoords,
  onRotate: (val) => { autoRotate = val; },
});

difficultyEl?.addEventListener('change', () => {
  cancel();
  searchToken++;
  thinkingEl.hidden = true;
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
  // Load environment texture from data URL
  try {
    const texLoader = new THREE.TextureLoader();
    const envTex = await texLoader.loadAsync(envDataUrl);
    try { envTex.mapping = THREE.EquirectangularReflectionMapping; } catch(_){}
    try { envTex.colorSpace = THREE.SRGBColorSpace; }
    catch(_) { try { envTex.encoding = THREE.sRGBEncoding; } catch(_){} }
    scene.environment = envTex;
  } catch(_) {}
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

  mountCameraPresets(document.getElementById('hud'), camera, controls);

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
  ({ squareToPosition, positionToSquare, tileSize } = helpers);
  toggleCoords(true);
  const savedCoords = localStorage.getItem('chess3d.coords');
  if (savedCoords !== null) toggleCoords(savedCoords === '1');
  statusEl.textContent = 'Board ready';

  await rules.init();
  await createPieces(scene, THREE, helpers);
  await placeInitialPosition();
  mountThemePicker(document.getElementById('hud'));
  // Eval bar
  import('./ui/evalBar.js').then(({ mountEvalBar })=>{
    evalBar = mountEvalBar(document.getElementById('hud'));
  });
  // Last move arrow
  import('./ui/lastMove.js').then(({ initLastMove })=>{
    lastMoveHelper = initLastMove(scene, helpers, THREE);
  });
  mountInput({
    THREE,
    scene,
    camera,
    renderer,
    controls,
    boardHelpers: helpers,
    rulesApi: rules,
    onMove: async ({ from, to, promotion }) => {
      await movePieceByUci(from + to + (promotion ? '=' + promotion : ''));
      try {
        const inCheck = rules.inCheck();
        if (inCheck) {
          window.SFX?.seq?.([[880,0.08,0.25],[440,0.10,0.25]]);
        } else {
          window.SFX?.beep?.({ freq: 660, dur: 0.06, vol: 0.2 });
        }
      } catch(_){}
      updateStatus();
      // show last move arrow if helper ready
      try{ lastMoveHelper?.show(from,to); }catch(_){ }
      handlePostMove();
      maybeAIMove();
    },
  });
  updateStatus();
  maybeAIMove();

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
  try{ window.__Chess3DBooted = true; }catch(_){}
}

boot();

let gameOver = false;
let clockPaused = false;
let clocks;
let moveList;

function endGame(text){
  gameOver = true;
  stage.style.pointerEvents = 'none';
  cancel();
  searchToken++;
  thinkingEl.hidden = true;
  if (text) statusEl.textContent = text;
}

const origMaybeAIMove = maybeAIMove;
maybeAIMove = async function(){
  if (gameOver) return;
  await origMaybeAIMove();
  moveList?.setIndex(rules.historySAN().length);
};

// Do not mutate ESM exports; call handlePostMove() at call sites instead

async function jumpToPly(ply){
  clockPaused = true;
  clocks?.pause();
  cancel();
  searchToken++;
  thinkingEl.hidden = true;
  const mod = await import('../chess/engine/chess.min.js');
  const ChessCtor = mod.default || mod.Chess || mod;
  const temp = new ChessCtor();
  const moves = rules.historySAN();
  rules.loadFEN(null);
  await placeInitialPosition();
  for (let i = 0; i < ply; i++) {
    const m = temp.move(moves[i]);
    if (!m) break;
    rules.move({ from: m.from, to: m.to, promotion: m.promotion });
    await movePieceByUci(m.from + m.to + (m.promotion || ''));
  }
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
      const loser = rules.turn();
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
      moveList?.setIndex(rules.historySAN().length);
    });
  }
});
