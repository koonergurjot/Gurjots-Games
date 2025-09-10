(async () => {
  const CANNON = await import('https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js');

  const el = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f0a1f);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(2.4, 1.5, 2.8);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(2, 3, 2);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x7766ff, 0.4));

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({
      color: 0x141029,
      metalness: 0.2,
      roughness: 0.8,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.75;
  scene.add(floor);

  // physics setup
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });

  const floorBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  floorBody.position.set(0, -0.75, 0);
  world.addBody(floorBody);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x8b5cf6,
      metalness: 0.5,
      roughness: 0.3,
    })
  );
  scene.add(cube);

  const line = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 2 })
  );
  cube.add(line);

  const cubeBody = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
    position: new CANNON.Vec3(0, 2, 0),
    angularDamping: 0.2,
    linearDamping: 0.1,
  });
  world.addBody(cubeBody);

  const objects = [{ mesh: cube, body: cubeBody }];

  let spin = true;
  cubeBody.angularVelocity.set(0, 1, 0);

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      spin = !spin;
      cubeBody.angularVelocity.set(0, spin ? 1 : 0, 0);
    }
  });

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    world.step(1 / 60, dt);

    objects.forEach((o) => {
      o.mesh.position.copy(o.body.position);
      o.mesh.quaternion.copy(o.body.quaternion);
    });

    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // game utils
  const GAME_ID = 'box3d';
  GG.incPlays();
  let clickCount = 0;
  function rewardClick() {
    clickCount++;
    if (clickCount % 5 === 0) {
      GG.addXP(2);
      GG.addAch(GAME_ID, 'Explorer');
      SFX.seq([
        [900, 0.05],
        [1200, 0.06],
      ]);
    }
    GG.setMeta(GAME_ID, 'Clicks: ' + clickCount);
  }

  let mode = 1;
  function setMode(m) {
    mode = m;
    if (m === 1) cube.material.color.set(0x8b5cf6);
    if (m === 2) cube.material.color.set(0x22d3ee);
    if (m === 3) cube.material.color.set(0xff7ab1);
    if (m === 4) cube.material.color.set(0xffffff);

    cubeBody.applyImpulse(
      new CANNON.Vec3((Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2),
      cubeBody.position
    );
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === '1') setMode(1);
    if (e.key === '2') setMode(2);
    if (e.key === '3') setMode(3);
    if (e.key === '4') setMode(4);

    if (e.key.toLowerCase() === 's') {
      const radius = 0.3;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 16),
        new THREE.MeshStandardMaterial({ color: 0x22d3ee })
      );
      scene.add(mesh);

      const body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Sphere(radius),
        position: new CANNON.Vec3(
          (Math.random() - 0.5) * 2,
          2,
          (Math.random() - 0.5) * 2
        ),
      });
      world.addBody(body);
      objects.push({ mesh, body });
    }

    if (e.key.toLowerCase() === 'c') {
      const radius = 0.3;
      const height = 0.6;
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(radius, height, 24),
        new THREE.MeshStandardMaterial({ color: 0x8b5cf6 })
      );
      scene.add(mesh);

      const body = new CANNON.Body({ mass: 1 });
      const shape = new CANNON.Cylinder(0, radius, height, 16);
      const q = new CANNON.Quaternion();
      q.setFromEuler(Math.PI / 2, 0, 0);
      body.addShape(shape, new CANNON.Vec3(), q);
      body.position.set(
        (Math.random() - 0.5) * 2,
        2,
        (Math.random() - 0.5) * 2
      );
      world.addBody(body);
      objects.push({ mesh, body });
    }
  });

  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  renderer.domElement.addEventListener('click', (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects([cube]);
    if (hits.length) {
      rewardClick();
      cubeBody.applyImpulse(new CANNON.Vec3(0, 5, 0), cubeBody.position);
    }
  });
})();
