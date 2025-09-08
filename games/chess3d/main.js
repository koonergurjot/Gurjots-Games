import { createBoard } from "./board.js";
import * as rules from "./engine/rules.js";
import { mountInput } from "./input.js";
import { createPieces, placeInitialPosition, movePieceByUci } from "./pieces.js";
import { mountHUD } from "./ui/hud.js";
import { initEngine, requestBestMove, cancel } from "./ai/ai.js";
import { mountModeBar, getMode, getDifficulty } from "./ui/modeBar.js";
import { mountThemePicker } from "./ui/themePicker.js";
import { mountCameraPresets } from "./ui/cameraPresets.js";

console.log('[Chess3D] booting');

const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const coordsEl = document.getElementById('coords');
const thinkingEl = document.getElementById('thinking');
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
const origRulesMove = rules.move;

function handlePostMove(){
  try{ moveList?.refresh(); moveList?.setIndex(rules.historySAN().length); }catch(_){ }
  try{ if (clockPaused){ clocks?.resume(); clockPaused = false; } clocks?.startTurn(rules.turn()); }catch(_){ }
  try{
    import('./ai/ai.js').then(({ evaluate })=>{
      evaluate(rules.fen(),{ depth: 10 }).then(({ cp, mate, pv })=>{
        const line = mate ? `Mate in ${mate}` : pv || '';
        try{ evalBar?.update(cp, line); }catch(_){ }
      });
    });
  }catch(_){ }
  if (rules.inCheckmate()) endGame(`${rules.turn()==='w'?'Black':'White'} wins by checkmate`);
  else if (rules.inStalemate()) endGame('Draw by stalemate');
}

function applyMove(opts){
  if (gameOver) return { ok: false };
  if (rebuilding) return origRulesMove(opts);
  const res = origRulesMove(opts);
  if (res?.ok){
    handlePostMove();
  }
  return res;
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

function difficultyToSearch(d){
  const clamped = Math.min(8, Math.max(1, d|0));
  const depth = 6 + clamped; // 7..14
  const movetime = 200 + clamped * 200; // 400..1800ms
  const skill = clamped; // 1..8
  return { depth, movetime, skill };
}

async function maybeAIMove(){
  const mode = getMode();
  const turn = rules.turn();
  const aiTurn = (mode === 'aiw' && turn === 'b') || (mode === 'aib' && turn === 'w');
  if (!aiTurn) return;
  cancel();
  const token = ++searchToken;
  thinkingEl.hidden = false;
  const cfg = difficultyToSearch(getDifficulty());
  const { uci } = await requestBestMove(rules.fen(), cfg);
  thinkingEl.hidden = true;
  if (token !== searchToken || !uci) return;
  const from = uci.slice(0,2);
  const to = uci.slice(2,4);
  let promotion;
  if (uci.length > 4) {
    promotion = uci.includes('=') ? uci.split('=')[1].toLowerCase() : 'q';
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
});

mountModeBar(document.getElementById('hud'), {
  onChange: () => {
    cancel();
    searchToken++;
    thinkingEl.hidden = true;
    maybeAIMove();
  }
});

async function boot(){
  let THREE, Controls;
  try {
    THREE = await import('./lib/three.module.js');
    ({ OrbitControls: Controls } = await import('./lib/OrbitControls.js'));
  } catch (e) {
    statusEl.textContent = 'Three.js vendor files missing. Add them to games/chess3d/lib.';
    console.warn('[Chess3D] missing vendor libs', e);
    return;
  }

  statusEl.textContent = 'Initializing…';
  await initEngine();

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
let rebuilding = false;
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
  rebuilding = true;
  clockPaused = true;
  clocks?.pause();
  cancel();
  searchToken++;
  thinkingEl.hidden = true;
  const mod = await import('./engine/chess.min.js');
  const ChessCtor = mod.default || mod.Chess || mod;
  const temp = new ChessCtor();
  const moves = rules.historySAN();
  rules.loadFEN(null);
  await placeInitialPosition();
  for (let i = 0; i < ply; i++) {
    const m = temp.move(moves[i]);
    if (!m) break;
    origRulesMove({ from: m.from, to: m.to, promotion: m.promotion });
    await movePieceByUci(m.from + m.to + (m.promotion || ''));
  }
  updateStatus();
  moveList?.setIndex(ply);
  moveList?.refresh();
  rebuilding = false;
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
