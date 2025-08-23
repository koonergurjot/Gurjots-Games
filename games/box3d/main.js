import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { PointerLockControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/PointerLockControls.js';
import { Sky } from 'https://unpkg.com/three@0.160.0/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'https://unpkg.com/three@0.160.0/examples/jsm/shaders/FXAAShader.js';
import { OutlinePass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/OutlinePass.js';
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

const sky = new Sky();
sky.scale.setScalar(1000);
scene.add(sky);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const controls = new PointerLockControls(camera, document.body);
const player = controls.getObject();
player.position.set(0, 1, 5);
scene.add(player);

document.body.addEventListener('click', () => controls.lock());

const hemi = new THREE.HemisphereLight(0xbcc7ff, 0x20242c, 0.6);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(10, 12, 6);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.bias = -0.0005;
dir.shadow.normalBias = 0.05;
scene.add(dir);
sky.material.uniforms.sunPosition.value.copy(dir.position);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x2a2f3a })
);
ground.rotation.x = -Math.PI * 0.5;
ground.receiveShadow = true;
scene.add(ground);

const TOON_KEY = 'box3d:toon';
let toon = localStorage.getItem(TOON_KEY) === '1';

const playerMatPhys = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 });
const playerMatToon = new THREE.MeshToonMaterial({ color: 0xffffff });
const boxMatPhys = new THREE.MeshPhysicalMaterial({ color: 0x6aa9ff });
const boxMatToon = new THREE.MeshToonMaterial({ color: 0x6aa9ff });

const playerMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), toon ? playerMatToon : playerMatPhys);
playerMesh.castShadow = true;
scene.add(playerMesh);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 1.5, 1.5),
  toon ? boxMatToon : boxMatPhys
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

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.4, 0.85);
composer.addPass(bloom);

const fxaa = new ShaderPass(FXAAShader);
fxaa.material.uniforms.resolution.value.set(1 / window.innerWidth, 1 / window.innerHeight);
composer.addPass(fxaa);

const outline = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
outline.edgeStrength = 4;
outline.visibleEdgeColor.set('#000000');
outline.hiddenEdgeColor.set('#000000');
composer.addPass(outline);

function applyToon() {
  playerMesh.material = toon ? playerMatToon : playerMatPhys;
  box.material = toon ? boxMatToon : boxMatPhys;
  outline.selectedObjects = toon ? [playerMesh, box] : [];
}
applyToon();

const scoreEl = document.getElementById('score');
let score = 0;

const GRAVITY = -20;
const ACCEL = 28;
const JUMP_SPEED = 8.5;
const MAX_SPEED = 10;

const velocity = new THREE.Vector3();
let onGround = true;
const keys = new Map();

addEventListener('keydown', (e) => {
  keys.set(e.code, true);

  if (e.code === 'KeyR') {
    player.position.set(0, 1, 5);
    velocity.set(0, 0, 0);
  }

  if (e.code === 'KeyT') {
    toon = !toon;
    localStorage.setItem(TOON_KEY, toon ? '1' : '0');
    applyToon();
  }
});

addEventListener('keyup', (e) => keys.set(e.code, false));

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
  composer.setSize(innerWidth, innerHeight);
  fxaa.material.uniforms.resolution.value.set(1 / innerWidth, 1 / innerHeight);
  outline.setSize(innerWidth, innerHeight);
});

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const accel = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

const clock = new THREE.Clock();
function update(dt) {
  if (controls.isLocked) {
    const moveX = (keys.get('KeyD') ? 1 : 0) - (keys.get('KeyA') ? 1 : 0);
    const moveZ = (keys.get('KeyS') ? 1 : 0) - (keys.get('KeyW') ? 1 : 0);

    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, up).normalize();

    accel.set(0, 0, 0);
    accel.addScaledVector(forward, moveZ * ACCEL);
    accel.addScaledVector(right, moveX * ACCEL);
    velocity.x += accel.x * dt;
    velocity.z += accel.z * dt;

    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed > MAX_SPEED) {
      const s = MAX_SPEED / speed;
      velocity.x *= s;
      velocity.z *= s;
    }

    if (onGround && keys.get('Space')) { velocity.y = JUMP_SPEED; onGround = false; }
    else { velocity.y += GRAVITY * dt; }

    player.position.addScaledVector(velocity, dt);
    playerMesh.position.copy(player.position);

    const floorY = 1.0;
    if (player.position.y <= floorY) { player.position.y = floorY; velocity.y = 0; onGround = true; }

    if (onGround) { velocity.x *= 0.88; velocity.z *= 0.88; }

    if (pickup && player.position.distanceTo(pickup.position) < 1) {
      score++;
      scoreEl.textContent = score;
      scene.remove(pickup);
      pickup = null;
    }
  }

  if (pickup) { pickup.rotation.y += dt * 2; }
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  composer.render();
  requestAnimationFrame(animate);
}
animate();

scene.add(new THREE.AxesHelper(2.5));

