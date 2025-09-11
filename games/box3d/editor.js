import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { PointerLockControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/PointerLockControls.js';

export async function initEditor(levelUrl){
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0f12);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  const controls = new PointerLockControls(camera, renderer.domElement);
  const player = controls.getObject();
  player.position.set(0,1,5);
  scene.add(player);

  const hemi = new THREE.HemisphereLight(0xbcc7ff, 0x20242c, 0.8); scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(10,12,6); dir.castShadow = true; scene.add(dir);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100,100),
    new THREE.MeshStandardMaterial({ color:0x1f2530, side:THREE.DoubleSide })
  );
  ground.rotation.x = -Math.PI * 0.5;
  ground.receiveShadow = true;
  scene.add(ground);

  const platforms = [];
  const collectibles = [];
  let spawn = new THREE.Vector3(0,1,5);
  const spawnMarker = new THREE.Mesh(
    new THREE.ConeGeometry(0.25,1,6),
    new THREE.MeshStandardMaterial({ color:0x00ff00 })
  );
  spawnMarker.position.copy(spawn);
  scene.add(spawnMarker);

  function addPlatform(pos, size=[1.5,1.5,1.5], color=0x6aa9ff){
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color })
    );
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    platforms.push({ mesh, size, color });
  }

  function addCollectible(pos){
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3,16,16),
      new THREE.MeshStandardMaterial({ color:0xffdd00, emissive:0xffaa00, emissiveIntensity:1.5 })
    );
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = true;
    mesh.add(new THREE.PointLight(0xffaa00,1,3));
    scene.add(mesh);
    collectibles.push(mesh);
  }

  function clearLevel(){
    for(const p of platforms){ scene.remove(p.mesh); }
    platforms.length = 0;
    for(const c of collectibles){ scene.remove(c); }
    collectibles.length = 0;
  }

  async function loadLevel(url){
    clearLevel();
    if (!url) return;
    const res = await fetch(url);
    const data = await res.json();
    if(data.spawn){ spawn.fromArray(data.spawn); spawnMarker.position.copy(spawn); }
    for(const p of data.platforms || []) addPlatform(p.position, p.size, p.color);
    for(const c of data.collectibles || []) addCollectible(c.position);
  }
  await loadLevel(levelUrl);

  const toolInfo = document.createElement('div');
  toolInfo.style.position='fixed';
  toolInfo.style.right='12px';
  toolInfo.style.top='12px';
  toolInfo.style.padding='8px 10px';
  toolInfo.style.background='#1b1e24c0';
  toolInfo.style.color='#e6e6e6';
  toolInfo.style.fontFamily='ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  toolInfo.style.fontSize='14px';
  toolInfo.style.borderRadius='10px';
  toolInfo.innerHTML='1: Platform 2: Collectible 3: Spawn';
  document.body.appendChild(toolInfo);

  let tool='platform';
  window.addEventListener('keydown', (e)=>{
    if(e.code==='Digit1') tool='platform';
    else if(e.code==='Digit2') tool='collectible';
    else if(e.code==='Digit3') tool='spawn';
  });

  const ray = new THREE.Raycaster();
  renderer.domElement.addEventListener('click', (e)=>{
    if(!controls.isLocked){ controls.lock(); return; }
    ray.setFromCamera({x:0,y:0}, camera);
    const hit = ray.intersectObject(ground)[0];
    if(!hit) return;
    const p = hit.point;
    if(tool==='platform'){
      addPlatform([p.x, p.y + 0.75, p.z]);
    } else if(tool==='collectible'){
      addCollectible([p.x, p.y + 0.3, p.z]);
    } else if(tool==='spawn'){
      spawn.set(p.x, p.y, p.z);
      spawnMarker.position.copy(spawn);
    }
  });

  document.getElementById('exportBtn')?.addEventListener('click', ()=>{
    const data = {
      spawn: spawn.toArray(),
      platforms: platforms.map(p=>({ position: p.mesh.position.toArray(), size: p.size, color: p.color })),
      collectibles: collectibles.map(c=>({ position: c.position.toArray() }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'level.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('importBtn')?.addEventListener('click', ()=>{
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
      const file = input.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const data = JSON.parse(reader.result);
        clearLevel();
        if(data.spawn){ spawn.fromArray(data.spawn); spawnMarker.position.copy(spawn); }
        for(const p of data.platforms || []) addPlatform(p.position, p.size, p.color);
        for(const c of data.collectibles || []) addCollectible(c.position);
      };
      reader.readAsText(file);
    };
    input.click();
  });

  document.getElementById('levelSelect')?.addEventListener('change', (e)=>{
    loadLevel(e.target.value);
  });

  function animate(){
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  window.addEventListener('resize', ()=>{
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}
