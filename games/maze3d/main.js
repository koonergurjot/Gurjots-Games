import { recordLastPlayed } from '../../shared/ui.js';
import { emitEvent } from '../../shared/achievements.js';

recordLastPlayed('maze3d');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0f12);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(10, 20, 10);
scene.add(dir);

const controls = new THREE.PointerLockControls(camera, renderer.domElement);

const overlay = document.getElementById('overlay');
const message = document.getElementById('message');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const timeEl = document.getElementById('time');
const bestEl = document.getElementById('best');

let running = false;
let paused = true;
let startTime = 0;
let best = Number(localStorage.getItem('besttime:maze3d') || 0);
if (best) bestEl.textContent = best.toFixed(2);

const keys = {};
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyR') restart();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

startBtn.addEventListener('click', () => start());
restartBtn.addEventListener('click', () => restart());

let wallBoxes = [];
let exitBox = null;
let floor = null;
let exitMesh = null;
const cellSize = 4;
const wallHeight = 4;
const MAZE_CELLS = 8;

function generateMaze(width, height) {
  const cols = width * 2 + 1;
  const rows = height * 2 + 1;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(1));
  function carve(x, y) {
    grid[y][x] = 0;
    const dirs = [ [2,0], [-2,0], [0,2], [0,-2] ];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && grid[ny][nx] === 1) {
        grid[y + dy/2][x + dx/2] = 0;
        carve(nx, ny);
      }
    }
  }
  carve(1,1);
  grid[rows - 2][cols - 2] = 0;
  return grid;
}

function cellToWorld(x, y, cols, rows) {
  const offsetX = cols * cellSize / 2;
  const offsetZ = rows * cellSize / 2;
  return [x * cellSize - offsetX + cellSize / 2, y * cellSize - offsetZ + cellSize / 2];
}

function buildMaze() {
  if (floor) scene.remove(floor);
  if (exitMesh) scene.remove(exitMesh);
  wallBoxes = [];
  const grid = generateMaze(MAZE_CELLS, MAZE_CELLS);
  const rows = grid.length;
  const cols = grid[0].length;
  const wallGeo = new THREE.BoxGeometry(cellSize, wallHeight, cellSize);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x27314b });
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] === 1) {
        const mesh = new THREE.Mesh(wallGeo, wallMat);
        const [wx, wz] = cellToWorld(x, y, cols, rows);
        mesh.position.set(wx, wallHeight / 2, wz);
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
  scene.add(floor);

  const [sx, sz] = cellToWorld(1,1,cols,rows);
  controls.getObject().position.set(sx, 1.5, sz);

  const [ex, ez] = cellToWorld(cols - 2, rows - 2, cols, rows);
  exitMesh = new THREE.Mesh(new THREE.BoxGeometry(cellSize, wallHeight, cellSize), new THREE.MeshStandardMaterial({ color: 0x00ff00 }));
  exitMesh.position.set(ex, wallHeight / 2, ez);
  scene.add(exitMesh);
  exitBox = new THREE.Box3().setFromCenterAndSize(exitMesh.position, new THREE.Vector3(cellSize, wallHeight, cellSize));
}

function start() {
  if (!running) {
    running = true;
    startTime = performance.now();
    emitEvent({ type: 'play', slug: 'maze3d' });
  }
  paused = false;
  overlay.classList.add('hidden');
  controls.lock();
}

function restart() {
  running = false;
  paused = true;
  startTime = 0;
  buildMaze();
  timeEl.textContent = '0.00';
  message.textContent = 'Click Start to play.';
  startBtn.textContent = 'Start';
  restartBtn.style.display = 'none';
  overlay.classList.remove('hidden');
}

function pause() {
  if (!running || paused) return;
  paused = true;
  controls.unlock();
  message.textContent = 'Paused';
  startBtn.textContent = 'Resume';
  restartBtn.style.display = 'inline-block';
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (!running) return;
  if (paused) start(); else pause();
}

function finish(time) {
  running = false;
  paused = true;
  controls.unlock();
  if (!best || time < best) {
    best = time;
    localStorage.setItem('besttime:maze3d', best.toFixed(2));
    bestEl.textContent = best.toFixed(2);
  }
  message.textContent = `Finished in ${time.toFixed(2)}s`;
  startBtn.textContent = 'Start';
  restartBtn.style.display = 'inline-block';
  overlay.classList.remove('hidden');
  startTime = 0;
  emitEvent({ type: 'game_over', slug: 'maze3d', value: time });
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
}

function loop() {
  requestAnimationFrame(loop);
  const dt = 0.016; // fixed timestep
  if (running && !paused) {
    const t = (performance.now() - startTime) / 1000;
    timeEl.textContent = t.toFixed(2);
    update(dt);
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

restart();
loop();
