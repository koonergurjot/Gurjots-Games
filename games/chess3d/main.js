console.log('[Chess3D] booting');

const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');

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

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

boot();
