import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { PointerLockControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/PointerLockControls.js';
import { Sky } from 'https://unpkg.com/three@0.160.0/examples/jsm/objects/Sky.js';
import { registerSW } from '../../shared/sw.js';
import { injectBackButton } from '../../shared/ui.js';

registerSW();
injectBackButton();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0f12);
scene.fog = new THREE.FogExp2(0x0e0f12, 0.04);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const controls = new PointerLockControls(camera, document.body);
const player = controls.getObject();
player.position.set(0, 1, 5);
scene.add(player);

document.body.addEventListener('click', () => controls.lock());

const hemi = new THREE.HemisphereLight(0xbcc7ff, 0x20242c, 0.8);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(10, 12, 6);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.bias = -0.0005;
dir.shadow.normalBias = 0.05;
scene.add(dir);

const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);
const sun = new THREE.Vector3();
const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 10;
skyUniforms['rayleigh'].value = 2;
skyUniforms['mieCoefficient'].value = 0.005;
skyUniforms['mieDirectionalG'].value = 0.8;
const tod = document.getElementById('tod');
function updateSun(){
  const t = parseFloat(tod.value);
  const phi = THREE.MathUtils.degToRad(90 - t * 180);
  sun.setFromSphericalCoords(1, phi, 0);
  sky.material.uniforms['sunPosition'].value.copy(sun);
  dir.position.copy(sun).multiplyScalar(15);
  scene.fog.density = 0.04 + (1 - sun.y) * 0.008;
}
tod.addEventListener('input', updateSun);
updateSun();

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x1f2530, roughness: 0.95, metalness: 0.05 })
);
ground.rotation.x = -Math.PI * 0.5;
ground.receiveShadow = true;
scene.add(ground);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 1.5, 1.5),
  new THREE.MeshStandardMaterial({ color: 0x6aa9ff })
);
box.position.set(4, 0.75, -3);
box.castShadow = true;
scene.add(box);

let pickup = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 16, 16),
  new THREE.MeshStandardMaterial({ color: 0xffdd00, emissive: 0xffaa00, emissiveIntensity: 1.5 })
);
pickup.position.set(-3, 0.3, 4);
pickup.castShadow = true;
pickup.add(new THREE.PointLight(0xffaa00, 1, 3));
scene.add(pickup);

const scoreEl = document.getElementById('score');
let score = 0;

const GRAVITY = -20;
const ACCEL = 28;
const JUMP_SPEED = 8.5;
const MAX_SPEED = 10;

const velocity = new THREE.Vector3();
let onGround = true;
const keys = new Map();
addEventListener('keydown', (e) => keys.set(e.code, true));
addEventListener('keyup', (e) => keys.set(e.code, false));
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR'){
    player.position.set(0,1,5);
    velocity.set(0,0,0);
  }
});

// Touch buttons map to key presses for mobile play
const touch = document.getElementById('touch');
if (touch) {
  for (const btn of touch.querySelectorAll('button[data-k]')) {
    const code = btn.dataset.k;
    const press = (e) => { e.preventDefault(); keys.set(code, true); };
    const release = (e) => { e.preventDefault(); keys.set(code, false); };
    btn.addEventListener('touchstart', press);
    btn.addEventListener('touchend', release);
    btn.addEventListener('touchcancel', release);
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
});

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const accel = new THREE.Vector3();
const up = new THREE.Vector3(0,1,0);

const clock = new THREE.Clock();
function update(dt){
  if (controls.isLocked){
    const moveX = (keys.get('KeyD') ? 1 : 0) - (keys.get('KeyA') ? 1 : 0);
    const moveZ = (keys.get('KeyS') ? 1 : 0) - (keys.get('KeyW') ? 1 : 0);

    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, up).normalize();

    accel.set(0,0,0);
    accel.addScaledVector(forward, moveZ * ACCEL);
    accel.addScaledVector(right, moveX * ACCEL);
    velocity.x += accel.x * dt;
    velocity.z += accel.z * dt;

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
      scoreEl.textContent = score;
      scene.remove(pickup);
      pickup = null;
    }
  }

  if (pickup){ pickup.rotation.y += dt * 2; }
}

function animate(){
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

scene.add(new THREE.AxesHelper(2.5));

