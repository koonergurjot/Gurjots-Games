import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { PointerLockControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/PointerLockControls.js';
import { EffectComposer } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'https://unpkg.com/three@0.160.0/examples/jsm/shaders/FXAAShader.js';
import { SSAOPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/SSAOPass.js';
import { registerSW } from '../../shared/sw.js';
import { injectBackButton, recordLastPlayed, shareScore } from '../../shared/ui.js';
import { emitEvent } from '../../shared/achievements.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'play';
const levelUrl = params.get('level') || 'levels/demo.json';

const levelSelect = document.getElementById('levelSelect');
if (levelSelect) levelSelect.value = levelUrl;
const modeBtn = document.getElementById('modeBtn');
if (modeBtn) {
  modeBtn.textContent = mode === 'editor' ? 'Play' : 'Edit';
  modeBtn.onclick = () => {
    params.set('mode', mode === 'editor' ? 'play' : 'editor');
    params.set('level', levelSelect ? levelSelect.value : levelUrl);
    location.search = '?' + params.toString();
  };
}

if (mode === 'editor') {
  import('./editor.js').then((m) => m.initEditor(levelUrl));
  // Editor handles the rest
  document.getElementById('score').parentElement.style.display = 'none';
  document.getElementById('shareBtn').style.display = 'none';
  registerSW();
  injectBackButton();
  recordLastPlayed('box3d');
  emitEvent({ type: 'play', slug: 'box3d' });
  // Show import/export controls in editor
  return;
}

document.getElementById('importBtn')?.style.setProperty('display', 'none');
document.getElementById('exportBtn')?.style.setProperty('display', 'none');

registerSW();
injectBackButton();
recordLastPlayed('box3d');
emitEvent({ type: 'play', slug: 'box3d' });

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
const skybox = new THREE.CubeTextureLoader().load([
  'https://threejs.org/examples/textures/cube/skyboxsun25deg/px.jpg',
  'https://threejs.org/examples/textures/cube/skyboxsun25deg/nx.jpg',
  'https://threejs.org/examples/textures/cube/skyboxsun25deg/py.jpg',
  'https://threejs.org/examples/textures/cube/skyboxsun25deg/ny.jpg',
  'https://threejs.org/examples/textures/cube/skyboxsun25deg/pz.jpg',
  'https://threejs.org/examples/textures/cube/skyboxsun25deg/nz.jpg',
]);
scene.background = skybox;
scene.fog = new THREE.FogExp2(0x0e0f12, 0.04);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const controls = new PointerLockControls(camera, document.body);
const player = controls.getObject();
player.position.set(0, 1, 5);
scene.add(player);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
ssaoPass.kernelRadius = 16;
composer.addPass(ssaoPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.3,
  0.4,
  0.85
);
composer.addPass(bloomPass);

const fxaaPass = new ShaderPass(FXAAShader);
fxaaPass.material.uniforms['resolution'].value.set(
  1 / window.innerWidth,
  1 / window.innerHeight
);
composer.addPass(fxaaPass);

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



const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x1f2530, roughness: 0.95, metalness: 0.05 })
);
ground.rotation.x = -Math.PI * 0.5;
ground.receiveShadow = true;
scene.add(ground);

const platforms = [];
const collectibles = [];
let spawnPoint = new THREE.Vector3(0, 1, 5);

async function loadLevel(url) {
  for (const p of platforms) scene.remove(p);
  platforms.length = 0;
  for (const c of collectibles) scene.remove(c);
  collectibles.length = 0;
  const res = await fetch(url);
  const data = await res.json();
  if (data.spawn) {
    spawnPoint.fromArray(data.spawn);
    player.position.copy(spawnPoint);
  }
  for (const p of data.platforms || []) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...p.size),
      new THREE.MeshStandardMaterial({ color: p.color || 0x6aa9ff })
    );
    mesh.position.set(...p.position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    platforms.push(mesh);
  }
  for (const c of data.collectibles || []) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffdd00, emissive: 0xffaa00, emissiveIntensity: 1.5 })
    );
    mesh.position.set(...c.position);
    mesh.castShadow = true;
    mesh.add(new THREE.PointLight(0xffaa00, 1, 3));
    scene.add(mesh);
    collectibles.push(mesh);
  }
}

loadLevel(levelUrl);

levelSelect?.addEventListener('change', () => {
  params.set('level', levelSelect.value);
  loadLevel(levelSelect.value);
  history.replaceState(null, '', '?' + params.toString());
});

const scoreEl = document.getElementById('score');
let score = 0;
const shareBtn = document.getElementById('shareBtn');

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
    player.position.copy(spawnPoint);
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
  composer.setSize(innerWidth, innerHeight);
  ssaoPass.setSize(innerWidth, innerHeight);
  fxaaPass.material.uniforms['resolution'].value.set(
    1 / innerWidth,
    1 / innerHeight
  );
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

    for (let i = collectibles.length - 1; i >= 0; i--) {
      const c = collectibles[i];
      if (player.position.distanceTo(c.position) < 1) {
        score++;
        scoreEl.textContent = score;
        shareBtn.style.display = 'inline-block';
        shareBtn.onclick = () => shareScore('box3d', score);
        scene.remove(c);
        collectibles.splice(i, 1);
      }
    }
  }

  for (const c of collectibles) {
    c.rotation.y += dt * 2;
    const s = 1 + Math.sin(clock.elapsedTime * 5) * 0.25;
    c.scale.setScalar(s);
  }
}

function animate(){
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  composer.render();
  requestAnimationFrame(animate);
}
animate();

scene.add(new THREE.AxesHelper(2.5));

