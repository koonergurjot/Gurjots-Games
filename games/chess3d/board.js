
/**
 * Creates an 8x8 board at y=0. Provides helpers to map algebraic squares to positions.
 */
let tiles = [];
let rim;
let THREERef;

export async function createBoard(scene, THREE){
  THREERef = THREE;
  tiles = [];
  const group = new THREE.Group();
  const tileSize = 1;
  const half = 4 * tileSize;

  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xb7c0d8 });
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x5a6373 });

  const geom = new THREE.BoxGeometry(tileSize, 0.1, tileSize);
  for (let r=0;r<8;r++){
    for (let f=0;f<8;f++){
      const isLight = (r+f)%2===0;
      const mesh = new THREE.Mesh(geom, isLight ? whiteMat : blackMat);
      mesh.receiveShadow = true;
      mesh.position.set(-half + f*tileSize + tileSize/2, 0, -half + r*tileSize + tileSize/2);
      mesh.userData.square = fileRankToSquare(f, r);
      mesh.userData.isLight = isLight;
      tiles.push(mesh);
      group.add(mesh);
    }
  }

  // simple rim
  const rimGeom = new THREE.BoxGeometry(8*tileSize+0.4, 0.08, 8*tileSize+0.4);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b3140 });
  rim = new THREE.Mesh(rimGeom, rimMat);
  rim.position.y = -0.07;
  rim.receiveShadow = true;
  group.add(rim);

  scene.add(group);

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
  if (!THREERef) return;
  const T = THREERef;
  const themes = {
    wood: {
      light: 0xdab893,
      dark: 0x8b5a2b,
      rim: 0x5a3a22,
      metalness: 0.2,
      roughness: 0.8,
    },
    marble: {
      light: 0xffffff,
      dark: 0xaaaaaa,
      rim: 0x666666,
      metalness: 0.1,
      roughness: 0.5,
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
  const lightMat = new T.MeshStandardMaterial({ color: cfg.light, metalness: cfg.metalness, roughness: cfg.roughness });
  const darkMat = new T.MeshStandardMaterial({ color: cfg.dark, metalness: cfg.metalness, roughness: cfg.roughness });
  const rimMat = new T.MeshStandardMaterial({ color: cfg.rim, metalness: cfg.metalness, roughness: cfg.roughness });
  tiles.forEach((tile)=>{
    tile.material = tile.userData.isLight ? lightMat : darkMat;
  });
  if (rim) rim.material = rimMat;
}

function squareToFileRank(square){
  const file = square.charCodeAt(0) - 97; // a=0
  const rank = parseInt(square[1], 10) - 1; // 1=0
  return { f:file, r:rank };
}

function fileRankToSquare(f,r){
  return String.fromCharCode(97+f) + (r+1);
}
