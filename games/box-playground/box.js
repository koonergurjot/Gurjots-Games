const el = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
el.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0a1f);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
camera.position.set(2.4, 1.5, 2.8);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const light = new THREE.DirectionalLight(0xffffff, 1.2);
light.position.set(2,3,2);
scene.add(light);
scene.add(new THREE.AmbientLight(0x7766ff, 0.4));

// Floor
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(12,12),
  new THREE.MeshStandardMaterial({ color: 0x141029, metalness: .2, roughness: .8 })
);
floor.rotation.x = -Math.PI/2;
floor.position.y = -0.75;
scene.add(floor);

// Cube
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1,1,1),
  new THREE.MeshStandardMaterial({ color: 0x8b5cf6, metalness: .5, roughness: .3 })
);
cube.position.y = 0.25;
scene.add(cube);

// Wireframe outline
const line = new THREE.LineSegments(
  new THREE.EdgesGeometry(cube.geometry),
  new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 2 })
);
line.position.copy(cube.position);
scene.add(line);

let spin = true;
document.addEventListener('keydown', e => {
  if (e.code === 'Space') { spin = !spin; }
});

function onResize() {
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

const clock = new THREE.Clock();
function animate() {
  const t = clock.getElapsedTime();
  if (spin) {
    cube.rotation.y = t * 0.8;
    cube.rotation.x = Math.sin(t*0.6)*0.2;
    line.rotation.copy(cube.rotation);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
