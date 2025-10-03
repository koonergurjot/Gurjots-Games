import '../../shared/fx/canvasFx.js';
import '../../shared/skins/index.js';
import { installErrorReporter } from '../../shared/debug/error-reporter.js';
import { loadImage } from '../../shared/assets.js';
import { preloadFirstFrameAssets } from '../../shared/game-asset-preloader.js';
import { play as playSfx } from '../../shared/juice/audio.js';
import { pushEvent } from '/games/common/diag-adapter.js';
import { registerGameDiagnostics } from '../common/diagnostics/adapter.js';

window.fitCanvasToParent = window.fitCanvasToParent || function(){ /* no-op fallback */ };

const globalScope = typeof window !== 'undefined' ? window : globalThis;
const reduceMotionQuery = typeof globalScope.matchMedia === 'function'
  ? globalScope.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

function dispatchDiagnostics(payload){
  if(!payload) return;
  try{
    pushEvent('network', payload);
  }catch(err){
    console.warn('Tetris diagnostics dispatch failed', err);
  }
}

const readyCallbacks=new Set();
const diagnosticsCallbacks=new Set();
let tetrisReady=false;
let diagnosticsRegistered=false;

function notifyReadyListeners(){
  if(!tetrisReady) return;
  const callbacks=Array.from(readyCallbacks);
  readyCallbacks.clear();
  for(const cb of callbacks){
    try{ cb(globalScope.Tetris); }
    catch(err){ console.error('Tetris onReady callback failed', err); }
  }
}

function notifyDiagnosticsListeners(){
  if(!globalScope?.Tetris || !diagnosticsCallbacks.size) return;
  const callbacks=Array.from(diagnosticsCallbacks);
  diagnosticsCallbacks.clear();
  for(const cb of callbacks){
    try{ cb(globalScope.Tetris); }
    catch(err){ console.error('Tetris diagnostics callback failed', err); }
  }
}

function markReady(){
  if(tetrisReady) return;
  tetrisReady=true;
  notifyReadyListeners();
}

function registerReadyCallback(callback){
  if(typeof callback!=='function') return ()=>{};
  if(tetrisReady){
    try{ callback(globalScope.Tetris); }
    catch(err){ console.error('Tetris onReady callback failed', err); }
    return ()=>{};
  }
  readyCallbacks.add(callback);
  return ()=>readyCallbacks.delete(callback);
}

function registerDiagnosticsCallback(callback){
  if(typeof callback!=='function') return ()=>{};
  if(globalScope?.Tetris){
    try{ callback(globalScope.Tetris); }
    catch(err){ console.error('Tetris diagnostics callback failed', err); }
    return ()=>{};
  }
  diagnosticsCallbacks.add(callback);
  return ()=>diagnosticsCallbacks.delete(callback);
}

installErrorReporter();

const GAME_ID='tetris';GG.incPlays();
preloadFirstFrameAssets(GAME_ID).catch(()=>{});
const SPRITE_SOURCES={
  block:'/assets/sprites/block.png',
  effects:{
    spark:'/assets/effects/spark.png',
    explosion:'/assets/effects/explosion.png',
  },
  ui:{
    trophy:'/assets/ui/icons/trophy.png',
  },
};
const BASE_W=300;
const BASE_H=600;

let c=document.getElementById('t');
if(!c){
  const fallback=document.getElementById('gameCanvas');
  if(fallback){
    c=fallback;
  }else{
    const host=document.getElementById('game-root')||document.body;
    if(host){
      const created=document.createElement('canvas');
      created.id='t';
      created.width=BASE_W;
      created.height=BASE_H;
      created.dataset.basew=String(BASE_W);
      created.dataset.baseh=String(BASE_H);
      host.appendChild(created);
      c=created;
    }
  }
}

if(c){
  c.dataset.basew=String(BASE_W);
  c.dataset.baseh=String(BASE_H);
  c.width=BASE_W;
  c.height=BASE_H;
  const CANVAS_PADDING=24;
  const MAX_CANVAS_WIDTH=720;
  const MAX_CANVAS_HEIGHT=1440;

  function syncHudLayout(){
    const root=document.documentElement?.style;
    if(!root) return;
    const rect=c.getBoundingClientRect();
    root.setProperty('--tetris-hud-max-width',`${Math.round(rect.width)}px`);
    root.setProperty('--tetris-hud-center',`${Math.round(rect.left+rect.width/2)}px`);
    const top=Math.max(rect.top+16,CANVAS_PADDING);
    root.setProperty('--tetris-hud-top',`${Math.round(top)}px`);
  }

  function applyResponsiveCanvas(){
    const availableW=Math.max(BASE_W,Math.min(window.innerWidth-CANVAS_PADDING*2,MAX_CANVAS_WIDTH));
    const availableH=Math.max(BASE_H,Math.min(window.innerHeight-CANVAS_PADDING*2,MAX_CANVAS_HEIGHT));
    fitCanvasToParent(c,availableW,availableH,CANVAS_PADDING);
    syncHudLayout();
  }

  applyResponsiveCanvas();
  addEventListener('resize',applyResponsiveCanvas);
}else{
  const error=new Error('Tetris: unable to locate a canvas element (#t or #gameCanvas).');
  console.error(error);
  throw error;
}
const ctx=c.getContext('2d');
if(ctx) ctx.imageSmoothingEnabled=false;
const spriteStore={ block:null, effects:{}, ui:{ trophy:null } };
const spriteRequests=new Set();
const tintCache=new Map();
const effects=[];

const PARALLAX_LAYERS=[
  {key:'layer1',src:'/assets/backgrounds/parallax/arcade_layer1.png',speed:18,alpha:0.85},
  {key:'layer2',src:'/assets/backgrounds/parallax/arcade_layer2.png',speed:36,alpha:1}
];
const parallaxLayers=PARALLAX_LAYERS.map(cfg=>({
  key:cfg.key,
  src:cfg.src,
  speed:cfg.speed,
  alpha:typeof cfg.alpha==='number'?Math.max(0,Math.min(1,cfg.alpha)):1,
  offset:0,
  image:null,
  width:0,
  height:0
}));
const parallaxRequests=new Set();

ensureSprites();
let postedReady=false;
const COLS=10, ROWS=20;
const COLORS=['#000','#8b5cf6','#22d3ee','#f59e0b','#ef4444','#10b981','#e879f9','#38bdf8'];
const SHAPES={I:[[1,1,1,1]],O:[[2,2],[2,2]],T:[[0,3,0],[3,3,3]],S:[[0,4,4],[4,4,0]],Z:[[5,5,0],[0,5,5]],J:[[6,0,0],[6,6,6]],L:[[0,0,7],[7,7,7]]};
const CLEAR_EFFECT_DURATION=0.6;
const LINES_PER_LEVEL=10;

function getCellSize(){
  return Math.floor(c.height/ROWS);
}

const params=new URLSearchParams(location.search);
const motionPreference=params.get('motion');
const motionPrefersAnimation=motionPreference==='animate'||motionPreference==='on';
const motionPrefersReduction=motionPreference==='reduce'||motionPreference==='off';
const shouldReduceMotion=motionPrefersReduction||(!motionPrefersAnimation && !!reduceMotionQuery?.matches);
const mode=params.has('spectate')?'spectate':(params.get('replay')?'replay':'play');
const replayFile=params.get('replay');

const broadcastState={
  supported:false,
  channel:'tetris',
  mode,
  open:false,
  lastEvent:null,
  lastInbound:null,
  lastOutbound:null,
  lastError:null,
};

function ensureSprites(){
  if(!spriteStore.block && !spriteRequests.has('block')){
    spriteRequests.add('block');
    loadImage(SPRITE_SOURCES.block,{slug:GAME_ID}).then(img=>{
      spriteStore.block=img;
      tintCache.clear();
    }).catch(()=>{}).finally(()=>spriteRequests.delete('block'));
  }
  for(const [key,src] of Object.entries(SPRITE_SOURCES.effects)){
    if(spriteStore.effects[key]) continue;
    const requestKey=`effect:${key}`;
    if(spriteRequests.has(requestKey)) continue;
    spriteRequests.add(requestKey);
    loadImage(src,{slug:GAME_ID}).then(img=>{
      spriteStore.effects[key]=img;
    }).catch(()=>{}).finally(()=>spriteRequests.delete(requestKey));
  }
  for(const [key,src] of Object.entries(SPRITE_SOURCES.ui)){
    if(spriteStore.ui[key]) continue;
    const requestKey=`ui:${key}`;
    if(spriteRequests.has(requestKey)) continue;
    spriteRequests.add(requestKey);
    loadImage(src,{slug:GAME_ID}).then(img=>{
      spriteStore.ui[key]=img;
    }).catch(()=>{}).finally(()=>spriteRequests.delete(requestKey));
  }
  ensureParallaxLayers();
}

function ensureParallaxLayers(){
  for(const layer of parallaxLayers){
    if(layer.image && isImageReady(layer.image)) continue;
    const requestKey=`parallax:${layer.key}`;
    if(parallaxRequests.has(requestKey)) continue;
    parallaxRequests.add(requestKey);
    loadImage(layer.src,{slug:GAME_ID}).then(img=>{
      layer.image=img;
      layer.width=img.naturalWidth||img.width||layer.width||0;
      layer.height=img.naturalHeight||img.height||layer.height||0;
    }).catch(()=>{}).finally(()=>parallaxRequests.delete(requestKey));
  }
}

function getParallaxMetrics(layer){
  if(!layer) return null;
  const img=layer.image;
  const baseW=img?.naturalWidth||img?.width||layer.width||0;
  const baseH=img?.naturalHeight||img?.height||layer.height||0;
  if(!baseW||!baseH) return null;
  const destHeight=c.height||BASE_H;
  const destWidth=destHeight*(baseW/baseH);
  if(!Number.isFinite(destWidth)||destWidth<=0) return null;
  layer.width=baseW;
  layer.height=baseH;
  layer.renderWidth=destWidth;
  layer.renderHeight=destHeight;
  return {width:destWidth,height:destHeight};
}

function updateParallax(dt){
  if(shouldReduceMotion) return;
  ensureParallaxLayers();
  if(!Number.isFinite(dt)) dt=0;
  for(const layer of parallaxLayers){
    const metrics=getParallaxMetrics(layer);
    if(!metrics) continue;
    const speed=Number.isFinite(layer.speed)?layer.speed:0;
    if(!speed) continue;
    let offset=(layer.offset||0)+speed*dt;
    const span=metrics.width;
    if(span>0){
      offset%=span;
      if(offset<0) offset+=span;
    }
    layer.offset=offset;
  }
}

function resetParallax(){
  for(const layer of parallaxLayers){
    if(layer) layer.offset=0;
  }
}

function drawParallaxBackground(){
  if(!ctx) return;
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  ctx.fillStyle='#0f1320';
  ctx.fillRect(0,0,c.width,c.height);
  ensureParallaxLayers();
  for(const layer of parallaxLayers){
    const metrics=getParallaxMetrics(layer);
    if(!metrics || !isImageReady(layer.image)) continue;
    let startX=-(layer.offset||0);
    while(startX>0) startX-=metrics.width;
    ctx.save();
    ctx.globalAlpha=layer.alpha ?? 1;
    for(let x=startX; x<c.width; x+=metrics.width){
      ctx.drawImage(layer.image,x,0,metrics.width,metrics.height);
    }
    ctx.restore();
  }
  ctx.restore();
}

function isImageReady(img){
  return !!img && img.complete && img.naturalWidth>0 && img.naturalHeight>0;
}

function getTintedBlock(color){
  const base=spriteStore.block;
  if(!isImageReady(base) || !color) return null;
  if(tintCache.has(color)) return tintCache.get(color);
  const canvas=document.createElement('canvas');
  const width=base.naturalWidth||base.width||24;
  const height=base.naturalHeight||base.height||24;
  canvas.width=width;
  canvas.height=height;
  const context=canvas.getContext('2d');
  if(!context) return null;
  context.imageSmoothingEnabled=false;
  context.clearRect(0,0,width,height);
  context.drawImage(base,0,0,width,height);
  context.globalCompositeOperation='source-atop';
  context.fillStyle=color;
  context.fillRect(0,0,width,height);
  context.globalCompositeOperation='source-over';
  tintCache.set(color,canvas);
  return canvas;
}

function drawBlockAtPixel(px,py,size,color,alpha=1,opts={}){
  if(!ctx || !color || size<=0) return;
  const shadow=opts.shadow!==false;
  if(shadow){
    const shadowSprite=getTintedBlock('#000000');
    ctx.save();
    ctx.globalAlpha=alpha*0.35;
    if(shadowSprite){
      ctx.drawImage(shadowSprite,px+2,py+2,size,size);
    }else{
      ctx.fillStyle='#000000';
      ctx.fillRect(px+2,py+2,size,size);
    }
    ctx.restore();
  }
  const sprite=getTintedBlock(color);
  ctx.save();
  ctx.globalAlpha=alpha;
  if(sprite){
    ctx.drawImage(sprite,px,py,size,size);
  }else{
    ctx.fillStyle=color;
    ctx.fillRect(px,py,size,size);
  }
  ctx.restore();
}

function playSound(name){
  try{ playSfx(name); }
  catch(err){ console.warn('[tetris] sfx failed',err); }
}

function spawnEffect(type,x,y,opts={}){
  if(shouldReduceMotion) return;
  ensureSprites();
  const duration=opts.duration ?? 0.45;
  effects.push({
    type,
    x,
    y,
    duration,
    life:duration,
    scale:opts.scale ?? 1,
    vx:opts.vx ?? 0,
    vy:opts.vy ?? 0,
    rotation:opts.rotation ?? 0,
    rotationSpeed:opts.rotationSpeed ?? 0,
  });
}

function getPieceBlockCenters(piece){
  const centers=[];
  if(!piece||!Array.isArray(piece.m)) return centers;
  const cell=getCellSize();
  for(let y=0;y<piece.m.length;y++){
    for(let x=0;x<piece.m[y].length;x++){
      if(!piece.m[y][x]) continue;
      centers.push({
        x:(piece.x+x+0.5)*cell,
        y:(piece.y+y+0.5)*cell,
      });
    }
  }
  return centers;
}

function emitLockEffects(piece,hard=0){
  if(shouldReduceMotion) return;
  const centers=getPieceBlockCenters(piece);
  const cell=getCellSize();
  const sparkScale=Math.max(0.6,cell/32);
  for(const center of centers){
    spawnEffect('spark',center.x,center.y,{duration:0.3,scale:sparkScale,vx:(Math.random()-0.5)*40,vy:(Math.random()-0.5)*40});
  }
  if(hard>0 && centers.length){
    const avgX=centers.reduce((sum,p)=>sum+p.x,0)/centers.length;
    const maxY=centers.reduce((max,p)=>Math.max(max,p.y),centers[0].y);
    const explosionScale=Math.max(1,cell/18);
    spawnEffect('explosion',avgX,maxY,{duration:0.5,scale:explosionScale});
  }
}

function emitLineClearEffects(rows){
  if(shouldReduceMotion || !rows?.length) return;
  const cell=getCellSize();
  const boardWidth=COLS*cell;
  const sparkScale=Math.max(0.8,cell/28);
  for(const row of rows){
    const y=(row+0.5)*cell;
    spawnEffect('explosion',boardWidth/2,y,{duration:0.55,scale:Math.max(1.1,boardWidth/160)});
    for(let col=0;col<COLS;col+=1){
      const x=(col+0.5)*cell;
      spawnEffect('spark',x,y,{duration:0.4,scale:sparkScale,vx:(Math.random()-0.5)*120,vy:(Math.random()-0.5)*80});
    }
  }
}

function updateEffects(dt){
  if(!effects.length) return;
  const remaining=[];
  for(const fx of effects){
    fx.life-=dt;
    fx.x+=fx.vx*dt;
    fx.y+=fx.vy*dt;
    fx.rotation+=fx.rotationSpeed*dt;
    if(fx.life>0) remaining.push(fx);
  }
  effects.length=0;
  effects.push(...remaining);
}

function drawEffects(){
  if(!effects.length || !ctx) return;
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  for(const fx of effects){
    const sprite=spriteStore.effects?.[fx.type];
    if(!isImageReady(sprite)) continue;
    const progress=Math.max(0,Math.min(1,fx.life/fx.duration));
    const alpha=Math.pow(progress,0.6);
    const baseW=sprite.naturalWidth||sprite.width;
    const baseH=sprite.naturalHeight||sprite.height;
    const w=(baseW||32)*(fx.scale||1);
    const h=(baseH||32)*(fx.scale||1);
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.translate(fx.x,fx.y);
    if(fx.rotation) ctx.rotate(fx.rotation);
    ctx.drawImage(sprite,-w/2,-h/2,w,h);
    ctx.restore();
  }
  ctx.restore();
}

function updateClearState(dt){
  if(clearTimer<=0) return;
  clearTimer=Math.max(0,clearTimer-dt);
  if(clearTimer<=0 && clearRows.length){
    const toClear=new Set(clearRows);
    grid=grid.filter((row,index)=>!toClear.has(index));
    while(grid.length<ROWS) grid.unshift(Array(COLS).fill(0));
    clearRows.length=0;
    updateGhost();
  }
}

let bestScore=+(localStorage.getItem('tetris:bestScore')||0);
let bestLines=+(localStorage.getItem('tetris:bestLines')||0);
let started=false;
let grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
let bag=[];
let nextM;
let holdM=null;
let canHold=true;

let cur;
let ghost;
let showGhost=localStorage.getItem('tetris:ghost')!=='0';
let score=0, level=1, lines=0, over=false, dropMs=700, last=0, paused=false;
let combo=-1;
const scoreDisplay=document.getElementById('score');

function summarizeBroadcastPayload(data){
  if(!data || typeof data!=='object') return null;
  const summary={
    started: !!data.started,
    paused: !!data.paused,
    over: !!data.over,
  };
  if(typeof data.score==='number') summary.score=data.score;
  if(typeof data.level==='number') summary.level=data.level;
  if(typeof data.lines==='number') summary.lines=data.lines;
  if(typeof data.combo==='number') summary.combo=data.combo;
  const currentPiece=data.cur?.t ?? data.current?.t ?? null;
  const nextPiece=data.nextM?.t ?? data.next?.t ?? null;
  const holdPiece=data.holdM?.t ?? data.hold?.t ?? null;
  if(currentPiece) summary.current=currentPiece;
  if(nextPiece) summary.next=nextPiece;
  if(holdPiece) summary.hold=holdPiece;
  if(Array.isArray(data.grid)){
    summary.hasGrid=true;
    const filled=data.grid.reduce((acc,row)=>acc+(Array.isArray(row)?row.reduce((sum,cell)=>sum+(cell?1:0),0):0),0);
    summary.filledCells=filled;
  }
  return summary;
}

function logBroadcastEvent(direction,payload,details){
  const timestamp=Date.now();
  const entry={
    channel:'tetris',
    type:'broadcast',
    direction,
    mode,
    started,
    paused,
    over,
    timestamp,
    score,
    level,
    lines,
    combo,
    ready:tetrisReady,
  };
  if(details && typeof details==='object') Object.assign(entry,details);
  const summary=summarizeBroadcastPayload(payload);
  if(summary) entry.payload=summary;
  const eventType=details?.event||null;
  const record={
    direction,
    event:eventType,
    timestamp,
    summary:summary?{...summary}:null,
    details:details && typeof details==='object'?{...details}:null,
  };
  broadcastState.supported=!!bc;
  if(eventType==='unavailable') broadcastState.supported=false;
  if(eventType==='open') broadcastState.open=true;
  if(eventType==='close') broadcastState.open=false;
  broadcastState.mode=mode;
  broadcastState.lastEvent=record;
  if(direction==='inbound') broadcastState.lastInbound=record;
  if(direction==='outbound') broadcastState.lastOutbound=record;
  if(details?.error){
    broadcastState.lastError={ timestamp, error:details.error };
  }
  dispatchDiagnostics(entry);
}

function cloneMatrix(matrix){
  if(!Array.isArray(matrix)) return [];
  return matrix.map(row=>Array.isArray(row)?row.slice():[]);
}

function clonePiece(piece){
  if(!piece) return null;
  const snapshot={t:piece.t ?? null};
  if(piece.m) snapshot.m=cloneMatrix(piece.m);
  if(typeof piece.x==='number') snapshot.x=piece.x;
  if(typeof piece.y==='number') snapshot.y=piece.y;
  if(typeof piece.o==='number') snapshot.o=piece.o;
  return snapshot;
}

function getPublicState(){
  return {
    mode,
    started,
    paused,
    over,
    score,
    level,
    lines,
    combo,
    canHold,
    showGhost,
    grid: cloneMatrix(grid),
    current: clonePiece(cur),
    next: clonePiece(nextM),
    hold: clonePiece(holdM),
  };
}

function cloneBroadcastEvent(record){
  if(!record) return null;
  const { direction=null, event=null, timestamp=null, summary=null, details=null } = record;
  return {
    direction,
    event,
    timestamp,
    summary: summary && typeof summary==='object' ? { ...summary } : null,
    details: details && typeof details==='object' ? { ...details } : null,
  };
}

function getBroadcastSnapshot(){
  return {
    supported:broadcastState.supported,
    channel:broadcastState.channel,
    mode:broadcastState.mode,
    open:broadcastState.open,
    lastEvent:cloneBroadcastEvent(broadcastState.lastEvent),
    lastInbound:cloneBroadcastEvent(broadcastState.lastInbound),
    lastOutbound:cloneBroadcastEvent(broadcastState.lastOutbound),
    lastError:broadcastState.lastError
      ? { timestamp:broadcastState.lastError.timestamp ?? null, error:broadcastState.lastError.error ?? null }
      : null,
  };
}

function snapshotScore(){
  return {
    score,
    bestScore,
    bestLines,
    level,
    lines,
    combo,
    mode,
    started,
    paused,
    over,
    status: over ? 'game-over' : (paused ? 'paused' : (started ? 'running' : 'idle')),
  };
}

function snapshotEntities(){
  return {
    grid: cloneMatrix(grid),
    current: clonePiece(cur),
    next: clonePiece(nextM),
    hold: clonePiece(holdM),
    ghost: showGhost ? clonePiece(ghost) : null,
    combo,
    broadcast: getBroadcastSnapshot(),
    meta: {
      mode,
      started,
      paused,
      over,
      canHold,
      showGhost,
    },
  };
}

function ensureDiagnosticsRegistration(){
  if(diagnosticsRegistered) return;
  diagnosticsRegistered=true;
  try{
    registerGameDiagnostics('tetris',{
      hooks:{
        onReady(){
          pushEvent('boot',{ level:'info', message:'[tetris] diagnostics adapter ready' });
        },
      },
      api:{
        start(){
          const result=TetrisAPI.start();
          pushEvent('control',{ level:'info', message:'[tetris] start requested via diagnostics', status: snapshotScore().status });
          return result;
        },
        pause(){
          const result=TetrisAPI.pause();
          pushEvent('control',{ level:'info', message:'[tetris] pause requested via diagnostics', status: snapshotScore().status });
          return result;
        },
        resume(){
          const result=TetrisAPI.resume();
          pushEvent('control',{ level:'info', message:'[tetris] resume requested via diagnostics', status: snapshotScore().status });
          return result;
        },
        reset(){
          const result=TetrisAPI.reset();
          pushEvent('control',{ level:'info', message:'[tetris] reset requested via diagnostics', status: snapshotScore().status });
          return result;
        },
        getScore(){
          return snapshotScore();
        },
        getEntities(){
          return snapshotEntities();
        },
      },
    });
    pushEvent('boot',{ level:'info', message:'[tetris] diagnostics registered' });
  }catch(err){
    diagnosticsRegistered=false;
    console.error('Tetris diagnostics registration failed', err);
  }
}

registerDiagnosticsCallback(()=>ensureDiagnosticsRegistration());

const TetrisAPI={
  get mode(){ return mode; },
  get started(){ return started; },
  get paused(){ return paused; },
  get over(){ return over; },
  get score(){ return score; },
  get level(){ return level; },
  get lines(){ return lines; },
  get combo(){ return combo; },
  get canHold(){ return canHold; },
  get showGhost(){ return showGhost; },
  get ready(){ return tetrisReady; },
  get broadcastChannel(){ return bc; },
  get grid(){ return cloneMatrix(grid); },
  get currentPiece(){ return clonePiece(cur); },
  get nextPiece(){ return clonePiece(nextM); },
  get holdPiece(){ return clonePiece(holdM); },
  get state(){ return getPublicState(); },
  start(){
    if(over) return false;
    if(!started){
      started=true;
      const replayApi=globalScope?.Replay;
      if(mode==='play' && replayApi && typeof replayApi.start==='function') replayApi.start();
      last=typeof performance!=='undefined'?performance.now():Date.now();
      lastFrame=0;
    }
    startGameLoop();
    return true;
  },
  pause(){
    if(over) return false;
    if(!paused) paused=true;
    return true;
  },
  resume(){
    if(over) return false;
    if(paused){
      paused=false;
      startGameLoop();
    }
    return true;
  },
  togglePause(){
    if(over) return false;
    paused=!paused;
    if(!paused) startGameLoop();
    return paused;
  },
  startLoop(){
    startGameLoop();
    return rafId;
  },
  stopLoop(){
    stopGameLoop();
    return rafId;
  },
  reset(){
    stopGameLoop();
    grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
    bag=[];
    initGame();
    score=0;
    level=1;
    lines=0;
    combo=-1;
    holdM=null;
    canHold=true;
    over=false;
    started=false;
    paused=false;
    shellPaused=false;
    pausedByShell=false;
    lockTimer=0;
    clearRows.length=0;
    clearTimer=0;
    last=0;
    lastFrame=0;
    dropMs=700;
    syncScoreDisplay();
    updateGhost();
    return true;
  },
  onReady: registerReadyCallback,
  offReady(callback){ readyCallbacks.delete(callback); },
};

globalScope.Tetris=TetrisAPI;
notifyDiagnosticsListeners();

function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
}

function nextFromBag(){
  if(mode==='replay'){
    const t=Replay.nextPiece();
    const key=(t&&SHAPES[t])?t:'I';
    return {m:SHAPES[key].map(r=>r.slice()),t:key};
  }
  if(bag.length===0){
    bag=Object.keys(SHAPES);
    shuffle(bag);
  }
  const t=bag.pop();
  return {m:SHAPES[t].map(r=>r.slice()),t};
}

function syncScoreDisplay(){
  if(!scoreDisplay) return;
  scoreDisplay.textContent=String(score);
  scoreDisplay.dataset.gameScore=String(score); // Surface score for shell integration.
}

syncScoreDisplay();
let bc=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('tetris'):null;
if(bc){
  logBroadcastEvent('init',null,{event:'open'});
}else{
  logBroadcastEvent('init',null,{event:'unavailable'});
}
if(bc && mode==='spectate'){
  bc.onmessage=e=>{
    const data=e?.data;
    logBroadcastEvent('inbound',data,{event:'message'});
    if(data && typeof data==='object'){
      ({grid,cur,nextM,holdM,score,level,lines,over,paused,started,showGhost}=data);
      if(typeof data.combo==='number') combo=data.combo;
      syncScoreDisplay();
      updateGhost();
    }
  };
}
let lockTimer=0; const LOCK_DELAY=0.5; let lastFrame=0;
let shellPaused=false;
let pausedByShell=false;
let rafId=0;
let clearTimer=0, clearRows=[];
let rotated=false;

function initGame(){
  resetParallax();
  nextM=nextFromBag();
  cur=spawn();
  updateGhost();
}

function spawn(){
  const piece=nextM;
  nextM=nextFromBag();
  if(mode==='play') Replay.recordPiece(piece.t);
  return {m:piece.m.map(r=>r.slice()), x:3, y:0, t:piece.t, o:0};
}
function collide(p){
  for(let y=0;y<p.m.length;y++)
    for(let x=0;x<p.m[y].length;x++){
      if(!p.m[y][x]) continue;
      const nx=p.x+x, ny=p.y+y;
      if(nx<0||nx>=COLS||ny>=ROWS||grid[ny]?.[nx]) return true;
    }
  return false;
}
function merge(p){
  for(let y=0;y<p.m.length;y++)
    for(let x=0;x<p.m[y].length;x++)
      if(p.m[y][x]) grid[p.y+y][p.x+x]=p.m[y][x];
}

function updateGhost(){
  ghost={m:cur.m.map(r=>r.slice()),x:cur.x,y:cur.y,o:cur.o,t:cur.t};
  while(true){
    const nextPos={...ghost,y:ghost.y+1};
    if(collide(nextPos)) break;
    ghost.y=nextPos.y;
  }
}

function updateBest(){
  if(score>bestScore){
    bestScore=score;
    localStorage.setItem('tetris:bestScore',bestScore);
  }
  if(lines>bestLines){
    bestLines=lines;
    localStorage.setItem('tetris:bestLines',bestLines);
  }
}

function clearLines(){
  clearRows=[];
  for(let y=0;y<ROWS;y++)
    if(grid[y].every(v=>v)) clearRows.push(y);
  if(clearRows.length){
    clearTimer=CLEAR_EFFECT_DURATION;
  }
  return clearRows.length;
}

function isTSpin(p){
  if(p.t!=='T' || !rotated) return false;
  const corners=[[0,0],[2,0],[0,2],[2,2]];
  let count=0;
  for(const [dx,dy] of corners){
    const nx=p.x+dx, ny=p.y+dy;
    if(nx<0||nx>=COLS||ny>=ROWS || grid[ny][nx]) count++;
  }
  return count>=3;
}

function lockPiece(soft=0,hard=0){
  const lockedPiece=clonePiece(cur);
  merge(cur);
  const tSpin=isTSpin(cur);
  const cleared=clearLines();
  let pts=soft + hard*2;
  if(tSpin){
    pts+=[0,800,1200,1600][cleared]||400;
  }else{
    pts+=[0,100,300,500,800][cleared]||0;
  }
  if(cleared>0){
    combo++;
    if(combo>0) pts+=combo*50;
  }else{
    combo=-1;
  }
  score+=pts;
  syncScoreDisplay();
  lines+=cleared;
  GG.addXP(2*cleared);
  let leveledUp=false;
  while(lines>=level*LINES_PER_LEVEL){
    level++;
    dropMs=Math.max(120,dropMs-60);
    leveledUp=true;
  }
  updateBest();
  GG.setMeta(GAME_ID,'Best lines: '+lines);
  emitLockEffects(lockedPiece,hard);
  playSound('hit');
  if(cleared>0){
    emitLineClearEffects(clearRows);
    playSound('explode');
  }
  if(leveledUp) playSound('power');
  rotated=false;
}

function drawCell(x,y,v,cell){
  if(!v) return;
  drawBlockAtPixel(x*cell,y*cell,cell,COLORS[v],1,{shadow:false});
}
function drawPieceCell(x,y,v,cell,alpha=1){
  drawBlockAtPixel(x*cell,y*cell,cell,COLORS[v],alpha,{shadow:true});
}
function drawMatrix(m,ox,oy,cell){
  const previewCell=cell*0.8;
  for(let y=0;y<m.length;y++)
    for(let x=0;x<m[y].length;x++){
      if(!m[y][x]) continue;
      drawBlockAtPixel(ox+x*previewCell,oy+y*previewCell,previewCell-2,COLORS[m[y][x]],1,{shadow:false});
    }
}

function drawHighScoreWithIcon(text,centerX,baselineY){
  if(!ctx) return;
  const trophy=spriteStore.ui?.trophy;
  if(!isImageReady(trophy)){
    ctx.save();
    ctx.textAlign='center';
    ctx.fillText(text,centerX,baselineY);
    ctx.restore();
    return;
  }
  const metrics=ctx.measureText(text);
  const rawAscent=metrics.actualBoundingBoxAscent||metrics.fontBoundingBoxAscent||0;
  const rawDescent=metrics.actualBoundingBoxDescent||metrics.fontBoundingBoxDescent||0;
  const ascent=rawAscent||10;
  const descent=rawDescent||4;
  const textHeight=Math.max(12,ascent+descent);
  const iconHeight=textHeight;
  const spriteWidth=trophy.naturalWidth||trophy.width||iconHeight;
  const spriteHeight=trophy.naturalHeight||trophy.height||iconHeight;
  const ratio=spriteHeight?spriteWidth/spriteHeight:1;
  const iconWidth=iconHeight*ratio;
  const spacing=8;
  const totalWidth=metrics.width+iconWidth+spacing;
  const startX=centerX-totalWidth/2;
  const iconY=baselineY-ascent;
  ctx.save();
  ctx.textAlign='left';
  ctx.save();
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(trophy,startX,iconY,iconWidth,iconHeight);
  ctx.restore();
  ctx.fillText(text,startX+iconWidth+spacing,baselineY);
  ctx.restore();
}
function drawGhost(cell){
  if(!showGhost||!ghost) return;
  for(let y=0;y<ghost.m.length;y++)
    for(let x=0;x<ghost.m[y].length;x++)
      if(ghost.m[y][x]) drawBlockAtPixel((ghost.x+x)*cell,(ghost.y+y)*cell,cell,COLORS[ghost.m[y][x]],0.35,{shadow:false});
}
function draw(){
  if(!postedReady){
    postedReady=true;
    try { window.parent?.postMessage({ type:'GAME_READY', slug:'tetris' }, '*'); } catch {}
    markReady();
  }
  const cell=getCellSize();
  ensureSprites();
  drawParallaxBackground();

  if(!started){
    ctx.fillStyle='#e6e7ea';
    ctx.font='bold 32px Inter';
    ctx.textAlign='center';
    ctx.fillText('Tetris',c.width/2,c.height/2-40);
    ctx.font='14px Inter';
    drawHighScoreWithIcon(`High Score ${bestScore}`,c.width/2,c.height/2);
    ctx.fillText(`Best Lines ${bestLines}`,c.width/2,c.height/2+20);
    ctx.fillText('Press Space to start',c.width/2,c.height/2+60);
    ctx.textAlign='start';
    return;
  }

  for(let y=0;y<ROWS;y++)
    for(let x=0;x<COLS;x++) drawCell(x,y,grid[y][x],cell);
  drawGhost(cell);
  for(let y=0;y<cur.m.length;y++)
    for(let x=0;x<cur.m[y].length;x++)
      if(cur.m[y][x]) drawPieceCell(cur.x+x,cur.y+y,cur.m[y][x],cell);

  drawEffects();

  ctx.fillStyle='#e6e7ea';
  ctx.font='bold 14px Inter';
  ctx.fillText(`Score ${score}`,8,20);
  ctx.fillText(`Level ${level}`,8,40);
  ctx.fillText(`Lines ${lines}`,8,60);
  if(combo>0) ctx.fillText(`Combo ${combo}`,8,80);
  const ox=COLS*cell+16;
  ctx.fillText('NEXT',ox,20);
  drawMatrix(nextM.m,ox,30,cell);
  ctx.fillText('HOLD (C)',ox,120);
  if(holdM) drawMatrix(holdM.m,ox,130,cell);

  if(over){
    ctx.fillStyle='rgba(0,0,0,.6)';
    ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle='#e6e7ea';
    ctx.font='bold 30px Inter';
    ctx.fillText('Game Over',70,300);
  }
  if(paused){
    ctx.fillStyle='rgba(0,0,0,0.55)';
    ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle='#e6e7ea';
    ctx.font='bold 28px Inter';
    ctx.fillText('Paused — P to resume',40,c.height/2);
  }
}

function drop(manual=false){
  cur.y++;
  if(collide(cur)){
    cur.y--;
    lockPiece(manual?1:0,0);
    cur=spawn();
    canHold=true;
    lockTimer=0;
    if(collide(cur)){
      over=true;
      updateBest();
      GG.addAch(GAME_ID,'Stacked');
      if(mode==='play'){ Replay.stop(); Replay.download('tetris-replay-'+Date.now()+'.json'); }
    }
  } else {
    if(manual){ score++; updateBest(); syncScoreDisplay(); }
    lockTimer=0;
  }
  updateGhost();
}
function hardDrop(){
  let dist=0;
  while(true){
    const nextPos={...cur,y:cur.y+1};
    if(collide(nextPos)) break; // loop avoids counting the collision step
    cur.y=nextPos.y;
    dist++;
  }
  lockPiece(0,dist);
  cur=spawn();
  canHold=true;
  lockTimer=0;
  updateBest();
  updateGhost();
  if(collide(cur)){
    over=true;
    updateBest();
    GG.addAch(GAME_ID,'Stacked');
    if(mode==='play'){ Replay.stop(); Replay.download('tetris-replay-'+Date.now()+'.json'); }
  }
}
function hold(){
  if(!canHold) return;
  const temp=holdM;
  holdM={m:cur.m.map(r=>r.slice()),t:cur.t};
  if(temp){
    cur={m:temp.m.map(r=>r.slice()),x:3,y:0,t:temp.t,o:0};
  } else {
    cur=spawn();
  }
  canHold=false;
  rotated=false;
  updateGhost();
}

function applyAction(a){
  if(a==='left'){
    const nx=cur.x-1; const p={...cur,x:nx};
    if(!collide(p)){ cur.x=nx; lockTimer=0; updateGhost(); }
  }
  if(a==='right'){
    const nx=cur.x+1; const p={...cur,x:nx};
    if(!collide(p)){ cur.x=nx; lockTimer=0; updateGhost(); }
  }
  if(a==='rotate'){
    const cand=TetrisEngine.rotate(cur,grid,1);
    if(cand!==cur){ cur=cand; playSound('click'); lockTimer=0; updateGhost(); rotated=true; }
  }
  if(a==='down'){
    drop(true); GG.addXP(1);
  }
  if(a==='hardDrop'){
    hardDrop();
  }
  if(a==='hold'){
    hold();
  }
}

addEventListener('keydown',e=>{
  const key=e.key||'';
  const keyLower=key.toLowerCase();
  const preventKeys=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ']);
  if(e.code==='Space' || preventKeys.has(key) || key==='Spacebar'){
    e.preventDefault();
  }
  if(keyLower==='g'){
    showGhost=!showGhost;
    localStorage.setItem('tetris:ghost',showGhost?'1':'0');
    updateGhost();
    return;
  }
  if(mode!=='play') return;
  if(!started){
    if(e.code==='Space'){ started=true; Replay.start(); return; }
    return;
  }
  if(over && keyLower==='r'){
    grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
    bag=[]; initGame();
    score=0; level=1; lines=0; holdM=null; canHold=true;
    syncScoreDisplay();
    over=false; started=false;
    updateGhost();
    return;
  }
  if(keyLower==='p'){ paused=!paused; return; }
  if(paused || over || clearTimer>0) return;

  if(e.key==='ArrowLeft'){ applyAction('left'); Replay.recordAction('left'); }
  if(e.key==='ArrowRight'){ applyAction('right'); Replay.recordAction('right'); }
  if(e.key==='ArrowUp'){ applyAction('rotate'); Replay.recordAction('rotate'); }
  if(e.key==='ArrowDown'){ applyAction('down'); Replay.recordAction('down'); }
  if(e.code==='Space'){ applyAction('hardDrop'); Replay.recordAction('hardDrop'); }
  if(keyLower==='c'){ applyAction('hold'); Replay.recordAction('hold'); }
});


let touchX=null,touchY=null;
function handleAction(a){
  if(mode!=='play' || paused || over || clearTimer>0) return;
  applyAction(a);
  Replay.recordAction(a);
}
c.addEventListener('pointerdown',e=>{touchX=e.clientX;touchY=e.clientY;});
c.addEventListener('pointerup',e=>{
  if(touchX==null||touchY==null) return;
  const dx=e.clientX-touchX,dy=e.clientY-touchY;
  const adx=Math.abs(dx),ady=Math.abs(dy);
  if(Math.max(adx,ady)<10){handleAction('rotate');}
  else if(adx>ady){handleAction(dx>0?'right':'left');}
  else{handleAction(dy>0?'hardDrop':'hold');}
  touchX=touchY=null;
});


function loop(ts){
  if(shellPaused){ rafId=0; return; }
  if(!last) last=ts;
  if(!lastFrame) lastFrame=ts;
  const dt=Math.min((ts-lastFrame)/1000,0.05);
  lastFrame=ts;

  if(mode==='replay' && started && !paused && !over){
    const acts=Replay.tick(dt); acts.forEach(a=>applyAction(a));
  }

  if(mode!=='spectate' && started && !paused && !over && clearTimer<=0 && ts-last>dropMs){
    drop();
    last=ts;
  }
  if(mode!=='spectate' && started && !paused && !over && clearTimer<=0){
    const touching=collide({...cur,y:cur.y+1});
    if(touching){
      lockTimer+=dt;
      if(lockTimer>=LOCK_DELAY){
        lockPiece();
        cur=spawn();
        canHold=true;
        lockTimer=0;
        updateGhost();
        if(collide(cur)){
          over=true;
          updateBest();
          GG.addAch(GAME_ID,'Stacked');
          if(mode==='play'){ Replay.stop(); Replay.download('tetris-replay-'+Date.now()+'.json'); }
        }
      }
    } else {
      lockTimer=0;
    }
  }
  updateParallax(dt);
  updateEffects(dt);
  updateClearState(dt);
  ctx.clearRect(0,0,c.width,c.height);
  draw();
  if(bc && mode==='play'){
    const payload={grid,cur,nextM,holdM,score,level,lines,over,paused,started,showGhost,combo};
    bc.postMessage(payload);
    logBroadcastEvent('outbound',payload,{event:'message'});
  }
  rafId=requestAnimationFrame(loop);
}

function startGameLoop(){ if(!rafId) rafId=requestAnimationFrame(loop); }

function stopGameLoop(){
  if(!rafId) return;
  cancelAnimationFrame(rafId);
  rafId=0;
}

function pauseForShell(){
  if(shellPaused) return;
  if(!over && !paused){ paused=true; pausedByShell=true; }
  shellPaused=true;
  stopGameLoop();
}

function resumeFromShell(){
  if(!shellPaused || document.hidden) return;
  shellPaused=false;
  if(pausedByShell && !over){
    paused=false;
    pausedByShell=false;
    last=performance.now();
    lastFrame=0;
  } else {
    pausedByShell=false;
  }
  startGameLoop();
}

const onShellPause=()=>pauseForShell();
const onShellResume=()=>resumeFromShell();
const onVisibility=()=>{ if(document.hidden) pauseForShell(); else resumeFromShell(); };
const onShellMessage=(event)=>{
  const data=event && typeof event.data==='object' ? event.data : null;
  const type=data?.type;
  if(type==='GAME_PAUSE' || type==='GG_PAUSE') pauseForShell();
  if(type==='GAME_RESUME' || type==='GG_RESUME') resumeFromShell();
};
window.addEventListener('ggshell:pause', onShellPause);
window.addEventListener('ggshell:resume', onShellResume);
document.addEventListener('visibilitychange', onVisibility);
window.addEventListener('message', onShellMessage, {passive:true});

if(mode==='replay'){
  const replayPath=`./replays/${replayFile}`;
  Replay.load(replayPath).then(()=>{initGame();started=true;startGameLoop();if(typeof reportReady==='function') reportReady('tetris'); markReady();}).catch(err=>{
    const message=err&&typeof err.message==='string'?err.message:String(err);
    const stack=err&&err.stack?String(err.stack):undefined;
    pushEvent('network',{event:'tetris_replay_load_failed',level:'error',message,replay:replayFile||null,stack});
    dispatchDiagnostics({event:'tetris_replay_load_failed',message,error:message,level:'error',replay:replayFile||null,stack});
    console.error('Failed to load Tetris replay',err);
    const toastFn=typeof globalScope?.GG?.toast==='function'?globalScope.GG.toast:(typeof globalScope.toast==='function'?globalScope.toast:null);
    if(toastFn){
      toastFn('Unable to load replay. Starting fallback mode.');
    }
    initGame();
    started=true;
    startGameLoop();
    if(typeof reportReady==='function') reportReady('tetris');
    markReady();
  });
}else{
  initGame();
  if(mode==='spectate') started=true;
  startGameLoop();
  if(typeof reportReady==='function') reportReady('tetris');
  markReady();
}
