
/**
 * Lightweight chess pieces using basic primitives.
 */
let THREERef, sceneRef, helpersRef;
const pieces = new Map(); // id -> {mesh, square, type, color}
let currentPieceStyle = 'classic';

export async function createPieces(scene, THREE, helpers){
  THREERef = THREE; sceneRef = scene; helpersRef = helpers;
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
  const mat = new T.MeshStandardMaterial({ color: color==='w' ? 0xeeeeee : 0x222222, metalness:0.2, roughness:0.6 });
  const h = {K:1.0,Q:0.9,R:0.7,B:0.75,N:0.75,P:0.6}[type] || 0.6;

  // Simple shape: stacked cylinders with a head
  const group = new T.Group();
  const base = new T.Mesh(new T.CylinderGeometry(0.32, 0.36, 0.08, 24), mat);
  const body = new T.Mesh(new T.CylinderGeometry(0.24, 0.28, h*0.7, 16), mat);
  const head = new T.Mesh(new T.SphereGeometry(0.18, 16, 12), mat);
  body.position.y = 0.08 + (h*0.35);
  head.position.y = body.position.y + (h*0.4);
  group.add(base, body, head);

  // simple type-specific tweak
  if (type === 'R'){
    const top = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.06, 12), mat);
    top.position.y = head.position.y + 0.1;
    group.add(top);
  }
  if (type === 'N'){
    const nose = new T.Mesh(new T.ConeGeometry(0.12, 0.18, 10), mat);
    nose.position.set(0.12, head.position.y, 0);
    nose.rotation.z = Math.PI * 0.5;
    group.add(nose);
  }

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
    classic: (c)=> new T.MeshStandardMaterial({ color: c==='w'?0xeeeeee:0x222222, metalness:0.2, roughness:0.6 }),
    metal: (c)=> new T.MeshStandardMaterial({ color: c==='w'?0xdddddd:0x333333, metalness:1, roughness:0.2 }),
    glass: (c)=> new T.MeshPhysicalMaterial({ color: c==='w'?0xffffff:0x444444, metalness:0, roughness:0, transparent:true, opacity:0.4, transmission:1 })
  };
  for (const p of pieces.values()){
    const mat = (styles[style]||styles.classic)(p.color);
    p.mesh.traverse(ch=>{ if (ch.isMesh) ch.material = mat; });
  }
}

export function getPieceStyle(){
  return currentPieceStyle;
}
