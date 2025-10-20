import { mergeGeometries } from "./lib/BufferGeometryUtils.js";

let THREERef;
let sceneRef;
let helpersRef;

const instancers = new Map();
const geometryCache = new Map();
const piecesBySquare = new Map();
const animations = [];
const captureAnimations = [];
let currentPieceStyle = "classic";

const COLORS = ["w", "b"];
const MAX_INSTANCES_PER_COLOR = { P: 8, N: 2, B: 2, R: 2, Q: 1, K: 1 };
const PIECE_TYPES = ["P", "N", "B", "R", "Q", "K"];
const BASE_OFFSET = 0.12;

const DEFAULT_MATERIAL_CONFIG = {
  classic: {
    w: { metalness: 0.08, roughness: 0.58 },
    b: { metalness: 0.12, roughness: 0.62 },
  },
  metal: {
    w: { metalness: 0.74, roughness: 0.34 },
    b: { metalness: 0.82, roughness: 0.28 },
  },
  glass: {
    w: { metalness: 0.18, roughness: 0.18 },
    b: { metalness: 0.26, roughness: 0.22 },
  },
};

let materialsConfig = null;
let materialsConfigPromise = null;

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

const instancerKey = (type, color) => `${type}:${color}`;

function clamp01(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return clamp01(fallback, 0.5);
  if (num <= 0) return 0;
  if (num >= 1) return 1;
  return num;
}

function normalizeMaterialConfig(source) {
  const normalized = {};
  const raw = source && typeof source === "object" ? source : {};
  const styles = new Set([
    ...Object.keys(DEFAULT_MATERIAL_CONFIG),
    ...Object.keys(raw),
  ]);
  styles.forEach((style) => {
    const styleSource = raw[style] && typeof raw[style] === "object" ? raw[style] : {};
    const fallbackStyle =
      (DEFAULT_MATERIAL_CONFIG[style] && DEFAULT_MATERIAL_CONFIG[style]) ||
      DEFAULT_MATERIAL_CONFIG.classic;
    normalized[style] = {};
    COLORS.forEach((color) => {
      const preset = styleSource[color] && typeof styleSource[color] === "object"
        ? styleSource[color]
        : null;
      const fallback =
        (fallbackStyle && fallbackStyle[color]) || DEFAULT_MATERIAL_CONFIG.classic[color];
      normalized[style][color] = {
        metalness: clamp01(preset?.metalness, fallback?.metalness ?? 0.5),
        roughness: clamp01(preset?.roughness, fallback?.roughness ?? 0.5),
      };
    });
  });
  return normalized;
}

let normalizedDefaultConfig;
function getDefaultMaterialConfig() {
  if (!normalizedDefaultConfig) {
    normalizedDefaultConfig = normalizeMaterialConfig(DEFAULT_MATERIAL_CONFIG);
  }
  return normalizedDefaultConfig;
}

async function ensureMaterialsLoaded() {
  if (materialsConfig) return materialsConfig;
  if (!materialsConfigPromise) {
    materialsConfigPromise = fetch("/assets/chess3d/materials.json", { cache: "no-store" })
      .then((res) => {
        if (!res || !res.ok) {
          throw new Error(`bad status ${res?.status ?? "unknown"}`);
        }
        return res.json();
      })
      .catch((err) => {
        console?.warn?.("chess3d", "[Pieces] failed to load materials.json", err);
        return getDefaultMaterialConfig();
      })
      .then((data) => {
        try {
          return normalizeMaterialConfig(data);
        } catch (error) {
          console?.warn?.("chess3d", "[Pieces] failed to normalize material config", error);
          return getDefaultMaterialConfig();
        }
      });
  }
  materialsConfig = await materialsConfigPromise;
  return materialsConfig;
}

function getMaterialPreset(style, color) {
  const config = materialsConfig || getDefaultMaterialConfig();
  const styleConfig = config[style] || config.classic || getDefaultMaterialConfig().classic;
  return styleConfig[color] || getDefaultMaterialConfig().classic[color];
}

function applyMaterialPreset(instancer, style) {
  if (!instancer || !instancer.material) return;
  const { color } = instancer;
  const preset = getMaterialPreset(style, color);
  instancer.material.metalness = clamp01(preset?.metalness, instancer.material.metalness);
  instancer.material.roughness = clamp01(preset?.roughness, instancer.material.roughness);
  if (paletteColors[color]) {
    instancer.material.color.copy(paletteColors[color]);
  }
  instancer.material.needsUpdate = true;
}

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
  PIECE_TYPES.forEach((type) => {
    let geometry = geometryCache.get(type);
    if (!geometry) {
      geometry = buildGeometry(type, THREE);
      geometryCache.set(type, geometry);
    }
    COLORS.forEach((color) => {
      const capacity = MAX_INSTANCES_PER_COLOR[type] ?? 1;
      const baseColor = paletteColors[color]?.clone?.() || new THREE.Color(palette.classic[color]);
      const material = new THREE.MeshStandardMaterial({
        color: baseColor,
        metalness: 0.25,
        roughness: 0.6,
      });
      material.envMapIntensity = 0.5;
      material.side = THREE.FrontSide;
      material.shadowSide = THREE.FrontSide;
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.count = 0;
      if (mesh.instanceMatrix?.setUsage) {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      sceneRef.add(mesh);
      instancers.set(instancerKey(type, color), {
        mesh,
        capacity,
        count: 0,
        indexMap: new Map(),
        material,
        color,
        type,
      });
    });
  });
  instancers.forEach((inst) => applyMaterialPreset(inst, currentPieceStyle));
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
  const inst = instancers.get(instancerKey(type, color));
  if (!inst || inst.count >= inst.capacity) return null;
  const index = inst.count;
  inst.count += 1;
  inst.mesh.count = inst.count;
  const piece = { type, color, square, instancer: inst, index };
  inst.indexMap.set(index, piece);
  piecesBySquare.set(square, piece);
  const pos = helpersRef.squareToPosition(square);
  setPieceMatrix(piece, pos);
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
    if (lastPiece) {
      lastPiece.index = piece.index;
      inst.indexMap.set(piece.index, lastPiece);
    }
  }
  inst.indexMap.delete(lastIndex);
  inst.count -= 1;
  inst.mesh.count = inst.count;
  inst.mesh.instanceMatrix.needsUpdate = true;
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
  await ensureMaterialsLoaded();
  ensureInstancers();
  instancers.forEach((inst) => applyMaterialPreset(inst, currentPieceStyle));
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
  instancers.forEach((inst) => applyMaterialPreset(inst, style));
  if (!materialsConfig) {
    ensureMaterialsLoaded()
      .then(() => {
        instancers.forEach((inst) => applyMaterialPreset(inst, currentPieceStyle));
      })
      .catch(() => {});
  }
}

export function getPieceStyle() {
  return currentPieceStyle;
}
