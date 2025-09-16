import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module';
import { injectBackButton, recordLastPlayed, saveBestScore } from '../../shared/ui.js';

const GAME_ID = 'box3d';
const shareBtn = document.getElementById('shareBtn');
const scoreEl = document.getElementById('score');
const modeBtn = document.getElementById('modeBtn');
const levelSelect = document.getElementById('levelSelect');
const importBtn = document.getElementById('importBtn');
const exportBtn = document.getElementById('exportBtn');
const shareSupported = typeof navigator !== 'undefined' && 'share' in navigator;

injectBackButton('/');
recordLastPlayed(GAME_ID);
registerServiceWorker();

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let heroCube = null;
let levelGroup = null;
let animationId = 0;
let clock = null;
let elapsedTime = 0;
let isJumping = false;
let heroVelocityY = 0;
const heroHalfHeight = 0.5;
let heroPosition = new THREE.Vector3(0, 1, 0);
let spawnPoint = new THREE.Vector3(0, 1, 0);
let floorY = 0.5;
const keysHeld = new Set();
let collectibleEntries = [];
let platformMeshes = [];
let currentLevelUrl = levelSelect?.value || 'levels/demo.json';
let currentLevelData = null;
let editorSession = null;
let playing = true;
let score = 0;
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let touchCleanup = [];

setupShareButton();
setupUIBindings();
init().catch(err => console.error('Failed to initialise playground', err));

function setupShareButton() {
  if (!shareBtn) return;
  shareBtn.style.display = 'none';
  if (!shareSupported) return;
  shareBtn.addEventListener('click', async () => {
    if (!shareSupported || score <= 0) return;
    try {
      await navigator.share({
        title: '3D Box Playground',
        text: `I collected ${score} orb${score === 1 ? '' : 's'} in the 3D Box Playground!`,
        url: location.href,
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn('Share failed', err);
      }
    }
  });
}

function setupUIBindings() {
  modeBtn?.addEventListener('click', async () => {
    if (playing) await enterEditMode();
    else await exitEditMode();
  });

  levelSelect?.addEventListener('change', async event => {
    const value = event.target.value;
    if (!value) return;
    currentLevelUrl = value;
    if (playing) await loadLevel(value);
    else if (editorSession?.loadLevel) await editorSession.loadLevel(value);
  });

  importBtn?.addEventListener('click', () => {
    if (!playing) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          applyLevelData(data);
          currentLevelUrl = '';
          if (levelSelect) levelSelect.value = '';
        } catch (err) {
          console.error('Invalid level file', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });

  exportBtn?.addEventListener('click', () => {
    if (!playing) return;
    if (!currentLevelData) return;
    const blob = new Blob([JSON.stringify(currentLevelData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'level.json';
    a.click();
    URL.revokeObjectURL(url);
  });
}

async function init() {
  setScore(0);
  initPlayScene();
  if (levelSelect && currentLevelUrl) levelSelect.value = currentLevelUrl;
  await loadLevel(currentLevelUrl);
}

function initPlayScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0f12);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 150);
  camera.position.set(6, 4.5, 9);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.minDistance = 2.2;
  controls.maxDistance = 24;

  const hemi = new THREE.HemisphereLight(0xbcc7ff, 0x20242c, 0.65);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.05);
  dir.position.set(8, 10, 6);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  scene.add(dir);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x141720, roughness: 0.92, metalness: 0.08 })
  );
  floor.rotation.x = -Math.PI * 0.5;
  floor.receiveShadow = true;
  scene.add(floor);

  levelGroup = new THREE.Group();
  scene.add(levelGroup);

  heroCube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x6aa9ff, metalness: 0.55, roughness: 0.35 })
  );
  heroCube.castShadow = true;
  heroCube.receiveShadow = true;
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(heroCube.geometry),
    new THREE.LineBasicMaterial({ color: 0x00faff })
  );
  heroCube.add(outline);
  scene.add(heroCube);

  clock = new THREE.Clock();
  elapsedTime = 0;

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  setupTouchControls();

  onResize();
  animate();
}

function teardownPlayScene() {
  if (!renderer) return;
  cancelAnimationFrame(animationId);
  renderer.domElement.removeEventListener('pointerdown', onPointerDown);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  teardownTouchControls();

  controls?.dispose?.();

  clearLevelMeshes();
  if (heroCube) {
    scene.remove(heroCube);
    disposeObject3D(heroCube);
  }
  if (levelGroup) {
    scene.remove(levelGroup);
    disposeObject3D(levelGroup);
  }
  disposeObject3D(scene);
  renderer.dispose();
  renderer.domElement.remove();

  renderer = null;
  scene = null;
  camera = null;
  controls = null;
  heroCube = null;
  levelGroup = null;
  clock = null;
  elapsedTime = 0;
}

async function loadLevel(url) {
  if (!url || !scene) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Level request failed: ${res.status}`);
    const data = await res.json();
    applyLevelData(data);
    currentLevelUrl = url;
  } catch (err) {
    console.error('Failed to load level', err);
    applyLevelData(null);
  }
}

function applyLevelData(raw) {
  const level = normaliseLevel(raw);
  currentLevelData = JSON.parse(JSON.stringify(level));
  clearLevelMeshes();

  spawnPoint = new THREE.Vector3().fromArray(level.spawn);
  heroPosition = spawnPoint.clone();
  floorY = spawnPoint.y - heroHalfHeight;
  heroVelocityY = 0;
  isJumping = false;

  if (heroCube) {
    heroCube.position.copy(heroPosition);
    heroCube.rotation.set(0, 0, 0);
  }
  if (controls) {
    controls.target.copy(heroPosition);
    controls.update();
  }

  for (const platform of level.platforms) {
    const size = platform.size;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size[0], size[1], size[2]),
      new THREE.MeshStandardMaterial({
        color: platform.color,
        metalness: 0.35,
        roughness: 0.45,
      })
    );
    mesh.position.set(platform.position[0], platform.position[1], platform.position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.platform = true;
    levelGroup?.add(mesh);
    platformMeshes.push(mesh);
  }

  collectibleEntries = [];
  for (const collectible of level.collectibles) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 20, 20),
      new THREE.MeshStandardMaterial({
        color: 0xffdd00,
        emissive: 0xffa000,
        emissiveIntensity: 1.4,
        roughness: 0.3,
      })
    );
    mesh.position.set(collectible.position[0], collectible.position[1], collectible.position[2]);
    mesh.castShadow = true;
    mesh.userData.collectible = true;
    const light = new THREE.PointLight(0xffaa33, 0.85, 6.5);
    mesh.add(light);
    levelGroup?.add(mesh);
    collectibleEntries.push({
      mesh,
      baseY: mesh.position.y,
      bobSpeed: 1 + Math.random() * 0.6,
      bobOffset: Math.random() * Math.PI * 2,
      collected: false,
    });
  }

  setScore(0);
}

function normaliseLevel(raw) {
  const spawn = toVec3(raw?.spawn, [0, 1, 0]);
  const platforms = Array.isArray(raw?.platforms)
    ? raw.platforms.map(entry => ({
        position: toVec3(entry?.position, [0, 0.75, 0]),
        size: toVec3(entry?.size, [1.5, 1.5, 1.5]).map(v => Math.max(0.2, v)),
        color: toColor(entry?.color ?? 0x6aa9ff),
      }))
    : [];
  const collectibles = Array.isArray(raw?.collectibles)
    ? raw.collectibles.map(entry => ({ position: toVec3(entry?.position, [0, 0.3, 0]) }))
    : [];
  return { spawn, platforms, collectibles };
}

function toVec3(value, fallback) {
  if (Array.isArray(value) && value.length === 3) {
    const parsed = value.map(v => Number(v));
    if (parsed.every(n => Number.isFinite(n))) return parsed;
  }
  return [...fallback];
}

function toColor(value) {
  let num = Number(value);
  if (!Number.isFinite(num)) num = 0x6aa9ff;
  num = Math.max(0, Math.floor(num));
  return num % 0x1000000;
}

function clearLevelMeshes() {
  for (const mesh of platformMeshes.splice(0)) {
    levelGroup?.remove(mesh);
    disposeObject3D(mesh);
  }
  for (const entry of collectibleEntries.splice(0)) {
    if (entry.mesh) {
      levelGroup?.remove(entry.mesh);
      disposeObject3D(entry.mesh);
    }
  }
}

function animate() {
  if (!renderer || !camera || !scene) return;
  animationId = requestAnimationFrame(animate);
  const delta = clock ? clock.getDelta() : 0.016;
  elapsedTime += delta;
  updateHero(delta);
  updateCollectibles(delta);
  controls?.update();
  renderer.render(scene, camera);
}

function updateHero(delta) {
  if (!heroCube) return;
  const move = new THREE.Vector3();
  if (keysHeld.has('KeyW')) move.z -= 1;
  if (keysHeld.has('KeyS')) move.z += 1;
  if (keysHeld.has('KeyA')) move.x -= 1;
  if (keysHeld.has('KeyD')) move.x += 1;
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(3.6 * delta);
    heroPosition.add(move);
  }

  heroVelocityY += -18 * delta;
  heroPosition.y += heroVelocityY * delta;
  const minY = floorY + heroHalfHeight;
  if (heroPosition.y < minY) {
    heroPosition.y = minY;
    heroVelocityY = 0;
    isJumping = false;
  }

  heroCube.position.copy(heroPosition);
  heroCube.rotation.x += delta * 0.6;
  heroCube.rotation.y += delta * 0.35;
  if (controls) {
    controls.target.lerp(heroCube.position, 0.18);
  }
}

function updateCollectibles(delta) {
  for (const entry of collectibleEntries) {
    if (!entry.mesh || entry.collected) continue;
    entry.mesh.rotation.y += delta * 1.6;
    entry.mesh.position.y = entry.baseY + Math.sin(elapsedTime * entry.bobSpeed + entry.bobOffset) * 0.15;
    const distance = heroCube ? heroCube.position.distanceTo(entry.mesh.position) : Infinity;
    if (distance < 1 && !entry.collected) {
      collectCollectible(entry);
    }
  }
}

function collectCollectible(entry) {
  if (entry.collected || !entry.mesh) return;
  entry.collected = true;
  const mesh = entry.mesh;
  entry.mesh = null;
  if (mesh.parent) mesh.parent.remove(mesh);
  disposeObject3D(mesh);
  setScore(score + 1);
}

function setScore(value) {
  score = value;
  if (scoreEl) scoreEl.textContent = String(score);
  if (shareBtn) {
    if (shareSupported && score > 0) shareBtn.style.display = 'inline-flex';
    else shareBtn.style.display = 'none';
  }
  saveBestScore(GAME_ID, score);
}

function onPointerDown(event) {
  if (!renderer || !camera || !playing) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects([
    heroCube,
    ...collectibleEntries.map(entry => entry.mesh).filter(Boolean),
  ]);
  if (!intersects.length) return;
  let obj = intersects[0].object;
  while (obj && obj !== heroCube && !obj.userData.collectible) {
    obj = obj.parent;
  }
  if (obj === heroCube) {
    heroVelocityY = Math.max(heroVelocityY, 7.5);
    isJumping = true;
  } else if (obj?.userData.collectible) {
    const entry = collectibleEntries.find(item => item.mesh === obj);
    if (entry) collectCollectible(entry);
  }
}

function onResize() {
  if (!renderer || !camera) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function onKeyDown(event) {
  if (!playing) return;
  const code = event.code;
  if (handleKeyDownCode(code)) event.preventDefault();
}

function onKeyUp(event) {
  if (!playing) return;
  const code = event.code;
  if (handleKeyUpCode(code)) event.preventDefault();
}

function handleKeyDownCode(code) {
  let handled = false;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)) {
    keysHeld.add(code);
    handled = true;
  } else if (code === 'Space') {
    if (!isJumping) {
      heroVelocityY = 7;
      isJumping = true;
    }
    handled = true;
  } else if (code === 'KeyR') {
    resetHero();
    handled = true;
  }
  return handled;
}

function handleKeyUpCode(code) {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)) {
    keysHeld.delete(code);
    return true;
  }
  if (code === 'Space') return true;
  return false;
}

function resetHero() {
  heroPosition.copy(spawnPoint);
  heroVelocityY = 0;
  isJumping = false;
  if (heroCube) heroCube.position.copy(heroPosition);
  if (controls) {
    controls.target.copy(heroPosition);
    controls.update();
  }
  setScore(0);
}

function setupTouchControls() {
  teardownTouchControls();
  const pad = document.getElementById('touch');
  if (!pad) return;
  const buttons = Array.from(pad.querySelectorAll('button[data-k]'));
  for (const btn of buttons) {
    const code = btn.dataset.k;
    if (!code) continue;
    const down = event => {
      event.preventDefault();
      if (!playing) return;
      handleKeyDownCode(code);
    };
    const up = event => {
      event.preventDefault();
      handleKeyUpCode(code);
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
    touchCleanup.push(() => {
      btn.removeEventListener('pointerdown', down);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointerleave', up);
      btn.removeEventListener('pointercancel', up);
    });
  }
}

function teardownTouchControls() {
  for (const fn of touchCleanup.splice(0)) fn();
}

async function enterEditMode() {
  if (!playing) return;
  playing = false;
  if (modeBtn) modeBtn.textContent = 'Play';
  teardownPlayScene();
  let tempUrl = currentLevelUrl;
  let revokeUrl = null;
  if (!tempUrl && currentLevelData) {
    const blob = new Blob([JSON.stringify(currentLevelData, null, 2)], {
      type: 'application/json',
    });
    tempUrl = URL.createObjectURL(blob);
    revokeUrl = tempUrl;
  }
  try {
    const mod = await import('./editor.js');
    editorSession = await mod.initEditor(tempUrl);
  } catch (err) {
    console.error('Failed to start editor', err);
    await exitEditMode();
  } finally {
    if (revokeUrl) URL.revokeObjectURL(revokeUrl);
  }
}

async function exitEditMode() {
  if (playing) return;
  playing = true;
  if (modeBtn) modeBtn.textContent = 'Edit';
  try {
    editorSession?.dispose?.();
  } finally {
    editorSession = null;
  }
  initPlayScene();
  if (currentLevelUrl) await loadLevel(currentLevelUrl);
}

function disposeObject3D(obj) {
  if (!obj) return;
  obj.traverse(child => {
    if (child.geometry) child.geometry.dispose?.();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose?.());
      else child.material.dispose?.();
    }
  });
}

function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('/sw.js')
    .catch(err => console.warn('Service worker registration failed', err));
}
