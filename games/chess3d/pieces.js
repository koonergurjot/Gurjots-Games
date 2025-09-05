import * as THREE from './lib/three.module.js';

const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
const blackMat = new THREE.MeshStandardMaterial({ color: 0x222222 });

function addShadow(mesh, radius = 0.45) {
  const shadowGeo = new THREE.CircleGeometry(radius, 12);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    opacity: 0.15,
    transparent: true,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  mesh.add(shadow);
}

function lathe(points, material) {
  const geo = new THREE.LatheGeometry(points, 12);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

function createPawn(mat) {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.35, 0),
    new THREE.Vector2(0.4, 0.2),
    new THREE.Vector2(0.3, 0.4),
    new THREE.Vector2(0.25, 0.8),
    new THREE.Vector2(0.3, 0.9),
    new THREE.Vector2(0.2, 1.0),
    new THREE.Vector2(0, 1.1),
  ];
  return lathe(pts, mat);
}

function createRook(mat) {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.4, 0),
    new THREE.Vector2(0.4, 0.1),
    new THREE.Vector2(0.3, 0.1),
    new THREE.Vector2(0.3, 0.9),
    new THREE.Vector2(0.4, 0.9),
    new THREE.Vector2(0.4, 1.1),
    new THREE.Vector2(0, 1.1),
  ];
  const base = lathe(pts, mat);
  // crenellations
  const top = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.2, 0.3),
      mat,
    );
    box.position.y = 1.2;
    box.rotation.y = (i * Math.PI) / 2;
    box.position.x = 0.25 * Math.cos((i * Math.PI) / 2);
    box.position.z = 0.25 * Math.sin((i * Math.PI) / 2);
    top.add(box);
  }
  const group = new THREE.Group();
  group.add(base);
  group.add(top);
  return group;
}

function createBishop(mat) {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.35, 0),
    new THREE.Vector2(0.35, 0.1),
    new THREE.Vector2(0.25, 0.1),
    new THREE.Vector2(0.2, 0.8),
    new THREE.Vector2(0.3, 0.95),
    new THREE.Vector2(0.15, 1.3),
    new THREE.Vector2(0, 1.5),
  ];
  const body = lathe(pts, mat);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 8, 8),
    mat,
  );
  head.position.y = 1.55;
  const group = new THREE.Group();
  group.add(body);
  group.add(head);
  return group;
}

function createKnight(mat) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0.5, 0.8);
  shape.lineTo(0.3, 1.0);
  shape.lineTo(0.2, 1.3);
  shape.lineTo(0, 1.3);
  shape.lineTo(0.1, 0.8);
  shape.lineTo(0, 0);
  const extrude = { depth: 0.3, bevelEnabled: false };
  const geo = new THREE.ExtrudeGeometry(shape, extrude);
  geo.translate(-0.25, 0, -0.15);
  return new THREE.Mesh(geo, mat);
}

function createQueen(mat) {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.4, 0),
    new THREE.Vector2(0.4, 0.1),
    new THREE.Vector2(0.3, 0.1),
    new THREE.Vector2(0.25, 0.8),
    new THREE.Vector2(0.45, 0.95),
    new THREE.Vector2(0.3, 1.3),
    new THREE.Vector2(0, 1.4),
  ];
  const body = lathe(pts, mat);
  const crown = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), mat);
    cone.position.y = 1.45;
    cone.position.x = 0.25 * Math.cos((i / 6) * Math.PI * 2);
    cone.position.z = 0.25 * Math.sin((i / 6) * Math.PI * 2);
    cone.rotation.y = (i / 6) * Math.PI * 2;
    crown.add(cone);
  }
  const group = new THREE.Group();
  group.add(body);
  group.add(crown);
  return group;
}

function createKing(mat) {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.45, 0),
    new THREE.Vector2(0.45, 0.1),
    new THREE.Vector2(0.3, 0.1),
    new THREE.Vector2(0.25, 0.8),
    new THREE.Vector2(0.45, 0.95),
    new THREE.Vector2(0.3, 1.4),
    new THREE.Vector2(0.2, 1.5),
    new THREE.Vector2(0, 1.7),
  ];
  const body = lathe(pts, mat);
  const cross = new THREE.Group();
  const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), mat);
  bar1.position.y = 1.85;
  const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), mat);
  bar2.position.y = 1.95;
  cross.add(bar1);
  cross.add(bar2);
  const group = new THREE.Group();
  group.add(body);
  group.add(cross);
  return group;
}

function createPiece({ type, color }) {
  const mat = color === 'w' ? whiteMat : blackMat;
  let mesh;
  switch (type) {
    case 'P':
      mesh = createPawn(mat);
      break;
    case 'R':
      mesh = createRook(mat);
      break;
    case 'N':
      mesh = createKnight(mat);
      break;
    case 'B':
      mesh = createBishop(mat);
      break;
    case 'Q':
      mesh = createQueen(mat);
      break;
    case 'K':
      mesh = createKing(mat);
      break;
    default:
      throw new Error('Unknown piece type: ' + type);
  }
  mesh.traverse?.((c) => {
    if (c.isMesh) c.castShadow = true;
  });
  addShadow(mesh);
  return mesh;
}

const pieces = new Map();
let boardHelpers = null;

export function placeInitialPosition(scene, board) {
  boardHelpers = board;
  const order = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  const files = 'abcdefgh';
  // white pieces
  for (let i = 0; i < 8; i++) {
    const type = order[i];
    const square = files[i] + '1';
    const id = 'w' + type + (i + 1);
    const mesh = createPiece({ type, color: 'w' });
    const { x, z } = board.squareToPosition(square);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    pieces.set(id, { id, type, color: 'w', square, mesh });
    // pawns
    const pSquare = files[i] + '2';
    const pId = 'wP' + (i + 1);
    const pMesh = createPiece({ type: 'P', color: 'w' });
    const pPos = board.squareToPosition(pSquare);
    pMesh.position.set(pPos.x, 0, pPos.z);
    scene.add(pMesh);
    pieces.set(pId, { id: pId, type: 'P', color: 'w', square: pSquare, mesh: pMesh });
  }
  // black pieces
  for (let i = 0; i < 8; i++) {
    const type = order[i];
    const square = files[i] + '8';
    const id = 'b' + type + (i + 1);
    const mesh = createPiece({ type, color: 'b' });
    const { x, z } = board.squareToPosition(square);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    pieces.set(id, { id, type, color: 'b', square, mesh });
    // pawns
    const pSquare = files[i] + '7';
    const pId = 'bP' + (i + 1);
    const pMesh = createPiece({ type: 'P', color: 'b' });
    const pPos = board.squareToPosition(pSquare);
    pMesh.position.set(pPos.x, 0, pPos.z);
    scene.add(pMesh);
    pieces.set(pId, { id: pId, type: 'P', color: 'b', square: pSquare, mesh: pMesh });
  }
}

export function getPieceBySquare(square) {
  for (const p of pieces.values()) {
    if (p.square === square) return p;
  }
  return null;
}

export function movePiece(id, targetSquare, animate = true) {
  const piece = pieces.get(id);
  if (!piece || !boardHelpers) return;
  const pos = boardHelpers.squareToPosition(targetSquare);
  piece.square = targetSquare;
  const mesh = piece.mesh;
  if (animate) {
    const start = mesh.position.clone();
    const end = new THREE.Vector3(pos.x, 0, pos.z);
    const duration = 250;
    const startTime = performance.now();
    function step(now) {
      const t = Math.min((now - startTime) / duration, 1);
      mesh.position.lerpVectors(start, end, t);
      mesh.position.y = Math.sin(Math.PI * t) * 0.5;
      if (t < 1) requestAnimationFrame(step);
      else mesh.position.y = 0;
    }
    requestAnimationFrame(step);
  } else {
    mesh.position.set(pos.x, 0, pos.z);
  }
}

export function listPieces() {
  return Array.from(pieces.values());
}

export function capturePiece(id, animate = true) {
  const piece = pieces.get(id);
  if (!piece) return;
  piece.square = null;
  const mesh = piece.mesh;
  const mats = [];
  mesh.traverse?.((c) => {
    if (c.isMesh) {
      c.material = c.material.clone();
      c.material.transparent = true;
      mats.push(c.material);
    }
  });
  if (animate) {
    const startTime = performance.now();
    const duration = 250;
    function fade(now) {
      const t = Math.min((now - startTime) / duration, 1);
      mesh.scale.setScalar(1 - t);
      mats.forEach(m => m.opacity = 1 - t);
      if (t < 1) requestAnimationFrame(fade);
      else mesh.parent?.remove(mesh);
    }
    requestAnimationFrame(fade);
  } else {
    mesh.parent?.remove(mesh);
  }
}

export function resetPieces(scene) {
  pieces.forEach(p => {
    p.mesh.parent?.remove(p.mesh);
  });
  pieces.clear();
  if (boardHelpers) {
    placeInitialPosition(scene, boardHelpers);
  }
}

export { createPiece };

