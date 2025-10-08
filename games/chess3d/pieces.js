import { mergeGeometries } from "./lib/BufferGeometryUtils.js";
import { createToonRampMaterial } from "./materials/toonRampMaterial.js";

let THREERef;
let sceneRef;
let helpersRef;

const instancers = new Map();
const piecesBySquare = new Map();
const animations = [];
const captureAnimations = [];
let currentPieceStyle = "classic";

const MAX_INSTANCES = { P: 16, R: 4, N: 4, B: 4, Q: 2, K: 2 };
const PIECE_TYPES = ["P", "N", "B", "R", "Q", "K"];
const BASE_OFFSET = 0.12;

const tmpMatrix = new (class {
  constructor() {
    this.position = null;
    this.scale = null;
    this.quaternion = null;
    this.matrix = null;
  }
  ensure(THREE) {
    if (!this.position) {
      this.position = new THREE.Vector3();
      this.scale = new THREE.Vector3(1, 1, 1);
      this.quaternion = new THREE.Quaternion();
      this.matrix = new THREE.Matrix4();
    }
    return this;
  }
})();

const palette = {
  classic: { w: 0xe9edf5, b: 0x20232a },
  metal: { w: 0xdfe8ff, b: 0x3c4252 },
  glass: { w: 0xe5ffff, b: 0x1c2b3a },
};

const paletteColors = {
  w: null,
  b: null,
};

function ensurePalette(style) {
  const THREE = THREERef;
  const cfg = palette[style] || palette.classic;
  if (!paletteColors.w) {
    paletteColors.w = new THREE.Color(cfg.w);
    paletteColors.b = new THREE.Color(cfg.b);
  } else {
    paletteColors.w.setHex(cfg.w);
    paletteColors.b.setHex(cfg.b);
  }
}

function buildProfile(type, THREE) {
  const Vec2 = THREE.Vector2;
  if (type === "P") {
    return [
      new Vec2(0, 0),
      new Vec2(0.42, 0),
      new Vec2(0.46, 0.08),
      new Vec2(0.3, 0.18),
      new Vec2(0.26, 0.52),
      new Vec2(0.22, 0.72),
      new Vec2(0.3, 0.86),
      new Vec2(0.24, 0.94),
      new Vec2(0, 1.05),
    ];
  }
  if (type === "R") {
    return [
      new Vec2(0, 0),
      new Vec2(0.46, 0),
      new Vec2(0.5, 0.08),
      new Vec2(0.35, 0.18),
      new Vec2(0.32, 0.68),
      new Vec2(0.48, 0.72),
      new Vec2(0.48, 0.82),
      new Vec2(0.34, 0.86),
      new Vec2(0.34, 0.92),
      new Vec2(0, 0.92),
    ];
  }
  if (type === "N") {
    return [
      new Vec2(0, 0),
      new Vec2(0.42, 0),
      new Vec2(0.46, 0.08),
      new Vec2(0.32, 0.16),
      new Vec2(0.3, 0.42),
      new Vec2(0.26, 0.6),
      new Vec2(0.32, 0.74),
      new Vec2(0.26, 0.88),
      new Vec2(0.18, 0.98),
      new Vec2(0, 1.1),
    ];
  }
  if (type === "B") {
    return [
      new Vec2(0, 0),
      new Vec2(0.42, 0),
      new Vec2(0.46, 0.08),
      new Vec2(0.3, 0.16),
      new Vec2(0.24, 0.64),
      new Vec2(0.18, 0.76),
      new Vec2(0.28, 0.86),
      new Vec2(0.2, 1.02),
      new Vec2(0, 1.12),
    ];
  }
  if (type === "Q") {
    return [
      new Vec2(0, 0),
      new Vec2(0.48, 0),
      new Vec2(0.52, 0.08),
      new Vec2(0.34, 0.2),
      new Vec2(0.28, 0.7),
      new Vec2(0.4, 0.86),
      new Vec2(0.3, 1.02),
      new Vec2(0.22, 1.12),
      new Vec2(0, 1.22),
    ];
  }
  // King
  return [
    new Vec2(0, 0),
    new Vec2(0.5, 0),
    new Vec2(0.54, 0.08),
    new Vec2(0.34, 0.2),
    new Vec2(0.3, 0.74),
    new Vec2(0.4, 0.9),
    new Vec2(0.24, 1.06),
    new Vec2(0.24, 1.16),
    new Vec2(0, 1.28),
  ];
}

function buildGeometry(type, THREE) {
  const profile = buildProfile(type, THREE);
  const lathe = new THREE.LatheGeometry(profile, 36);
  lathe.computeVertexNormals();
  const bevel = new THREE.CylinderGeometry(profile[1].x, profile[1].x, 0.04, 32);
  bevel.translate(0, 0.02, 0);
  const merged = mergeGeometries([bevel, lathe]);
  merged.computeVertexNormals();
  merged.translate(0, BASE_OFFSET, 0);
  merged.computeBoundingBox();
  try { merged.computeBoundingSphere(); } catch (_) {}
  return merged;
}

function ensureInstancers() {
  if (!THREERef || !sceneRef) return;
  if (instancers.size) return;
  ensurePalette(currentPieceStyle);
  const THREE = THREERef;
  const material = createToonRampMaterial(THREE, {
    vertexColors: true,
    bandCount: 4,
    ambient: 0.32,
    specIntensity: 0.2,
    shininess: 56,
    fillIntensity: 0.12,
  });
  PIECE_TYPES.forEach((type) => {
    const geometry = buildGeometry(type, THREE);
    const capacity = MAX_INSTANCES[type];
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    if (mesh.instanceMatrix?.setUsage) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    sceneRef.add(mesh);
    instancers.set(type, {
      mesh,
      capacity,
      count: 0,
      indexMap: new Map(),
    });
  });
}

function applyPieceColor(piece) {
  const { mesh } = piece.instancer;
  const color = piece.color === "w" ? paletteColors.w : paletteColors.b;
  mesh.setColorAt(piece.index, color);
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function setPieceMatrix(piece, position, options = {}) {
  const { lift = 0, scale = 1 } = options;
  const THREE = THREERef;
  const state = tmpMatrix.ensure(THREE);
  state.position.set(position.x, position.y + lift, position.z);
  state.scale.set(scale, scale, scale);
  state.matrix.compose(state.position, state.quaternion, state.scale);
  piece.instancer.mesh.setMatrixAt(piece.index, state.matrix);
  piece.instancer.mesh.instanceMatrix.needsUpdate = true;
}

function spawnPiece(type, color, square) {
  const inst = instancers.get(type);
  if (!inst || inst.count >= inst.capacity) return null;
  const index = inst.count;
  inst.count += 1;
  inst.mesh.count = inst.count;
  const piece = { type, color, square, instancer: inst, index };
  inst.indexMap.set(index, piece);
  piecesBySquare.set(square, piece);
  const pos = helpersRef.squareToPosition(square);
  setPieceMatrix(piece, pos);
  applyPieceColor(piece);
  return piece;
}

function releasePiece(piece) {
  const inst = piece.instancer;
  const lastIndex = inst.count - 1;
  if (lastIndex < 0) return;
  if (piece.index !== lastIndex) {
    const lastPiece = inst.indexMap.get(lastIndex);
    const matrix = new THREERef.Matrix4();
    inst.mesh.getMatrixAt(lastIndex, matrix);
    inst.mesh.setMatrixAt(piece.index, matrix);
    const color = new THREERef.Color();
    inst.mesh.getColorAt(lastIndex, color);
    inst.mesh.setColorAt(piece.index, color);
    if (lastPiece) {
      lastPiece.index = piece.index;
      inst.indexMap.set(piece.index, lastPiece);
    }
  }
  inst.indexMap.delete(lastIndex);
  inst.count -= 1;
  inst.mesh.count = inst.count;
  inst.mesh.instanceMatrix.needsUpdate = true;
  if (inst.mesh.instanceColor) inst.mesh.instanceColor.needsUpdate = true;
}

function clearBoard() {
  piecesBySquare.clear();
  animations.length = 0;
  captureAnimations.length = 0;
  instancers.forEach((inst) => {
    inst.count = 0;
    inst.mesh.count = 0;
    inst.indexMap.clear();
  });
}

export async function createPieces(scene, THREE, helpers) {
  THREERef = THREE;
  sceneRef = scene;
  helpersRef = helpers;
  ensureInstancers();
}

export function applySnapshot(pieces = []) {
  clearBoard();
  ensurePalette(currentPieceStyle);
  pieces.forEach((piece) => {
    spawnPiece(piece.type, piece.color, piece.square);
  });
}

function startCapture(square) {
  const target = piecesBySquare.get(square);
  if (!target) return;
  piecesBySquare.delete(square);
  captureAnimations.push({
    piece: target,
    start: performance.now(),
    duration: 220,
    origin: helpersRef.squareToPosition(square),
  });
}

function handlePromotion(piece, promotion) {
  if (!promotion || !piece) return;
  const square = piece.square;
  releasePiece(piece);
  const promoted = spawnPiece(promotion, piece.color, square);
  if (promoted) {
    piecesBySquare.set(square, promoted);
  }
}

export function animateMove(detail) {
  if (!detail) return;
  const mover = piecesBySquare.get(detail.from);
  if (!mover) return;
  const startPos = helpersRef.squareToPosition(detail.from);
  const endPos = helpersRef.squareToPosition(detail.to);

  const isEnPassant = detail.flags?.includes("e");
  if (detail.captured) {
    const captureSquare = isEnPassant
      ? `${detail.to[0]}${Number.parseInt(detail.to[1], 10) + (detail.color === "w" ? -1 : 1)}`
      : detail.to;
    startCapture(captureSquare);
  }

  piecesBySquare.delete(detail.from);
  piecesBySquare.set(detail.to, mover);
  mover.square = detail.to;

  animations.push({
    piece: mover,
    start: startPos,
    end: endPos,
    startTime: performance.now(),
    duration: 260,
    lift: 0.3,
    promotion: detail.promotion || null,
  });

  if (detail.flags?.includes("k") || detail.flags?.includes("q")) {
    const rookRank = detail.color === "w" ? "1" : "8";
    const rookFrom = detail.flags.includes("k") ? `h${rookRank}` : `a${rookRank}`;
    const rookTo = detail.flags.includes("k") ? `f${rookRank}` : `d${rookRank}`;
    const rook = piecesBySquare.get(rookFrom);
    if (rook) {
      piecesBySquare.delete(rookFrom);
      piecesBySquare.set(rookTo, rook);
      rook.square = rookTo;
      animations.push({
        piece: rook,
        start: helpersRef.squareToPosition(rookFrom),
        end: helpersRef.squareToPosition(rookTo),
        startTime: performance.now(),
        duration: 220,
        lift: 0.12,
      });
    }
  }
}

export function update(time) {
  if (!THREERef) return;
  const now = typeof time === "number" ? time : performance.now();
  for (let i = animations.length - 1; i >= 0; i -= 1) {
    const anim = animations[i];
    const t = Math.min(1, (now - anim.startTime) / anim.duration);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const pos = {
      x: anim.start.x + (anim.end.x - anim.start.x) * ease,
      y: anim.start.y + (anim.end.y - anim.start.y) * ease,
      z: anim.start.z + (anim.end.z - anim.start.z) * ease,
    };
    const lift = Math.sin(t * Math.PI) * (anim.lift || 0);
    setPieceMatrix(anim.piece, pos, { lift });
    if (t >= 1) {
      if (anim.promotion) {
        handlePromotion(anim.piece, anim.promotion);
      }
      animations.splice(i, 1);
    }
  }

  for (let i = captureAnimations.length - 1; i >= 0; i -= 1) {
    const anim = captureAnimations[i];
    const t = Math.min(1, (now - anim.start) / anim.duration);
    const scale = 1 - t;
    setPieceMatrix(anim.piece, anim.origin, { scale: Math.max(0.001, scale) });
    if (t >= 1) {
      releasePiece(anim.piece);
      captureAnimations.splice(i, 1);
    }
  }
}

export function setPieceStyle(style) {
  currentPieceStyle = style;
  ensurePalette(style);
  instancers.forEach((inst) => {
    inst.indexMap.forEach((piece) => applyPieceColor(piece));
  });
}

export function getPieceStyle() {
  return currentPieceStyle;
}
