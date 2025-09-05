import * as THREE from './lib/three.module.js';
import { squareToPosition, positionToSquare } from './board.js';
import { listPieces, getPieceBySquare, movePiece, capturePiece } from './pieces.js';
import { initHighlight } from './ui/highlight.js';
import { initLastMove } from './ui/lastMove.js';
import {
  init as initRules,
  getLegalMoves,
  move as makeMove,
  turn,
  inCheck,
  inCheckmate,
  inStalemate,
} from './engine/rules.js';

export function initInput({ scene, camera, renderer, controls, onStatus } = {}) {
  const highlighter = initHighlight(scene);
  const lastMove = initLastMove(scene);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let selected = null;
  let startSquare = null;
  let dragging = false;
  let currentMoves = [];
  const statusCb = onStatus;

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
    currentMoves = getLegalMoves(piece.square);
    const selectedPos = squareToPosition(piece.square);
    const candPos = currentMoves.map(s => squareToPosition(s));
    highlighter.show({ selected: selectedPos, candidates: candPos, blocked: [] });
  }

  function attempt(targetSquare) {
    if (!selected) return;
    const result = makeMove({ from: startSquare, to: targetSquare, promotion: 'q' });
    if (result) {
      let captureSquare = targetSquare;
      if (result.flags && result.flags.includes('e')) {
        const dir = selected.color === 'w' ? -1 : 1;
        captureSquare = targetSquare[0] + (parseInt(targetSquare[1], 10) + dir);
      }
      const victim = getPieceBySquare(captureSquare);
      if (victim && victim.color !== selected.color) {
        capturePiece(victim.id);
      }
      movePiece(selected.id, result.to);
      if (result.flags && (result.flags.includes('k') || result.flags.includes('q'))) {
        const rookFrom = result.flags.includes('k')
          ? (selected.color === 'w' ? 'h1' : 'h8')
          : (selected.color === 'w' ? 'a1' : 'a8');
        const rookTo = result.flags.includes('k')
          ? (selected.color === 'w' ? 'f1' : 'f8')
          : (selected.color === 'w' ? 'd1' : 'd8');
        const rook = getPieceBySquare(rookFrom);
        if (rook) movePiece(rook.id, rookTo);
      }
      if (result.promotion) {
        selected.type = result.promotion.toUpperCase();
      }
      lastMove.fromHistory();
      updateStatus();
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
    if (piece && piece.color === turn()) {
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

  function updateStatus() {
    const side = turn() === 'w' ? 'White' : 'Black';
    let text;
    if (inCheckmate()) {
      text = 'Checkmate';
    } else if (inStalemate()) {
      text = 'Stalemate';
    } else {
      text = `${side} to move` + (inCheck() ? ' — Check' : '');
    }
    statusCb?.(text);
  }

  function reset() {
    selected = null;
    startSquare = null;
    dragging = false;
    currentMoves = [];
    highlighter.clear();
    lastMove.clear();
    updateStatus();
  }

  initRules();
  updateStatus();

  return { reset, updateStatus };
}

