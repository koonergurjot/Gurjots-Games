
/**
 * Lightweight chess pieces using basic primitives.
 */
import { envDataUrl } from "./textures/env.js";

let THREERef, sceneRef, helpersRef;
const pieces = new Map(); // id -> {mesh, square, type, color}
let currentPieceStyle = 'classic';
let pieceEnvMap;

export async function createPieces(scene, THREE, helpers){
  THREERef = THREE; sceneRef = scene; helpersRef = helpers;
  // Load environment map from data URL
  try {
    const loader = new THREE.TextureLoader();
    pieceEnvMap = await loader.loadAsync(envDataUrl);
    try { pieceEnvMap.mapping = THREE.EquirectangularReflectionMapping; } catch(_){}
    try { pieceEnvMap.colorSpace = THREE.SRGBColorSpace; }
    catch(_) { try { pieceEnvMap.encoding = THREE.sRGBEncoding; } catch(_){} }
  } catch(_){ pieceEnvMap = null; }
}

export async function placeInitialPosition(){
  clearPieces();
  // Place pawns
  for (let f=0; f<8; f++){
    spawn('P','w', fileRankToSquare(f,1));
    spawn('P','b', fileRankToSquare(f,6));
  }
  // R N B Q K B N R
  const back = ['R','N','B','Q','K','B','N','R'];
  for (let f=0; f<8; f++){
    spawn(back[f],'w', fileRankToSquare(f,0));
    spawn(back[f],'b', fileRankToSquare(f,7));
  }
  setPieceStyle(currentPieceStyle);
}

export function listPieces(){
  return [...pieces.values()];
}

export function getPieceBySquare(square){
  for (const p of pieces.values()){
    if (p.square === square) return p;
  }
  return null;
}

export async function movePieceByUci(uci){
  const from = uci.slice(0,2);
  const to = uci.slice(2,4);
  const promo = uci.includes('=') ? uci.slice(5,6).toUpperCase() : null;

  const mover = getPieceBySquare(from);
  if (!mover) return;

  // en passant capture: if pawn moves diagonally to empty square, capture pawn behind
  let cap = getPieceBySquare(to);
  if (cap){
    await fadeOutAndRemove(cap.mesh);
    try{ window.SFX?.beep?.({ freq: 520, dur: 0.08, vol: 0.25 }); }catch(_){}
    for (const [id, p] of pieces.entries()){
      if (p === cap) pieces.delete(id);
    }
  }
  else {
    // check possible en passant
    if (mover.type === 'P' && from[0] !== to[0]){
      const dir = mover.color === 'w' ? -1 : 1; // board ranks increase upwards; captured pawn behind target
      const epSquare = to[0] + String(parseInt(to[1],10) + dir);
      const ep = getPieceBySquare(epSquare);
      if (ep && ep.type === 'P' && ep.color !== mover.color){
        await fadeOutAndRemove(ep.mesh);
        try{ window.SFX?.beep?.({ freq: 520, dur: 0.08, vol: 0.25 }); }catch(_){}
        for (const [id, p] of pieces.entries()){
          if (p === ep) pieces.delete(id);
        }
      }
    }
  }

  mover.square = to;
  if (promo) mover.type = promo;

  const target = helpersRef.squareToPosition(to);
  await animateTo(mover.mesh, target);
  try{ window.SFX?.beep?.({ freq: 600, dur: 0.05, vol: 0.2 }); }catch(_){}

  // handle castling rook move
  if (mover.type === 'K' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2){
    const isKingSide = to.charCodeAt(0) > from.charCodeAt(0);
    const rank = from[1];
    const rookFrom = (isKingSide ? 'h' : 'a') + rank;
    const rookTo = (isKingSide ? 'f' : 'd') + rank;
    const rook = getPieceBySquare(rookFrom);
    if (rook){
      rook.square = rookTo;
      const rTarget = helpersRef.squareToPosition(rookTo);
      await animateTo(rook.mesh, rTarget);
    }
  }
}

function clearPieces(){
  for (const p of pieces.values()){
    sceneRef.remove(p.mesh);
  }
  pieces.clear();
}

function spawn(type, color, square){
  const id = `${type}${color}${Math.random().toString(36).slice(2,7)}`;
  const mesh = buildMesh(type, color);
  const pos = helpersRef.squareToPosition(square);
  mesh.position.set(pos.x, pos.y + 0.2, pos.z);
  mesh.castShadow = true;
  sceneRef.add(mesh);
  pieces.set(id, {id, mesh, type, color, square});
}

function buildMesh(type, color){
  const T = THREERef;
  const mat = (T.MeshPhysicalMaterial ? new T.MeshPhysicalMaterial({ color: color==='w' ? 0xe9edf5 : 0x20232a, metalness:0.35, roughness:0.35, reflectivity: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.25 }) : new T.MeshStandardMaterial({ color: color==='w' ? 0xe9edf5 : 0x20232a, metalness:0.3, roughness:0.4 }));
  if (pieceEnvMap){ mat.envMap = pieceEnvMap; mat.needsUpdate = true; }
  const h = {K:1.05,Q:0.95,R:0.78,B:0.78,N:0.78,P:0.62}[type] || 0.62;

  // Higher fidelity shape: beveled base + lathe body + type head
  const group = new T.Group();
  const base = new T.Mesh(new T.CylinderGeometry(0.34, 0.38, 0.08, 32), mat);
  const bevel = new T.Mesh((T.TorusGeometry? new T.TorusGeometry(0.31, 0.04, 12, 48) : new T.CylinderGeometry(0.32, 0.32, 0.02, 24)), mat);
  bevel.rotation.x = Math.PI/2;
  bevel.position.y = 0.04;
  const profile = [];
  const bodyH = h*0.7;
  for(let i=0;i<=10;i++){
    const t=i/10;
    const r=0.28 - 0.08*(t*t);
    profile.push(new T.Vector2(r, 0.08 + t*bodyH));
  }
  const body = new T.Mesh((T.LatheGeometry ? new T.LatheGeometry(profile, 36) : new T.CylinderGeometry(0.24, 0.28, bodyH, 16)), mat);
  const headY = 0.08 + bodyH + 0.08;
  let head;
  if (type==='K') head = new T.Mesh((T.CapsuleGeometry? new T.CapsuleGeometry(0.16, 0.18, 8, 16) : new T.CylinderGeometry(0.18, 0.18, 0.26, 12)), mat);
  else if (type==='Q') head = new T.Mesh(new T.ConeGeometry(0.2, 0.22, 16), mat);
  else if (type==='R') head = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.22, 16), mat);
  else if (type==='B') head = new T.Mesh((T.OctahedronGeometry? new T.OctahedronGeometry(0.18, 0) : new T.SphereGeometry(0.17, 12, 10)), mat);
  else if (type==='N') head = new T.Mesh((T.CapsuleGeometry? new T.CapsuleGeometry(0.15, 0.12, 8, 12) : new T.ConeGeometry(0.16, 0.18, 10)), mat);
  else head = new T.Mesh(new T.SphereGeometry(0.16, 20, 14), mat);
  head.position.y = headY;
  body.castShadow = head.castShadow = base.castShadow = bevel.castShadow = true;
  group.add(base, bevel, body, head);
  return group;
}

async function animateTo(mesh, target){
  const start = {x: mesh.position.x, y: mesh.position.y, z: mesh.position.z};
  const end = target;
  const lift = 0.25;
  const dur = 250;
  const t0 = performance.now();
  await new Promise(resolve => {
    function step(t){
      const k = Math.min(1, (t - t0)/dur);
      const ease = k<0.5 ? 2*k*k : -1+(4-2*k)*k;
      mesh.position.x = start.x + (end.x - start.x)*ease;
      mesh.position.z = start.z + (end.z - start.z)*ease;
      mesh.position.y = start.y + (lift*(1 - Math.abs(1-2*k)));
      if (k<1) requestAnimationFrame(step); else { mesh.position.y = end.y; resolve(); }
    }
    requestAnimationFrame(step);
  });
}

async function fadeOutAndRemove(mesh){
  const mats=[];
  mesh.traverse((ch)=>{ if (ch.isMesh) mats.push(ch.material); });
  const start=performance.now();
  const dur=200;
  await new Promise((resolve)=>{
    function step(t){
      const k=Math.min(1,(t-start)/dur);
      mats.forEach(m=>{ if (m && 'opacity' in m){ m.transparent=true; m.opacity=1-k; }});
      if (k<1) requestAnimationFrame(step); else resolve();
    }
    requestAnimationFrame(step);
  });
  sceneRef.remove(mesh);
}

function fileRankToSquare(f,r){ return String.fromCharCode(97+f) + (r+1); }

export function setPieceStyle(style){
  if (!THREERef) return;
  currentPieceStyle = style;
  const T = THREERef;
  const styles = {
    classic: (c)=> {
      const m = new T.MeshPhysicalMaterial({ color: c==='w'?0xe9edf5:0x20232a, metalness:0.35, roughness:0.35, reflectivity: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.25 });
      if (pieceEnvMap){ m.envMap = pieceEnvMap; }
      return m;
    },
    metal: (c)=> {
      const m = new T.MeshPhysicalMaterial({ color: c==='w'?0xdfe4ea:0x2a2e35, metalness:0.95, roughness:0.18, reflectivity: 0.9, clearcoat:0.6, clearcoatRoughness:0.15 });
      if (pieceEnvMap){ m.envMap = pieceEnvMap; }
      return m;
    },
    glass: (c)=> {
      const m = new T.MeshPhysicalMaterial({ color: c==='w'?0xffffff:0x9ad0ff, metalness:0.0, roughness:0.02, transparent:true, opacity:0.35, transmission:1, ior: 1.3, thickness: 0.35 });
      if (pieceEnvMap){ m.envMap = pieceEnvMap; }
      return m;
    }
  };
  for (const p of pieces.values()){
    const mat = (styles[style]||styles.classic)(p.color);
    p.mesh.traverse(ch=>{ if (ch.isMesh) ch.material = mat; });
  }
}

export function getPieceStyle(){
  return currentPieceStyle;
}
