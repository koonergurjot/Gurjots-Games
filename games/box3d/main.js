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

const enemies = [];
const enemyGeo = new THREE.BoxGeometry(1,1,1);
const enemyMat = new THREE.MeshStandardMaterial({ color: 0xff5555 });
for (let i = 0; i < 3; i++) {
  const e = new THREE.Mesh(enemyGeo, enemyMat);
  e.castShadow = true;
  e.position.set(Math.random()*20-10, 0.5, Math.random()*20-10);
  scene.add(e);
  enemies.push(e);
}

const GRAVITY = -20;
const ACCEL = 28;
const JUMP_SPEED = 8.5;
const MAX_SPEED = 10;

const ENEMY_SPEED = 2;
let health = 3;
let invincibleTime = 0;
let gameOver = false;

const healthEl = document.getElementById('health');
const gameOverEl = document.getElementById('gameOver');
const restartBtn = document.getElementById('restart');
restartBtn.addEventListener('click', restart);

function restart(){
  health = 3;
  healthEl.textContent = `Health: ${health}`;
  player.position.set(0,1,0);
  velocity.set(0,0,0);
  invincibleTime = 0;
  gameOver = false;
  gameOverEl.style.display = 'none';
  enemies.forEach(e => e.position.set(Math.random()*20-10, 0.5, Math.random()*20-10));
}

const velocity = new THREE.Vector3();
let onGround = true;
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
  if (gameOver) return;
  if (invincibleTime > 0) invincibleTime -= dt;
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

  enemies.forEach(enemy => {
    const dir = player.position.clone().sub(enemy.position);
    dir.y = 0;
    const dist = dir.length();
    if (dist > 0.1){
      const moveDir = dir.normalize();
      enemy.position.addScaledVector(moveDir, ENEMY_SPEED * dt);
      enemy.position.y = 0.5;
      if (dist < 1.4 && invincibleTime <= 0){
        health -= 1;
        healthEl.textContent = `Health: ${health}`;
        invincibleTime = 1.0;
        velocity.addScaledVector(moveDir, 6);
        velocity.y = 3;
        onGround = false;
        if (health <= 0){
          gameOver = true;
          gameOverEl.style.display = 'flex';
        }
      }
    }
  });

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
