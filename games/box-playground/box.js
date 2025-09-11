(async () => {
  const { World, Body } = await import('../box-core/physics.js');
  const { RGBELoader } = await import('https://cdn.jsdelivr.net/npm/three@0.159/examples/jsm/loaders/RGBELoader.js');
  const { EffectComposer } = await import('https://cdn.jsdelivr.net/npm/three@0.159/examples/jsm/postprocessing/EffectComposer.js');
  const { RenderPass } = await import('https://cdn.jsdelivr.net/npm/three@0.159/examples/jsm/postprocessing/RenderPass.js');
  const { UnrealBloomPass } = await import('https://cdn.jsdelivr.net/npm/three@0.159/examples/jsm/postprocessing/UnrealBloomPass.js');
  const { ShaderPass } = await import('https://cdn.jsdelivr.net/npm/three@0.159/examples/jsm/postprocessing/ShaderPass.js');
  const { FXAAShader } = await import('https://cdn.jsdelivr.net/npm/three@0.159/examples/jsm/shaders/FXAAShader.js');

  const el = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f0a1f);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const hdr = await new RGBELoader().loadAsync(
    'https://cdn.jsdelivr.net/npm/three@0.159/examples/textures/equirectangular/venice_sunset_1k.hdr'
  );
  const envMap = pmrem.fromEquirectangular(hdr).texture;
  scene.environment = envMap;
  hdr.dispose();
  pmrem.dispose();

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
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x7766ff, 0.4));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.25,
    0.4,
    0.85
  );
  composer.addPass(bloomPass);
  const fxaaPass = new ShaderPass(FXAAShader);
  fxaaPass.material.uniforms.resolution.value.set(
    1 / window.innerWidth,
    1 / window.innerHeight
  );
  composer.addPass(fxaaPass);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({
      color: 0x141029,
      metalness: 0.2,
      roughness: 0.8,
      envMapIntensity: 1,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.75;
  floor.receiveShadow = true;
  floor.castShadow = false;
  scene.add(floor);

  // physics setup
  const world = new World({ gravity: [0, -9.82, 0] });

  const floorBody = new Body({
    position: [0, -0.75, 0],
    size: [12, 1, 12],
    isStatic: true,
    restitution: 0.2,
  });
  world.addBody(floorBody);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x8b5cf6,
      metalness: 0.5,
      roughness: 0.3,
      envMapIntensity: 1,
    })
  );
  cube.castShadow = true;
  cube.receiveShadow = true;
  scene.add(cube);

  const line = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 2 })
  );
  cube.add(line);

  const cubeBody = new Body({
    position: [0, 2, 0],
    size: [1, 1, 1],
    restitution: 0.5,
  });
  world.addBody(cubeBody);

  const objects = [{ mesh: cube, body: cubeBody }];

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    fxaaPass.material.uniforms.resolution.value.set(
      1 / window.innerWidth,
      1 / window.innerHeight
    );
  }
  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    world.step(dt);

    objects.forEach((o) => {
      o.mesh.position.set(...o.body.position);
    });

    controls.update();
    composer.render();
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
      cubeBody.velocity[1] += 5;
    }
  });
})();
