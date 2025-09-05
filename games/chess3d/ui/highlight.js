import * as THREE from '../lib/three.module.js';

export function initHighlight(scene) {
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  planeGeo.rotateX(-Math.PI / 2);

  const candidateMat = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    opacity: 0.35,
    transparent: true,
    depthWrite: false,
  });
  const blockedMat = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    opacity: 0.35,
    transparent: true,
    depthWrite: false,
  });

  const group = new THREE.Group();
  scene.add(group);
  const meshes = [];

  function add(pos, mat) {
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.position.set(pos.x, 0.01, pos.z);
    group.add(mesh);
    meshes.push(mesh);
  }

  function show({ selected, candidates = [], blocked = [] }) {
    clear();
    if (selected) add(selected, candidateMat);
    candidates.forEach(p => add(p, candidateMat));
    blocked.forEach(p => add(p, blockedMat));
  }

  function clear() {
    while (meshes.length) {
      const m = meshes.pop();
      group.remove(m);
    }
  }

  return { show, clear };
}

