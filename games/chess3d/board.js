
/**
 * Creates an 8x8 board at y=0. Provides helpers to map algebraic squares to positions.
 */

let tiles = [];
let rim;
let THREERef;
let materials = { light: null, dark: null, rim: null };
let texturesPromise;
let loadedTextures;

const TEXTURE_PATHS = {
  wood: {
    light: new URL("../../assets/sprites/chess3d/wood_light.png", import.meta.url).href,
    dark: new URL("../../assets/sprites/chess3d/wood_dark.png", import.meta.url).href,
  },
  marble: {
    light: new URL("../../assets/sprites/chess3d/marble_white.png", import.meta.url).href,
    dark: new URL("../../assets/sprites/chess3d/marble_black.png", import.meta.url).href,
  }
};

async function ensureTextures(THREE){
  if (loadedTextures) return loadedTextures;
  if (!texturesPromise){
    const loader = new THREE.TextureLoader();
    const configureTexture = (texture)=>{
      if (!texture) return null;
      try {
        texture.colorSpace = THREE.SRGBColorSpace;
      } catch(_){
        try { texture.encoding = THREE.sRGBEncoding; } catch(__){}
      }
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1, 1);
      return texture;
    };
    const loadTexture = async (path)=>{
      try {
        const tex = await loader.loadAsync(path);
        return configureTexture(tex);
      } catch (err) {
        console.warn("Failed to load board texture", path, err);
        return null;
      }
    };
    texturesPromise = Promise.all([
      loadTexture(TEXTURE_PATHS.wood.light),
      loadTexture(TEXTURE_PATHS.wood.dark),
      loadTexture(TEXTURE_PATHS.marble.light),
      loadTexture(TEXTURE_PATHS.marble.dark),
    ]).then(([woodLight, woodDark, marbleLight, marbleDark])=>({
      wood: { light: woodLight, dark: woodDark },
      marble: { light: marbleLight, dark: marbleDark },
    }));
  }
  loadedTextures = await texturesPromise;
  return loadedTextures;
}

export async function createBoard(scene, THREE){
  THREERef = THREE;
  tiles = [];
  const group = new THREE.Group();
  const tileSize = 1;
  const half = 4 * tileSize;

  loadedTextures = await ensureTextures(THREE);

  materials.light = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.8 });
  materials.dark = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.8 });

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
  materials.rim = new THREE.MeshStandardMaterial({ color: 0x2b3140, metalness: 0.35, roughness: 0.35 });
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
      metalness: 0.2,
      roughness: 0.8,
      lightMap: loadedTextures?.wood?.light,
      darkMap: loadedTextures?.wood?.dark,
    },
    marble: {
      light: 0xffffff,
      dark: 0xaaaaaa,
      rim: 0x666666,
      metalness: 0.1,
      roughness: 0.5,
      lightMap: loadedTextures?.marble?.light,
      darkMap: loadedTextures?.marble?.dark,
    },
    neon: {
      light: 0x00ffcc,
      dark: 0x003366,
      rim: 0x000000,
      metalness: 0.6,
      roughness: 0.3,
    }
  };
  const cfg = themes[theme] || themes.wood;
  const applyMaterialConfig = (material, colorHex, textureMap)=>{
    material.metalness = cfg.metalness;
    material.roughness = cfg.roughness;
    if (textureMap){
      material.map = textureMap;
      material.color.set(0xffffff);
    } else {
      material.map = null;
      material.color.setHex(colorHex);
    }
    material.needsUpdate = true;
  };

  applyMaterialConfig(materials.light, cfg.light, cfg.lightMap);
  applyMaterialConfig(materials.dark, cfg.dark, cfg.darkMap);

  if (materials.rim){
    materials.rim.metalness = cfg.metalness;
    materials.rim.roughness = cfg.roughness;
    materials.rim.map = null;
    materials.rim.color.setHex(cfg.rim);
    materials.rim.needsUpdate = true;
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
