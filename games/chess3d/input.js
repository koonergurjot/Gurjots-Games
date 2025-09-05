import * as THREE from './lib/three.module.js';
import { squareToPosition, positionToSquare } from './board.js';
import { listPieces, getPieceBySquare, movePiece } from './pieces.js';
import { initHighlight } from './ui/highlight.js';

const FILES = 'abcdefgh';

function squareToCoords(square) {
  return { file: FILES.indexOf(square[0]), rank: parseInt(square[1], 10) - 1 };
}

function coordsToSquare(file, rank) {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return FILES[file] + (rank + 1);
}

function buildOccupancy() {
  const map = new Map();
  for (const p of listPieces()) {
    if (!p.square) continue;
    map.set(p.square, p);
  }
  return map;
}

function computeMoves(piece) {
  const occ = buildOccupancy();
  const moves = { candidates: [], blocked: [] };
  const { file, rank } = squareToCoords(piece.square);

  function addSq(f, r, type = 'candidate') {
    const sq = coordsToSquare(f, r);
    if (!sq) return false;
    const other = occ.get(sq);
    if (!other) {
      if (type === 'candidate') moves.candidates.push(sq);
      return true;
    }
    if (other.color === piece.color) {
      moves.blocked.push(sq);
    } else {
      moves.candidates.push(sq);
    }
    return false;
  }

  function slide(dirs) {
    for (const [df, dr] of dirs) {
      let f = file + df;
      let r = rank + dr;
      while (addSq(f, r)) {
        f += df;
        r += dr;
      }
    }
  }

  switch (piece.type) {
    case 'P': {
      const dir = piece.color === 'w' ? 1 : -1;
      const ahead = coordsToSquare(file, rank + dir);
      if (ahead) {
        const occAhead = occ.get(ahead);
        if (!occAhead) moves.candidates.push(ahead); else moves.blocked.push(ahead);
      }
      const caps = [coordsToSquare(file - 1, rank + dir), coordsToSquare(file + 1, rank + dir)];
      for (const sq of caps) {
        if (!sq) continue;
        const p = occ.get(sq);
        if (p) {
          if (p.color !== piece.color) moves.candidates.push(sq); else moves.blocked.push(sq);
        }
      }
      break;
    }
    case 'R':
      slide([[1,0],[-1,0],[0,1],[0,-1]]);
      break;
    case 'B':
      slide([[1,1],[1,-1],[-1,1],[-1,-1]]);
      break;
    case 'Q':
      slide([[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]);
      break;
    case 'K': {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      for (const [df, dr] of dirs) addSq(file + df, rank + dr);
      break;
    }
    case 'N': {
      const jumps = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
      for (const [df, dr] of jumps) addSq(file + df, rank + dr);
      break;
    }
  }

  return moves;
}

export function initInput({ scene, camera, renderer, controls }) {
  const highlighter = initHighlight(scene);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let selected = null;
  let startSquare = null;
  let dragging = false;
  let currentMoves = { candidates: [], blocked: [] };

  function setPointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function pickPiece(event) {
    setPointer(event);
    const meshes = listPieces().filter(p => p.square).map(p => p.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const mesh = hits[0].object;
    return listPieces().find(p => p.mesh === mesh && p.square);
  }

  function rayToSquare() {
    const pos = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, pos);
    const sq = positionToSquare(pos.x, pos.z);
    return { square: sq, position: pos };
  }

  function highlight(piece) {
    currentMoves = computeMoves(piece);
    const selectedPos = squareToPosition(piece.square);
    const candPos = currentMoves.candidates.map(s => squareToPosition(s));
    const blockedPos = currentMoves.blocked.map(s => squareToPosition(s));
    highlighter.show({ selected: selectedPos, candidates: candPos, blocked: blockedPos });
  }

  function attempt(targetSquare) {
    if (!selected) return;
    if (currentMoves.candidates.includes(targetSquare)) {
      const victim = getPieceBySquare(targetSquare);
      if (victim && victim.color !== selected.color) {
        victim.mesh.parent.remove(victim.mesh);
        victim.square = null;
      }
      movePiece(selected.id, targetSquare, false);
    } else {
      movePiece(selected.id, startSquare, false);
    }
    if (controls) controls.enabled = true;
    highlighter.clear();
    selected = null;
    dragging = false;
  }

  function onPointerDown(event) {
    if (selected && event.pointerType !== 'mouse' && !dragging) {
      setPointer(event);
      const { square } = rayToSquare();
      attempt(square);
      return;
    }
    const piece = pickPiece(event);
    if (piece) {
      selected = piece;
      startSquare = piece.square;
      highlight(piece);
      if (event.pointerType === 'mouse') {
        dragging = true;
        if (controls) controls.enabled = false;
      }
    }
  }

  function onPointerMove(event) {
    if (!dragging || !selected) return;
    setPointer(event);
    const { position } = rayToSquare();
    selected.mesh.position.set(position.x, 0, position.z);
  }

  function onPointerUp(event) {
    if (!selected) return;
    if (dragging) {
      setPointer(event);
      const { square } = rayToSquare();
      attempt(square);
    }
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
}

