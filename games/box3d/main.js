import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

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
const HS_KEY = 'highscore:box3d';
let highScore = Number(localStorage.getItem(HS_KEY) || 0);
let pickup = null;
let score = 0;
const scoreEl = document.getElementById('score');
const keys = new Map();
addEventListener('keydown', (e) => keys.set(e.code, true));
addEventListener('keyup', (e) => keys.set(e.code, false));
addEventListener('keydown', (e) => { if (e.code === 'KeyR'){ player.position.set(0,1,0); velocity.set(0,0,0);} });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function update(dt){
  const ax = (keys.get('KeyD') ? 1 : 0) - (keys.get('KeyA') ? 1 : 0);
  const az = (keys.get('KeyS') ? 1 : 0) - (keys.get('KeyW') ? 1 : 0);
  velocity.x += ax * ACCEL * dt;
  velocity.z += az * ACCEL * dt;

  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed > MAX_SPEED){ const s = MAX_SPEED / speed; velocity.x *= s; velocity.z *= s; }

  if (onGround && keys.get('Space')) { velocity.y = JUMP_SPEED; onGround = false; }
  else { velocity.y += GRAVITY * dt; }

  player.position.addScaledVector(velocity, dt);

  const floorY = 1.0;
  if (player.position.y <= floorY){ player.position.y = floorY; velocity.y = 0; onGround = true; }

  if (onGround){ velocity.x *= 0.88; velocity.z *= 0.88; }

  if (pickup && player.position.distanceTo(pickup.position) < 1){
    score++;
    if (scoreEl) scoreEl.textContent = score;
    scene.remove(pickup);
    pickup = null;
  }

  const dist = Math.hypot(player.position.x, player.position.z);
  if (dist > highScore) {
    highScore = dist;
    localStorage.setItem(HS_KEY, Math.floor(highScore));
  }

  const idealOffset = new THREE.Vector3(8,6,8).add(player.position);
  camera.position.lerp(idealOffset, 0.08);
  controls.target.lerp(player.position.clone().setY(player.position.y + 0.8), 0.15);
  controls.update();
}

function animate(){
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  if (pickup){ pickup.rotation.y += dt * 2; }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

scene.add(new THREE.AxesHelper(2.5));
