import * as THREE from './lib/three.module.js';

const FILES = 'abcdefgh';

function indexToPosition(file, rank) {
  return { x: -3.5 + file, z: 3.5 - rank };
}

export function squareToPosition(square) {
  const file = FILES.indexOf(square[0].toLowerCase());
  const rank = parseInt(square[1], 10) - 1;
  if (file < 0 || rank < 0 || file > 7 || rank > 7) return null;
  return indexToPosition(file, rank);
}

export function positionToSquare(x, z) {
  const file = Math.round(x + 3.5);
  const rank = Math.round(3.5 - z);
  if (file < 0 || rank < 0 || file > 7 || rank > 7) return null;
  return FILES[file] + (rank + 1);
}

export function createBoard(scene) {
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xf0d9b5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0xb58863 });
  const squareGeo = new THREE.BoxGeometry(1, 0.1, 1);
  squareGeo.translate(0, -0.05, 0);

  const lightMesh = new THREE.InstancedMesh(squareGeo, lightMat, 32);
  const darkMesh = new THREE.InstancedMesh(squareGeo, darkMat, 32);
  lightMesh.receiveShadow = true;
  darkMesh.receiveShadow = true;

  const mat = new THREE.Matrix4();
  let li = 0;
  let di = 0;
  for (let file = 0; file < 8; file++) {
    for (let rank = 0; rank < 8; rank++) {
      const { x, z } = indexToPosition(file, rank);
      mat.makeTranslation(x, 0, z);
      if ((file + rank) % 2 === 0) {
        lightMesh.setMatrixAt(li++, mat);
      } else {
        darkMesh.setMatrixAt(di++, mat);
      }
    }
  }
  lightMesh.instanceMatrix.needsUpdate = true;
  darkMesh.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.add(lightMesh);
  group.add(darkMesh);

  // Frame
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-4.5, -4.5);
  frameShape.lineTo(4.5, -4.5);
  frameShape.lineTo(4.5, 4.5);
  frameShape.lineTo(-4.5, 4.5);
  frameShape.lineTo(-4.5, -4.5);
  const hole = new THREE.Path();
  hole.moveTo(-4, -4);
  hole.lineTo(4, -4);
  hole.lineTo(4, 4);
  hole.lineTo(-4, 4);
  hole.lineTo(-4, -4);
  frameShape.holes.push(hole);
  const extrude = {
    depth: 0.2,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.05,
    bevelThickness: 0.05,
  };
  const frameGeo = new THREE.ExtrudeGeometry(frameShape, extrude);
  frameGeo.rotateX(-Math.PI / 2);
  frameGeo.translate(0, -0.1, 0);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.receiveShadow = true;
  group.add(frameMesh);

  scene.add(group);
  return group;
}
