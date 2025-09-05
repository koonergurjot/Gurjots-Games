import { createBoard } from "./board.js";
import * as rules from "./engine/rules.js";
import { mountInput } from "./input.js";
import { createPieces, placeInitialPosition, movePieceByUci } from "./pieces.js";
import { mountHUD } from "./ui/hud.js";

console.log('[Chess3D] booting');

const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const coordsEl = document.getElementById('coords');
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
  },
  onFlip: flipCamera,
  onCoords: toggleCoords,
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

  const scene = new THREE.Scene();
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

  const amb = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(8, 12, 6);
  dir.castShadow = true;
  scene.add(dir);

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
  mountInput({
    THREE,
    scene,
    camera,
    renderer,
    controls,
    boardHelpers: helpers,
    rulesApi: rules,
    onMove: async ({ from, to }) => {
      const res = rules.move({ from, to });
      if (res?.ok) {
        await movePieceByUci(from + to);
        updateStatus();
      }
    },
  });
  updateStatus();

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

boot();
