
/**
 * Chess 3D (Local) bootstrap.
 * This file gracefully degrades when vendor libs are missing.
 */
const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const warnEl = document.getElementById('warning');
const thinkingEl = document.getElementById('thinking');

statusEl.textContent = 'Loading renderer…';

let THREE, Controls, scene, camera, renderer, controls, boardHelpers, rules;
let input;

function showWarn(msg){
  warnEl.hidden = false;
  warnEl.textContent = msg;
}

async function boot(){
  // HUD
  const { mountHUD } = await import('./ui/hud.js');
  mountHUD({
    onNew: () => newGame(),
    onFlip: () => flipCamera(),
    onCoords: (v) => toggleCoords(v)
  });

  // Try to import Three locally
  try {
    THREE = await import('./lib/three.module.js');
    ({ OrbitControls: Controls } = await import('./lib/OrbitControls.js'));
  } catch (e){
    showWarn('Three.js vendor files not found. Add games/chess3d/lib/three.module.js and OrbitControls.js');
    statusEl.textContent = 'Missing vendor libs — showing fallback.';
    return;
  }

  // Scene
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, stage.clientWidth / stage.clientHeight, 0.1, 1000);
  camera.position.set(6, 10, 6);
  camera.lookAt(0,0,0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.shadowMap.enabled = true;
  stage.appendChild(renderer.domElement);

  // Lights
  const amb = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(8,12,6);
  dir.castShadow = true;
  scene.add(dir);

  // Controls
  controls = new Controls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 22;
  controls.maxPolarAngle = Math.PI * 0.499;

  // Board
  const board = await import('./board.js');
  boardHelpers = await board.createBoard(scene, THREE);

  // Pieces
  const pieces = await import('./pieces.js');
  await pieces.createPieces(scene, THREE, boardHelpers);
  await pieces.placeInitialPosition();

  // Rules
  try {
    rules = await import('./engine/rules.js');
    await rules.init();
  } catch (e){
    showWarn('Rules engine wrapper missing. Ensure games/chess3d/engine/rules.js exists and vendors chess.min.js');
  }

  // Input
  input = await import('./input.js');
  input.mountInput({
    THREE, scene, camera, renderer, controls,
    boardHelpers,
    rulesApi: rules && rules.ready ? rules : {
      getLegalMoves(){ return []; },
      move(){ return { ok:false }; },
      fen(){ return 'startpos'; },
      turn(){ return 'w'; },
      inCheck(){return false}, inCheckmate(){return false}, inStalemate(){return false},
      ready:false
    },
    onMove: async ({from, to, promotion}) => {
      if (!rules || !rules.ready) return;
      const res = rules.move({from, to, promotion});
      if (res && res.ok){
        await pieces.movePieceByUci(`${from}${to}${promotion?("=" + promotion):""}`);
        updateStatus();
      }
    }
  });

  updateStatus();
  loop();
  window.addEventListener('resize', onResize);
  console.log('[Chess3D] boot complete');
}

function updateStatus(){
  if (!rules || !rules.ready){
    statusEl.textContent = 'Ready (no rules yet)';
    return;
  }
  const side = rules.turn() === 'w' ? 'White' : 'Black';
  let line = `${side} to move`;
  if (rules.inCheckmate()) line = `Checkmate`;
  else if (rules.inStalemate()) line = `Stalemate`;
  else if (rules.inCheck()) line += ` — Check`;
  statusEl.textContent = line;
}

function newGame(){
  if (rules && rules.ready) {
    rules.loadFEN(null);
    import('./pieces.js').then(p => p.placeInitialPosition());
    updateStatus();
  }
}

function flipCamera(){
  if (!camera) return;
  const t = camera.position;
  camera.position.set(-t.x, t.y, -t.z);
  camera.lookAt(0,0,0);
}

function toggleCoords(show){
  const el = document.getElementById('coords');
  if (!el) return;
  el.hidden = !show;
  if (show) {
    const { renderCoords } = window.__coordsAPI || {};
    if (renderCoords) renderCoords();
  }
}

function onResize(){
  if (!renderer || !camera) return;
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
}

function loop(){
  requestAnimationFrame(loop);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

boot();
