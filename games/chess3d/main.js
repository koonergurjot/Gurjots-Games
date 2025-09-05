import { createBoard } from "./board.js";

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

function toggleCoords(show) {
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
  statusEl.textContent = 'Board ready';

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

boot();
