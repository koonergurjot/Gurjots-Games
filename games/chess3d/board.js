import { createToonRampMaterial, updateToonRampMaterial } from "./materials/toonRampMaterial.js";

/**
 * Creates an 8x8 board at y=0. Provides helpers to map algebraic squares to positions.
 */

let tiles = [];
let rim;
let THREERef;
let materials = { light: null, dark: null, rim: null };

export async function createBoard(scene, THREE){
  THREERef = THREE;
  tiles = [];
  const group = new THREE.Group();
  const tileSize = 1;
  const half = 4 * tileSize;

  materials.light = createToonRampMaterial(THREE, {
    baseColor: 0xffffff,
    bandCount: 3,
    ambient: 0.28,
    specIntensity: 0.12,
    shininess: 40,
  });
  materials.dark = createToonRampMaterial(THREE, {
    baseColor: 0xffffff,
    bandCount: 3,
    ambient: 0.28,
    specIntensity: 0.12,
    shininess: 40,
  });

  const geom = new THREE.BoxGeometry(tileSize, 0.1, tileSize);
  for (let r=0;r<8;r++){
    for (let f=0;f<8;f++){
      const isLight = (r+f)%2===0;
      const mesh = new THREE.Mesh(geom, isLight ? materials.light : materials.dark);
      mesh.receiveShadow = true;
      mesh.position.set(-half + f*tileSize + tileSize/2, 0, -half + r*tileSize + tileSize/2);
      mesh.userData.square = fileRankToSquare(f, r);
      mesh.userData.isLight = isLight;
      tiles.push(mesh);
      group.add(mesh);
    }
  }

  // simple rim
  const rimGeom = new THREE.BoxGeometry(8*tileSize+0.6, 0.12, 8*tileSize+0.6);
  materials.rim = createToonRampMaterial(THREE, {
    baseColor: 0x2b3140,
    bandCount: 4,
    ambient: 0.3,
    specIntensity: 0.1,
    shininess: 48,
  });
  rim = new THREE.Mesh(rimGeom, materials.rim);
  rim.position.y = -0.07;
  rim.receiveShadow = true;
  group.add(rim);

  scene.add(group);
  try{
    group.traverse((ch)=>{ if (ch.isMesh){ ch.castShadow = !!ch.castShadow; ch.receiveShadow = true; }});
  }catch(_){ }

  setBoardTheme("wood");

  const helpers = {
    tileSize,
    squareToPosition(square){
      const {f,r} = squareToFileRank(square);
      const x = -half + f*tileSize + tileSize/2;
      const z = -half + r*tileSize + tileSize/2;
      return {x, y: 0.1, z};
    },
    positionToSquare(x, z){
      const f = Math.floor((x + half) / tileSize);
      const r = Math.floor((z + half) / tileSize);
      if (f<0||f>7||r<0||r>7) return null;
      return fileRankToSquare(f, r);
    }
  };
  return helpers;
}

export function setBoardTheme(theme){
  if (!THREERef || !materials.light || !materials.dark) return;
  const themes = {
    wood: {
      light: 0xdab893,
      dark: 0x8b5a2b,
      rim: 0x5a3a22,
      ambient: 0.26,
      bandCount: 3,
      specIntensity: 0.15,
      shininess: 44,
    },
    marble: {
      light: 0xf2f5ff,
      dark: 0x9aa3c1,
      rim: 0x657098,
      ambient: 0.3,
      bandCount: 4,
      specIntensity: 0.18,
      shininess: 54,
    },
    neon: {
      light: 0x00ffcc,
      dark: 0x003366,
      rim: 0x000000,
      ambient: 0.22,
      bandCount: 3,
      specIntensity: 0.22,
      shininess: 60,
    },
  };
  const cfg = themes[theme] || themes.wood;
  const apply = (material, colorHex) => {
    updateToonRampMaterial(material, {
      baseColor: colorHex,
      ambient: cfg.ambient,
      bandCount: cfg.bandCount,
      specIntensity: cfg.specIntensity,
      shininess: cfg.shininess,
    });
  };

  apply(materials.light, cfg.light);
  apply(materials.dark, cfg.dark);

  if (materials.rim) {
    updateToonRampMaterial(materials.rim, {
      baseColor: cfg.rim,
      ambient: Math.min(cfg.ambient + 0.05, 0.45),
      bandCount: Math.max(2, cfg.bandCount - 1),
      specIntensity: cfg.specIntensity * 0.6,
      shininess: cfg.shininess + 6,
    });
  }
}

function squareToFileRank(square){
  const file = square.charCodeAt(0) - 97; // a=0
  const rank = parseInt(square[1], 10) - 1; // 1=0
  return { f:file, r:rank };
}

function fileRankToSquare(f,r){
  return String.fromCharCode(97+f) + (r+1);
}
