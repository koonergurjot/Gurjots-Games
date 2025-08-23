// Minimal 3D game loop using Three.js
// No build tools needed — just serve this folder and open in a browser.
// CDN modules keep this lightweight and easy to start with.

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { Reflector } from 'https://unpkg.com/three@0.160.0/examples/jsm/objects/Reflector.js';

// ----- Renderer -----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// ----- Scene & Camera -----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0f12);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(8, 6, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1, 0);

// ----- Lights -----
const hemi = new THREE.HemisphereLight(0xbcc7ff, 0x20242c, 0.6);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(10, 12, 6);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
dir.shadow.camera.near = 0.5;
dir.shadow.camera.far = 50;
scene.add(dir);

// ----- Ground -----
const groundGeo = new THREE.PlaneGeometry(100, 100);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 1.0, metalness: 0.0 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI * 0.5;
ground.receiveShadow = true;
scene.add(ground);

// ----- Polished Floor Patch -----
const patchGeo = new THREE.CircleGeometry(2, 32);
const patch = new Reflector(patchGeo, {
  color: 0x111111,
  textureWidth: 256,
  textureHeight: 256
});
patch.material.transparent = true;
patch.material.opacity = 0.25;
patch.rotation.x = -Math.PI * 0.5;
patch.position.set(0, 0.002, 0);
scene.add(patch);

// ----- Player (simple physics body) -----
const player = new THREE.Mesh(
  new THREE.BoxGeometry(1, 2, 1),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 })
);
player.position.set(0, 1, 0); // half-height so it sits on the ground at y=0
player.castShadow = true;
scene.add(player);

// Optional: a little visual flair so the scene isn't empty
const box = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 1.5, 1.5),
  new THREE.MeshStandardMaterial({ color: 0x6aa9ff })
);
box.position.set(4, 0.75, -3);
box.castShadow = true;
scene.add(box);

// ----- Particles -----
const PARTICLE_COUNT = 800;
const particleGeo = new THREE.BufferGeometry();
const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
const particleBase = new Float32Array(PARTICLE_COUNT);
const particlePhase = new Float32Array(PARTICLE_COUNT);

for (let i = 0; i < PARTICLE_COUNT; i++) {
  const x = THREE.MathUtils.randFloatSpread(50);
  const y = Math.random() * 6 + 2; // y: 2-8
  const z = THREE.MathUtils.randFloatSpread(50);
  particlePositions[i * 3] = x;
  particlePositions[i * 3 + 1] = y;
  particlePositions[i * 3 + 2] = z;
  particleBase[i] = y;
  particlePhase[i] = Math.random() * Math.PI * 2;
}

particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
particleGeo.setAttribute('baseY', new THREE.BufferAttribute(particleBase, 1));
particleGeo.setAttribute('phase', new THREE.BufferAttribute(particlePhase, 1));

const particleMat = new THREE.PointsMaterial({
  size: 0.04,
  transparent: true,
  blending: THREE.AdditiveBlending,
  sizeAttenuation: true,
  depthWrite: false,
});

const particles = new THREE.Points(particleGeo, particleMat);
particles.frustumCulled = false;
scene.add(particles);

// ----- Simple Physics State -----
const GRAVITY = -20;
const ACCEL = 28;
const JUMP_SPEED = 8.5;
const MAX_SPEED = 10;

const velocity = new THREE.Vector3(0, 0, 0);
let onGround = true;

const keys = new Map();
window.addEventListener('keydown', (e) => keys.set(e.code, true));
window.addEventListener('keyup', (e) => keys.set(e.code, false));

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') {
    player.position.set(0, 1, 0);
    velocity.set(0, 0, 0);
  }
});

// ----- Resize -----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ----- Game Loop -----
const clock = new THREE.Clock();

function update(dt) {
  // Horizontal input (world space)
  const ax = (keys.get('KeyD') ? 1 : 0) - (keys.get('KeyA') ? 1 : 0);
  const az = (keys.get('KeyS') ? 1 : 0) - (keys.get('KeyW') ? 1 : 0);

  // Apply acceleration
  velocity.x += ax * ACCEL * dt;
  velocity.z += az * ACCEL * dt;

  // Clamp horizontal speed
  const horizSpeed = Math.hypot(velocity.x, velocity.z);
  if (horizSpeed > MAX_SPEED) {
    const scale = MAX_SPEED / horizSpeed;
    velocity.x *= scale;
    velocity.z *= scale;
  }

  // Gravity & jumping
  if (onGround && keys.get('Space')) {
    velocity.y = JUMP_SPEED;
    onGround = false;
  } else {
    velocity.y += GRAVITY * dt;
  }

  // Integrate
  player.position.x += velocity.x * dt;
  player.position.y += velocity.y * dt;
  player.position.z += velocity.z * dt;

  // Ground collision at y = 1 (half the player height)
  const floorY = 1.0;
  if (player.position.y <= floorY) {
    player.position.y = floorY;
    velocity.y = 0;
    onGround = true;
  }

  // Basic ground friction
  if (onGround) {
    velocity.x *= 0.88;
    velocity.z *= 0.88;
  }

  // Keep camera focused on the player as a soft follow
  const idealOffset = new THREE.Vector3(8, 6, 8).add(player.position);
  camera.position.lerp(idealOffset, 0.08);
  controls.target.lerp(player.position.clone().setY(player.position.y + 0.8), 0.15);
  controls.update();
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05); // prevent big steps on tab refocus
  update(dt);
  const elapsed = clock.elapsedTime;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particlePositions[i * 3 + 1] =
      particleBase[i] + Math.sin(elapsed * 0.6 + particlePhase[i]) * 0.25;
  }
  particleGeo.attributes.position.needsUpdate = true;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

// ----- DEV: Helpful axes so you know world directions -----
const axes = new THREE.AxesHelper(2.5);
axes.position.set(0, 0.01, 0);
scene.add(axes);

/* 
WHERE TO GO NEXT
- Replace the 'player' box with your own GLTF model (load with GLTFLoader).
- Add a map: build meshes or load a GLTF scene; add colliders or use a physics engine.
- Swap OrbitControls for PointerLockControls for first-person movement.
- Add a UI (score, health) with HTML overlays or a canvas-based HUD.
*/
