import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const slug = 'box3d';
const defaultBindings = {
  forward: 'KeyW',
  left: 'KeyA',
  back: 'KeyS',
  right: 'KeyD',
  jump: 'Space',
  reset: 'KeyR'
};
let bindings = JSON.parse(localStorage.getItem('controls-' + slug)) || { ...defaultBindings };

const help = document.getElementById('help');
const modal = document.getElementById('controls-modal');
const list = document.getElementById('controls-list');
const btnOpen = document.getElementById('controls-btn');
const btnClose = document.getElementById('controls-close');
let capturing = false;

function codeLabel(code){
  if(code.startsWith('Key')) return code.slice(3);
  if(code.startsWith('Digit')) return code.slice(5);
  const special = { ArrowLeft:'←', ArrowRight:'→', ArrowUp:'↑', ArrowDown:'↓', Space:'Space' };
  return special[code] || code;
}

function updateHelp(){
  help.innerHTML = `Move: <kbd>${codeLabel(bindings.forward)}</kbd><kbd>${codeLabel(bindings.left)}</kbd><kbd>${codeLabel(bindings.back)}</kbd><kbd>${codeLabel(bindings.right)}</kbd> • Jump: <kbd>${codeLabel(bindings.jump)}</kbd> • Reset: <kbd>${codeLabel(bindings.reset)}</kbd>`;
}

function saveBindings(){
  localStorage.setItem('controls-' + slug, JSON.stringify(bindings));
  updateHelp();
}

function buildList(){
  list.innerHTML = '';
  const items = [
    ['forward', 'Forward'],
    ['back', 'Backward'],
    ['left', 'Left'],
    ['right', 'Right'],
    ['jump', 'Jump'],
    ['reset', 'Reset']
  ];
  for(const [action,label] of items){
    const row = document.createElement('div');
    row.className = 'row';
    const span = document.createElement('span');
    span.textContent = label;
    const b = document.createElement('button');
    b.textContent = codeLabel(bindings[action]);
    b.onclick = () => {
      if(capturing) return;
      capturing = true;
      b.textContent = '...';
      const handler = (e) => {
        e.preventDefault();
        bindings[action] = e.code;
        capturing = false;
        saveBindings();
        buildList();
      };
      window.addEventListener('keydown', handler, { once:true });
    };
    row.append(span, b);
    list.appendChild(row);
  }
}

btnOpen.onclick = () => { buildList(); modal.classList.add('show'); };
btnClose.onclick = () => modal.classList.remove('show');

updateHelp();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0f12);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(8, 6, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1, 0);

const hemi = new THREE.HemisphereLight(0xbcc7ff, 0x20242c, 0.6);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(10, 12, 6);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
scene.add(dir);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x2a2f3a })
);
ground.rotation.x = -Math.PI * 0.5;
ground.receiveShadow = true;
scene.add(ground);

const player = new THREE.Mesh(
  new THREE.BoxGeometry(1, 2, 1),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 })
);
player.position.set(0, 1, 0);
player.castShadow = true;
scene.add(player);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 1.5, 1.5),
  new THREE.MeshStandardMaterial({ color: 0x6aa9ff })
);
box.position.set(4, 0.75, -3);
box.castShadow = true;
scene.add(box);

const GRAVITY = -20;
const ACCEL = 28;
const JUMP_SPEED = 8.5;
const MAX_SPEED = 10;

const velocity = new THREE.Vector3();
let onGround = true;
const keys = new Map();
addEventListener('keydown', (e) => {
  if(capturing) return;
  keys.set(e.code, true);
  if(e.code === bindings.reset){
    player.position.set(0,1,0);
    velocity.set(0,0,0);
  }
});
addEventListener('keyup', (e) => { if(!capturing) keys.set(e.code, false); });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function update(dt){
  const ax = (keys.get(bindings.right) ? 1 : 0) - (keys.get(bindings.left) ? 1 : 0);
  const az = (keys.get(bindings.back) ? 1 : 0) - (keys.get(bindings.forward) ? 1 : 0);
  velocity.x += ax * ACCEL * dt;
  velocity.z += az * ACCEL * dt;

  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed > MAX_SPEED){ const s = MAX_SPEED / speed; velocity.x *= s; velocity.z *= s; }

  if (onGround && keys.get(bindings.jump)) { velocity.y = JUMP_SPEED; onGround = false; }
  else { velocity.y += GRAVITY * dt; }

  player.position.addScaledVector(velocity, dt);

  const floorY = 1.0;
  if (player.position.y <= floorY){ player.position.y = floorY; velocity.y = 0; onGround = true; }

  if (onGround){ velocity.x *= 0.88; velocity.z *= 0.88; }

  const idealOffset = new THREE.Vector3(8,6,8).add(player.position);
  camera.position.lerp(idealOffset, 0.08);
  controls.target.lerp(player.position.clone().setY(player.position.y + 0.8), 0.15);
  controls.update();
}

function animate(){
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

scene.add(new THREE.AxesHelper(2.5));
