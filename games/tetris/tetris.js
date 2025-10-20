import '../../shared/fx/canvasFx.js';
import '../../shared/skins/index.js';
import { installErrorReporter } from '../../shared/debug/error-reporter.js';
import { loadImage } from '../../shared/assets.js';
import { preloadFirstFrameAssets } from '../../shared/game-asset-preloader.js';
import { play as playSfx } from '../../shared/juice/audio.js';
import { pushEvent } from '/games/common/diag-adapter.js';
import { registerGameDiagnostics } from '../common/diagnostics/adapter.js';
import { createSeed, seedFromDate, generateSequence as generateRandomSequence, createRandomizerSelector } from './randomizer.js';
import { createScoringSystem, detectTSpin } from './scoring.js';
import { createHud } from './ui.js';
import { gameEvent } from '../../shared/telemetry.js';

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
  const viewportNode=c.closest('[data-game-viewport]')||c.parentElement||document.body;
  let viewportNeedsSync=false;

  function measureViewport(){
    if(!viewportNode) return { width: window.innerWidth, height: window.innerHeight };
    if(viewportNode===document.body||viewportNode===document.documentElement){
      return {
        width: Math.max(document.documentElement?.clientWidth||0, window.innerWidth||0),
        height: Math.max(document.documentElement?.clientHeight||0, window.innerHeight||0),
      };
    }
    const width=Math.max(viewportNode.clientWidth||0, viewportNode.getBoundingClientRect?.().width||0);
    const height=Math.max(viewportNode.clientHeight||0, viewportNode.getBoundingClientRect?.().height||0);
    return { width, height };
  }

  function syncHudLayout(){
    const doc=document.documentElement;
    const root=doc?.style;
    if(!root || !c) return;
    const rect=c.getBoundingClientRect();
    const width=Math.round(rect.width);
    const height=Math.round(rect.height);
    const left=Math.round(rect.left);
    const right=Math.round(rect.right);
    const top=Math.round(rect.top);
    const bottom=Math.round(rect.bottom);
    const center=Math.round(rect.left+rect.width/2);
    const safeLeft=Math.max(0,left);
    const safeRight=Math.max(0,Math.round(window.innerWidth-right));
    const safeTop=Math.max(0,top);
    const safeBottom=Math.max(0,Math.round(window.innerHeight-bottom));
    root.setProperty('--tetris-hud-width',`${width}px`);
    root.setProperty('--tetris-hud-height',`${height}px`);
    root.setProperty('--tetris-hud-max-width',`${width}px`);
    root.setProperty('--tetris-hud-center',`${center}px`);
    root.setProperty('--tetris-hud-left',`${left}px`);
    root.setProperty('--tetris-hud-right',`${right}px`);
    root.setProperty('--tetris-hud-bottom',`${bottom}px`);
    root.setProperty('--tetris-hud-safe-left',`${safeLeft}px`);
    root.setProperty('--tetris-hud-safe-right',`${safeRight}px`);
    root.setProperty('--tetris-hud-safe-top',`${safeTop}px`);
    root.setProperty('--tetris-hud-safe-bottom',`${safeBottom}px`);
    const topOffset=Math.max(rect.top+16,CANVAS_PADDING);
    root.setProperty('--tetris-hud-top',`${Math.round(topOffset)}px`);
    const orientation=height>width?'portrait':'landscape';
    const horizontalSpace=Math.max(0,window.innerWidth-width);
    const spaceLeft=Math.max(0,rect.left);
    const spaceRight=Math.max(0,window.innerWidth-rect.right);
    const splitThreshold=Math.max(180,width*0.4);
    const split=orientation==='landscape' && horizontalSpace>splitThreshold;
    let layout='stack';
    if(split){
      layout=spaceRight>=spaceLeft?'split-right':'split-left';
    }else if(orientation==='portrait'){
      layout='portrait';
    }
    const toastAnchor=layout==='split-left'?left:(layout==='split-right'?right:center);
    const toastTranslate=layout==='split-left'?'0':(layout==='split-right'?' -100%':'-50%');
    root.setProperty('--tetris-hud-layout',layout);
    root.setProperty('--tetris-hud-orientation',orientation);
    root.setProperty('--tetris-hud-columns',layout.startsWith('split')?'1fr 1fr':'1fr');
    root.setProperty('--tetris-hud-flow',layout==='portrait'?'column':'row');
    const toastMaxWidth=layout.startsWith('split')
      ? Math.round(Math.min(width,Math.max(240,width*0.85)))
      : width;
    root.setProperty('--tetris-hud-toast-x',`${Math.round(toastAnchor)}px`);
    root.setProperty('--tetris-hud-toast-translate',toastTranslate.trim());
    root.setProperty('--tetris-hud-toast-max',`${toastMaxWidth}px`);
    if(doc){
      doc.dataset.tetrisHudLayout=layout;
      doc.dataset.tetrisHudOrientation=orientation;
    }
  }

  function applyResponsiveCanvas(){
    const { width, height }=measureViewport();
    const availableW=Math.max(BASE_W,width);
    const availableH=Math.max(BASE_H,height);
    fitCanvasToParent(c,{
      width:availableW,
      height:availableH,
      minWidth:BASE_W,
      minHeight:BASE_H,
    });
    syncHudLayout();
  }

  applyResponsiveCanvas();
  addEventListener('resize',applyResponsiveCanvas);
  if(typeof ResizeObserver==='function'&&viewportNode?.nodeType===1){
    const observer=new ResizeObserver(()=>{
      if(viewportNeedsSync) return;
      viewportNeedsSync=true;
      requestAnimationFrame(()=>{
        viewportNeedsSync=false;
        applyResponsiveCanvas();
      });
    });
    try{ observer.observe(viewportNode); }
    catch(err){ console.warn('Tetris viewport ResizeObserver failed',err); }
  }
}else{
  const error=new Error('Tetris: unable to locate a canvas element (#t or #gameCanvas).');
  console.error(error);
  throw error;
}
const ctx=c.getContext('2d');
if(ctx) ctx.imageSmoothingEnabled=false;
const spriteStore={ effects:{}, ui:{ trophy:null } };
const spriteRequests=new Set();
const effects=[];

const PARALLAX_LAYERS=[
  {
    key:'layer1',
    src:'/assets/backgrounds/parallax/arcade_layer1.png',
    speed:18,
    alpha:0.85,
    tiers:[
      { level:1, multiplier:1 },
      { level:5, multiplier:1.2 },
      { level:10, multiplier:1.45 },
      { level:15, multiplier:1.7 },
    ],
  },
  {
    key:'layer2',
    src:'/assets/backgrounds/parallax/arcade_layer2.png',
    speed:36,
    alpha:1,
    tiers:[
      { level:1, multiplier:1 },
      { level:5, multiplier:1.3 },
      { level:10, multiplier:1.65 },
      { level:15, multiplier:1.95 },
    ],
  }
];
const parallaxLayers=PARALLAX_LAYERS.map(cfg=>({
  key:cfg.key,
  src:cfg.src,
  baseSpeed:Number.isFinite(cfg.speed)?cfg.speed:0,
  tiers:Array.isArray(cfg.tiers)
    ? cfg.tiers.map(tier=>({
        level:Math.max(1,Number.isFinite(tier?.level)?Math.floor(tier.level):1),
        multiplier:Number.isFinite(tier?.multiplier)?tier.multiplier:undefined,
        speed:Number.isFinite(tier?.speed)?tier.speed:undefined,
      })).sort((a,b)=>a.level-b.level)
    : [],
  alpha:typeof cfg.alpha==='number'?Math.max(0,Math.min(1,cfg.alpha)):1,
  offset:0,
  image:null,
  width:0,
  height:0,
  renderWidth:0,
  renderHeight:0,
  currentSpeed:Number.isFinite(cfg.speed)?cfg.speed:0,
}));
const parallaxRequests=new Set();

ensureSprites();
let postedReady=false;
const COLS=10, ROWS=20;
const GRID_SIZE=COLS*ROWS;
const SHAPES={I:[[1,1,1,1]],O:[[2,2],[2,2]],T:[[0,3,0],[3,3,3]],S:[[0,4,4],[4,4,0]],Z:[[5,5,0],[0,5,5]],J:[[6,0,0],[6,6,6]],L:[[0,0,7],[7,7,7]]};
const PIECE_VALUE_TO_KEY=[null,'I','O','T','S','Z','J','L'];
const PIECE_KEYS=['I','O','T','S','Z','J','L'];
const DEFAULT_TILE_CONFIG={
  I:{ fill:'--tetris-piece-i-fill', stroke:'--tetris-piece-i-stroke', cornerRadius:6 },
  O:{ fill:'--tetris-piece-o-fill', stroke:'--tetris-piece-o-stroke', cornerRadius:6 },
  T:{ fill:'--tetris-piece-t-fill', stroke:'--tetris-piece-t-stroke', cornerRadius:6 },
  S:{ fill:'--tetris-piece-s-fill', stroke:'--tetris-piece-s-stroke', cornerRadius:6 },
  Z:{ fill:'--tetris-piece-z-fill', stroke:'--tetris-piece-z-stroke', cornerRadius:6 },
  J:{ fill:'--tetris-piece-j-fill', stroke:'--tetris-piece-j-stroke', cornerRadius:6 },
  L:{ fill:'--tetris-piece-l-fill', stroke:'--tetris-piece-l-stroke', cornerRadius:6 },
};
const FALLBACK_TILE_COLORS={
  I:'#38bdf8',
  O:'#facc15',
  T:'#a855f7',
  S:'#22c55e',
  Z:'#ef4444',
  J:'#3b82f6',
  L:'#f97316',
};
const FALLBACK_TILE_STROKES={
  I:'#0ea5e9',
  O:'#d97706',
  T:'#7c3aed',
  S:'#16a34a',
  Z:'#b91c1c',
  J:'#1d4ed8',
  L:'#ea580c',
};
const tileStyleCache=new Map();
const tileConfig={};
for(const key of PIECE_KEYS){
  tileConfig[key]={ ...DEFAULT_TILE_CONFIG[key] };
}
let rootComputedStyle=null;
function getRootComputedStyle(){
  if(rootComputedStyle) return rootComputedStyle;
  if(typeof window==='undefined' || !window.getComputedStyle) return null;
  rootComputedStyle=window.getComputedStyle(document.documentElement);
  return rootComputedStyle;
}
function getPieceStyle(key){
  if(!key) return null;
  if(tileStyleCache.has(key)) return tileStyleCache.get(key);
  const config=tileConfig[key] || DEFAULT_TILE_CONFIG[key];
  const fill=resolveStyleColor(config?.fill,FALLBACK_TILE_COLORS[key]||'#ffffff');
  const stroke=resolveStyleColor(config?.stroke,FALLBACK_TILE_STROKES[key]||adjustLightness(fill,-25));
  const radiusRaw=config?.cornerRadius;
  const radius=Number.isFinite(radiusRaw)?Math.max(0,radiusRaw):DEFAULT_TILE_CONFIG[key]?.cornerRadius||0;
  const style={ fill, stroke, cornerRadius: radius };
  tileStyleCache.set(key,style);
  return style;
}
if(typeof fetch==='function'){
  fetch(new URL('../../assets/tetris/tiles.json', import.meta.url)).then(r=>{
    if(!r.ok) return null;
    return r.json();
  }).then(data=>{
    if(!data || typeof data!=='object') return;
    for(const key of PIECE_KEYS){
      if(!data[key] || typeof data[key]!=='object') continue;
      tileConfig[key]={ ...tileConfig[key], ...data[key] };
    }
    tileStyleCache.clear();
  }).catch(()=>{});
}
const PREVIEW_COUNT=3;
const CLEAR_EFFECT_DURATION=0.6;
const CLEAR_STAGE_SPLIT=[CLEAR_EFFECT_DURATION*0.5,CLEAR_EFFECT_DURATION*0.5];
const LINES_PER_LEVEL=10;
const LOCK_DELAY=0.5;
const LOCK_RESET_LIMIT=15;
const MOVE_DAS=0.16;
const MOVE_ARR=0.02;
const SOFT_DROP_FACTOR=6;

function createGrid(){
  return new Uint8Array(GRID_SIZE);
}

function gridIndex(x,y){
  return y*COLS+x;
}

function getGridCell(state,x,y){
  if(x<0||x>=COLS||y<0||y>=ROWS) return 0;
  return state[gridIndex(x,y)]||0;
}

function setGridCell(state,x,y,value){
  if(x<0||x>=COLS||y<0||y>=ROWS) return;
  state[gridIndex(x,y)]=value;
}

function cloneGrid(state){
  const out=[];
  for(let y=0;y<ROWS;y++){
    const row=new Array(COLS);
    for(let x=0;x<COLS;x++) row[x]=state[gridIndex(x,y)]||0;
    out.push(row);
  }
  return out;
}

function importGrid(data){
  const state=createGrid();
  if(Array.isArray(data)){
    for(let y=0;y<Math.min(ROWS,data.length);y++){
      const row=data[y];
      if(!Array.isArray(row)) continue;
      for(let x=0;x<Math.min(COLS,row.length);x++){
        const value=row[x]|0;
        if(value) state[gridIndex(x,y)]=value;
      }
    }
  }else if(data instanceof Uint8Array && data.length===GRID_SIZE){
    state.set(data);
  }
  return state;
}

function collapseRows(state,rows){
  if(!rows?.length) return;
  const toClear=new Set(rows);
  let write=ROWS-1;
  for(let y=ROWS-1;y>=0;y--){
    if(toClear.has(y)) continue;
    if(write!==y){
      const fromStart=gridIndex(0,y);
      const toStart=gridIndex(0,write);
      state.copyWithin(toStart,fromStart,fromStart+COLS);
    }
    write--;
  }
  while(write>=0){
    state.fill(0,gridIndex(0,write),gridIndex(0,write)+COLS);
    write--;
  }
}

function getCellSize(){
  return Math.floor(c.height/ROWS);
}

const params=new URLSearchParams(location.search);
const motionPreference=params.get('motion');
const motionPrefersAnimation=motionPreference==='animate'||motionPreference==='on';
const motionPrefersReduction=motionPreference==='reduce'||motionPreference==='off';
const shouldReduceMotion=motionPrefersReduction||(!motionPrefersAnimation && !!reduceMotionQuery?.matches);
function parseSeedParam(value){
  if(value==null) return null;
  if(typeof value==='number' && Number.isFinite(value)) return value>>>0;
  if(typeof value!=='string') return null;
  const trimmed=value.trim();
  if(!trimmed) return null;
  const radix=trimmed.startsWith('0x')||trimmed.startsWith('0X')?16:10;
  const parsed=Number.parseInt(trimmed,radix);
  if(!Number.isFinite(parsed)) return null;
  return (parsed>>>0);
}
const requestedRandomizerMode=params.get('randomizer')||params.get('rng')||'';
const rawSeedParam=params.get('seed');
const requestedDaily=params.get('daily');
let dailySeedLabel=null;
let dailySeedActive=requestedDaily==='1'||(typeof rawSeedParam==='string' && rawSeedParam.toLowerCase()==='daily');
const requestedSeed=dailySeedActive?null:parseSeedParam(rawSeedParam);
const mode=params.has('spectate')?'spectate':(params.get('replay')?'replay':'play');
const replayFile=params.get('replay');

const initialRandomizerMode=requestedRandomizerMode||'bag';
let initialSeed;
if(dailySeedActive){
  initialSeed=computeDailySeed();
}else if(typeof requestedSeed==='number'){
  initialSeed=requestedSeed;
}else{
  initialSeed=createSeed();
}
const pieceRandomizer=createRandomizerSelector({ mode: initialRandomizerMode, seed: initialSeed });
let rngSeed=dailySeedActive?initialSeed:pieceRandomizer.seed;
if(dailySeedActive && !dailySeedLabel){
  dailySeedLabel=seedFromDate().label;
}

const broadcastState={
  supported:false,
  channel:'tetris',
  mode,
  randomizerMode:pieceRandomizer.mode,
  open:false,
  lastEvent:null,
  lastInbound:null,
  lastOutbound:null,
  lastError:null,
};

function ensureSprites(){
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

function resolveLayerSpeed(layer,currentLevel){
  if(!layer) return 0;
  const base=Number.isFinite(layer.baseSpeed)?layer.baseSpeed:0;
  const tiers=Array.isArray(layer.tiers)?layer.tiers:[];
  if(!tiers.length) return base;
  let speed=base;
  for(const tier of tiers){
    const threshold=Math.max(1,Number.isFinite(tier.level)?Math.floor(tier.level):1);
    if(currentLevel>=threshold){
      if(Number.isFinite(tier.speed)) speed=tier.speed;
      else if(Number.isFinite(tier.multiplier)) speed=base*tier.multiplier;
    }else{
      break;
    }
  }
  return speed;
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
  ensureParallaxLayers();
  if(!Number.isFinite(dt)) dt=0;
  for(const layer of parallaxLayers){
    const metrics=getParallaxMetrics(layer);
    if(!metrics) continue;
    const speed=shouldReduceMotion?0:resolveLayerSpeed(layer, level);
    layer.currentSpeed=speed;
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
    if(!layer) continue;
    layer.offset=0;
    layer.currentSpeed=resolveLayerSpeed(layer, level);
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

function clamp(value,min,max){
  return Math.min(max,Math.max(min,value));
}

function hexToRgb(color){
  if(typeof color!=='string') return null;
  let hex=color.trim();
  if(hex.startsWith('#')) hex=hex.slice(1);
  if(hex.length===3){
    hex=hex.split('').map(ch=>ch+ch).join('');
  }
  if(hex.length!==6) return null;
  const num=parseInt(hex,16);
  if(Number.isNaN(num)) return null;
  const r=(num>>16)&0xff;
  const g=(num>>8)&0xff;
  const b=num&0xff;
  return { r, g, b };
}

function rgbToHsl({ r, g, b }){
  const rn=r/255;
  const gn=g/255;
  const bn=b/255;
  const max=Math.max(rn,gn,bn);
  const min=Math.min(rn,gn,bn);
  const delta=max-min;
  let h=0;
  if(delta!==0){
    if(max===rn) h=((gn-bn)/delta)%6;
    else if(max===gn) h=(bn-rn)/delta+2;
    else h=(rn-gn)/delta+4;
    h*=60;
    if(h<0) h+=360;
  }
  const l=(max+min)/2;
  const s=delta===0?0:delta/(1-Math.abs(2*l-1));
  return { h, s, l };
}

function hslToRgb({ h, s, l }){
  const c=(1-Math.abs(2*l-1))*s;
  const hp=h/60;
  const x=c*(1-Math.abs((hp%2)-1));
  let rn=0,gn=0,bn=0;
  if(hp>=0&&hp<1){ rn=c; gn=x; }
  else if(hp>=1&&hp<2){ rn=x; gn=c; }
  else if(hp>=2&&hp<3){ gn=c; bn=x; }
  else if(hp>=3&&hp<4){ gn=x; bn=c; }
  else if(hp>=4&&hp<5){ rn=x; bn=c; }
  else if(hp>=5&&hp<6){ rn=c; bn=x; }
  const m=l-c/2;
  const r=Math.round((rn+m)*255);
  const g=Math.round((gn+m)*255);
  const b=Math.round((bn+m)*255);
  return { r, g, b };
}

function rgbToHex({ r, g, b }){
  const toHex=v=>v.toString(16).padStart(2,'0');
  return `#${toHex(clamp(r,0,255))}${toHex(clamp(g,0,255))}${toHex(clamp(b,0,255))}`;
}

function adjustLightness(color,delta){
  const rgb=hexToRgb(color);
  if(!rgb) return color;
  const hsl=rgbToHsl(rgb);
  hsl.l=clamp(hsl.l+delta/100,0,1);
  return rgbToHex(hslToRgb(hsl));
}

function normalizeColor(color,fallback){
  if(!color) return fallback;
  let value=String(color).trim();
  if(!value) return fallback;
  if(value.startsWith('#')){
    if(value.length===4){
      const r=value[1];
      const g=value[2];
      const b=value[3];
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    if(value.length>=7) return value.slice(0,7);
    return value;
  }
  const match=value.match(/^rgba?\(([^)]+)\)$/i);
  if(match){
    const parts=match[1].split(',').map(part=>Number.parseFloat(part.trim()));
    if(parts.length>=3 && parts.slice(0,3).every(Number.isFinite)){
      const [r,g,b]=parts;
      return rgbToHex({ r:Math.round(r), g:Math.round(g), b:Math.round(b) });
    }
  }
  return fallback ?? value;
}

function resolveStyleColor(token,fallback){
  if(!token) return normalizeColor(fallback,fallback);
  let value=String(token).trim();
  if(!value) return normalizeColor(fallback,fallback);
  if(value.startsWith('--')){
    const styles=getRootComputedStyle();
    const resolved=styles?.getPropertyValue(value)?.trim();
    if(resolved) value=resolved;
    else return normalizeColor(fallback,fallback);
  }
  return normalizeColor(value,fallback);
}

function drawRoundedRectPath(context,x,y,width,height,radius){
  const r=Math.max(0,Math.min(radius,Math.min(width,height)/2));
  context.moveTo(x+r,y);
  context.lineTo(x+width-r,y);
  context.quadraticCurveTo(x+width,y,x+width,y+r);
  context.lineTo(x+width,y+height-r);
  context.quadraticCurveTo(x+width,y+height,x+width-r,y+height);
  context.lineTo(x+r,y+height);
  context.quadraticCurveTo(x,y+height,x,y+height-r);
  context.lineTo(x,y+r);
  context.quadraticCurveTo(x,y,x+r,y);
}

function drawBlockAtPixel(px,py,size,pieceKey,alpha=1,opts={}){
  if(!ctx || !pieceKey || size<=0) return;
  const style=getPieceStyle(pieceKey);
  if(!style) return;
  const x=Math.round(px);
  const y=Math.round(py);
  const side=Math.max(1,Math.round(size));
  const radius=Math.min(Math.max(0,style.cornerRadius||0),side/2);
  const shadowEnabled=opts.shadow!==false && !opts.ghost;
  ctx.save();
  ctx.globalAlpha=alpha;
  if(shadowEnabled){
    ctx.save();
    ctx.globalAlpha=alpha*0.35;
    ctx.fillStyle='rgba(0,0,0,0.55)';
    ctx.beginPath();
    drawRoundedRectPath(ctx,x+2,y+2,side,side,Math.max(0,radius-1));
    ctx.fill();
    ctx.restore();
  }
  if(opts.ghost){
    ctx.save();
    ctx.globalAlpha=Math.max(0,Math.min(1,alpha*0.25));
    ctx.fillStyle=style.fill;
    ctx.beginPath();
    drawRoundedRectPath(ctx,x,y,side,side,radius);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.lineWidth=1;
    ctx.lineJoin='round';
    ctx.lineCap='round';
    ctx.setLineDash([Math.max(3,Math.round(side*0.55)),Math.max(2,Math.round(side*0.3))]);
    ctx.strokeStyle=adjustLightness(style.stroke||style.fill,-25);
    ctx.globalAlpha=Math.max(0,Math.min(1,alpha*0.8));
    ctx.translate(0.5,0.5);
    ctx.beginPath();
    drawRoundedRectPath(ctx,x,y,side,side,Math.max(0,radius-0.5));
    ctx.stroke();
    ctx.restore();

    ctx.restore();
    return;
  }
  const fillColor=style.fill;
  const strokeColor=style.stroke||adjustLightness(fillColor,-25);
  const gradient=ctx.createLinearGradient(x,y,x,y+side);
  gradient.addColorStop(0,adjustLightness(fillColor,12));
  gradient.addColorStop(0.55,fillColor);
  gradient.addColorStop(1,adjustLightness(fillColor,-14));
  ctx.beginPath();
  drawRoundedRectPath(ctx,x,y,side,side,radius);
  ctx.fillStyle=gradient;
  ctx.fill();

  const capHeight=Math.max(2,Math.round(side*0.35));
  ctx.save();
  ctx.beginPath();
  drawRoundedRectPath(ctx,x+1,y+1,side-2,capHeight,Math.max(0,radius-1));
  ctx.clip();
  const capGradient=ctx.createLinearGradient(x,y,x,y+capHeight);
  capGradient.addColorStop(0,'rgba(255,255,255,0.7)');
  capGradient.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=capGradient;
  ctx.fillRect(x,y,side,capHeight);
  ctx.restore();

  ctx.save();
  const lineWidth=Math.max(1,Math.round(side*0.08));
  ctx.lineWidth=lineWidth;
  ctx.lineJoin='round';
  ctx.lineCap='round';
  ctx.strokeStyle=strokeColor;
  ctx.translate(0.5,0.5);
  ctx.beginPath();
  drawRoundedRectPath(ctx,x,y,side,side,Math.max(0,radius-0.5));
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawTileValue(value,px,py,size,alpha=1,opts={}){
  const key=PIECE_VALUE_TO_KEY[value]||null;
  if(!key) return;
  drawBlockAtPixel(px,py,size,key,alpha,opts);
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
  if(!clearPipeline.length) return;
  const current=clearPipeline[0];
  current.timer-=dt;
  if(current.stage===0 && current.timer<=0){
    current.stage=1;
    current.timer=CLEAR_STAGE_SPLIT[1];
  }
  if(current.stage===1 && current.timer<=0){
    collapseRows(grid,current.rows);
    clearPipeline.shift();
    refreshClearingRows();
    updateGhost();
  }
}

let bestScore=+(localStorage.getItem('tetris:bestScore')||0);
let bestLines=+(localStorage.getItem('tetris:bestLines')||0);
let started=false;
let grid=createGrid();
let pieceQueue=[];
let nextM;
let holdM=null;
let canHold=true;

let cur;
let ghost;
let showGhost=localStorage.getItem('tetris:ghost')!=='0';
let score=0, level=1, lines=0, over=false, dropMs=700, paused=false;
let runStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
let gameOverSent = false;
let lastComboEmitted = -1;
let combo=-1;
let backToBack=false;
let lastRotationInfo=null;
const scoreDisplay=document.getElementById('score');
const scoringSystem=createScoringSystem();
let hud=null;

const moveState={
  left:{active:false,das:0,arr:0},
  right:{active:false,das:0,arr:0},
  down:{active:false},
  lastDir:null,
};
const rotationGrid={
  width:COLS,
  height:ROWS,
  get(x,y){
    return getGridCell(grid,x,y);
  },
};

function syncRandomizerUrl(){
  if(typeof history?.replaceState!=='function') return;
  if(typeof URL!=='function') return;
  if(mode!=='play') return;
  try{
    const current=new URL(location.href);
    if(dailySeedActive){
      current.searchParams.set('daily','1');
      current.searchParams.delete('seed');
    }else{
      current.searchParams.delete('daily');
      if(Number.isInteger(rngSeed)) current.searchParams.set('seed',String(rngSeed>>>0));
      else current.searchParams.delete('seed');
    }
    const randomizerMode=pieceRandomizer.mode;
    if(randomizerMode && randomizerMode!=='bag') current.searchParams.set('randomizer',randomizerMode);
    else current.searchParams.delete('randomizer');
    history.replaceState({},'',`${current.pathname}${current.search}${current.hash}`);
  }catch(err){
    console.warn('[tetris] unable to sync randomizer params',err);
  }
}

function computeDailySeed(){
  const info=seedFromDate();
  dailySeedLabel=info.label;
  return info.seed>>>0;
}

function reseed(seed){
  let targetSeed;
  const hasExplicitSeed=seed!==undefined;
  const parsedSeed=parseSeedParam(seed);
  if(typeof parsedSeed==='number'){
    dailySeedActive=false;
    dailySeedLabel=null;
    targetSeed=parsedSeed;
  }else if(dailySeedActive && !hasExplicitSeed){
    targetSeed=computeDailySeed();
  }else if(dailySeedActive){
    targetSeed=computeDailySeed();
  }else{
    targetSeed=createSeed();
  }
  rngSeed=pieceRandomizer.reset(targetSeed);
  if(!Number.isInteger(rngSeed)) rngSeed=pieceRandomizer.seed;
  pieceQueue.length=0;
  nextM=null;
  syncRandomizerUrl();
  const replayApi=globalScope?.Replay;
  if(mode==='play' && replayApi && typeof replayApi.setSeed==='function'){
    replayApi.setSeed(rngSeed);
  }
  updateDailyHud();
  return rngSeed;
}

function setDailySeedMode(enabled,{ restart=true }={}){
  const next=!!enabled;
  if(next===dailySeedActive){
    if(next){
      dailySeedLabel=seedFromDate().label;
      updateDailyHud();
    }
    return rngSeed;
  }
  dailySeedActive=next;
  if(next){
    reseed();
  }else{
    dailySeedLabel=null;
    reseed(createSeed());
  }
  if(restart){
    resetGameState({ preserveSeed:true });
  }else{
    updateDailyHud();
  }
  return rngSeed;
}

syncRandomizerUrl();

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
  if(typeof data.backToBack==='boolean') summary.backToBack=data.backToBack;
  const currentPiece=data.cur?.t ?? data.current?.t ?? null;
  const nextPiece=data.nextM?.t ?? data.next?.t ?? null;
  const holdPiece=data.holdM?.t ?? data.hold?.t ?? null;
  if(currentPiece) summary.current=currentPiece;
  if(nextPiece) summary.next=nextPiece;
  if(holdPiece) summary.hold=holdPiece;
  if(Array.isArray(data.queue)){
    summary.queue=data.queue.slice(0,PREVIEW_COUNT).map(entry=>{
      if(entry && typeof entry==='object') return entry.t ?? null;
      return entry ?? null;
    }).filter(Boolean);
  }
  if(Number.isInteger(data.seed)) summary.seed=data.seed;
  if(typeof data.randomizerMode==='string' && data.randomizerMode) summary.randomizer=data.randomizerMode;
  if(typeof data.dailySeedActive==='boolean') summary.daily=data.dailySeedActive;
  if(typeof data.dailySeedLabel==='string' && data.dailySeedLabel) summary.dailyLabel=data.dailySeedLabel;
  if(Array.isArray(data.grid) || data.grid instanceof Uint8Array){
    summary.hasGrid=true;
    let filled=0;
    if(data.grid instanceof Uint8Array){
      for(const cell of data.grid) if(cell) filled++;
    }else{
      filled=data.grid.reduce((acc,row)=>acc+(Array.isArray(row)?row.reduce((sum,cell)=>sum+(cell?1:0),0):0),0);
    }
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
    randomizerMode:pieceRandomizer.mode,
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
  broadcastState.randomizerMode=pieceRandomizer.mode;
  broadcastState.lastEvent=record;
  if(direction==='inbound') broadcastState.lastInbound=record;
  if(direction==='outbound') broadcastState.lastOutbound=record;
  if(details?.error){
    broadcastState.lastError={ timestamp, error:details.error };
  }
  dispatchDiagnostics(entry);
}

function cloneMatrix(matrix){
  if(matrix instanceof Uint8Array) return cloneGrid(matrix);
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
    backToBack,
    canHold,
    showGhost,
    seed:rngSeed,
    randomizerMode:pieceRandomizer.mode,
    dailySeedActive,
    dailySeedLabel,
    grid: cloneMatrix(grid),
    current: clonePiece(cur),
    next: clonePiece(nextM),
    hold: clonePiece(holdM),
    queue: pieceQueue.slice(0,PREVIEW_COUNT).map(t=>({ t })),
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
    randomizerMode:broadcastState.randomizerMode,
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
    backToBack,
    mode,
    randomizerMode:pieceRandomizer.mode,
    started,
    paused,
    over,
    seed:rngSeed,
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
      seed:rngSeed,
      randomizerMode:pieceRandomizer.mode,
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
  get backToBack(){ return backToBack; },
  get dailySeedActive(){ return dailySeedActive; },
  get dailySeedLabel(){ return dailySeedLabel; },
  get ready(){ return tetrisReady; },
  get broadcastChannel(){ return bc; },
  get grid(){ return cloneMatrix(grid); },
  get currentPiece(){ return clonePiece(cur); },
  get nextPiece(){ return clonePiece(nextM); },
  get holdPiece(){ return clonePiece(holdM); },
  get seed(){ return rngSeed; },
  get randomizerMode(){ return pieceRandomizer.mode; },
  get randomizerModes(){
    return Array.isArray(pieceRandomizer.modes)?pieceRandomizer.modes.slice():[];
  },
  get state(){ return getPublicState(); },
  generateSequence(count=14,seed=rngSeed,modeOverride){
    const safeCount=Math.max(0,Math.min(10000,Number.isFinite(count)?Math.floor(count):0));
    const parsedSeed=parseSeedParam(seed);
    const resolvedSeed=typeof parsedSeed==='number'?parsedSeed:(Number.isFinite(seed)?(seed>>>0):rngSeed);
    const requestedMode=typeof modeOverride==='string' && modeOverride.trim()?modeOverride:pieceRandomizer.mode;
    return generateRandomSequence(resolvedSeed, safeCount, requestedMode);
  },
  setSeed(seed){
    return reseed(seed);
  },
  setRandomizerMode(nextMode,seed){
    const parsedSeed=seed!==undefined?parseSeedParam(seed):undefined;
    const appliedMode=pieceRandomizer.setMode(nextMode,typeof parsedSeed==='number'?parsedSeed:undefined);
    rngSeed=pieceRandomizer.seed;
    pieceQueue.length=0;
    nextM=null;
    syncRandomizerUrl();
    updateHudQueue();
    return appliedMode;
  },
  setDailySeedMode(enabled){
    return setDailySeedMode(enabled);
  },
  start(){
    if(over) return false;
    if(!started){
      started=true;
      const replayApi=globalScope?.Replay;
      if(mode==='play' && replayApi && typeof replayApi.start==='function') replayApi.start(rngSeed);
      lastFrame=0;
      gravityTimer=0;
      softDropTimer=0;
      runStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      gameOverSent = false;
      gameEvent('play', { slug: GAME_ID });
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
    return resetGameState();
  },
  onReady: registerReadyCallback,
  offReady(callback){ readyCallbacks.delete(callback); },
};

globalScope.Tetris=TetrisAPI;
notifyDiagnosticsListeners();

function createPieceFromType(type){
  const key=(type&&SHAPES[type])?type:'I';
  return { m:SHAPES[key].map(r=>r.slice()), t:key };
}

function drawNextType(){
  if(mode==='replay'){
    const t=Replay.nextPiece();
    return (t&&SHAPES[t])?t:'I';
  }
  const t=pieceRandomizer.next();
  return (t&&SHAPES[t])?t:'I';
}

function ensurePieceQueueSize(size=PREVIEW_COUNT+1){
  const target=Math.max(PREVIEW_COUNT+1,size);
  while(pieceQueue.length<target){
    pieceQueue.push(drawNextType());
  }
}

function takeNextType(){
  ensurePieceQueueSize();
  const type=pieceQueue.shift();
  ensurePieceQueueSize();
  return type;
}

function syncScoreDisplay(){
  if(!scoreDisplay) return;
  scoreDisplay.textContent=String(score);
  scoreDisplay.dataset.gameScore=String(score); // Surface score for shell integration.
}

function updateDailyHud(){
  if(hud && typeof hud.setDaily==='function'){
    hud.setDaily({ active: dailySeedActive, label: dailySeedLabel });
  }
}

function getComboCount(){
  return combo>=0?combo+1:0;
}

function updateHudStats(){
  if(!hud) return;
  hud.setStats({ score, level, lines });
  hud.setCombo(getComboCount());
  hud.setBackToBack(backToBack);
}

function updateHudHold(){
  if(!hud) return;
  const piece=holdM?.t ?? null;
  hud.setHold({ piece, canHold });
}

function previewTypes(count=PREVIEW_COUNT){
  ensurePieceQueueSize(count);
  return pieceQueue.slice(0,count);
}

function updateHudQueue(){
  if(!hud) return;
  hud.setNext(previewTypes());
  updateHudHold();
}

syncScoreDisplay();
hud=createHud({
  onToggleDailySeed(enabled){
    setDailySeedMode(enabled);
  },
});
updateDailyHud();
updateHudStats();
updateHudHold();
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
      grid=importGrid(data.grid);
      ({cur,nextM,holdM,score,level,lines,over,paused,started,showGhost}=data);
      if(typeof data.combo==='number') combo=data.combo;
      if(typeof data.randomizerMode==='string' && data.randomizerMode){
        const normalizedMode=data.randomizerMode;
        if(pieceRandomizer.mode!==normalizedMode){
          pieceRandomizer.setMode(normalizedMode, data.seed);
        }else if(Number.isInteger(data.seed)){
          pieceRandomizer.reset(data.seed);
        }
      }else if(Number.isInteger(data.seed)){
        pieceRandomizer.reset(data.seed);
      }
      rngSeed=Number.isInteger(data.seed)?(data.seed>>>0):pieceRandomizer.seed;
      syncScoreDisplay();
      updateGhost();
    }
  };
}
let lockTimer=0;
let lockResetCount=0;
let lastFrame=0;
let gravityTimer=0;
let softDropTimer=0;
let shellPaused=false;
let pausedByShell=false;
let rafId=0;
const clearPipeline=[];
const clearingRows=new Set();

function initGame(){
  resetParallax();
  pieceQueue.length=0;
  ensurePieceQueueSize();
  cur=spawn();
  lastRotationInfo=null;
  updateGhost();
  updateHudQueue();
  updateHudStats();
}

function resetGameState({ preserveSeed=false }={}){
  stopGameLoop();
  grid=createGrid();
  if(!preserveSeed){
    reseed();
  }else{
    pieceQueue.length=0;
    nextM=null;
  }
  scoringSystem.reset();
  score=0;
  level=1;
  lines=0;
  combo=-1;
  backToBack=false;
  holdM=null;
  canHold=true;
  over=false;
  started=false;
  paused=false;
  shellPaused=false;
  pausedByShell=false;
  lockTimer=0;
  lockResetCount=0;
  clearPipeline.length=0;
  clearingRows.clear();
  lastFrame=0;
  gravityTimer=0;
  softDropTimer=0;
  dropMs=700;
  lastRotationInfo=null;
  initGame();
  syncScoreDisplay();
  updateGhost();
  updateHudStats();
  updateDailyHud();
  runStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  gameOverSent = false;
  lastComboEmitted = -1;
  return true;
}

function spawn(){
  ensurePieceQueueSize();
  const type=takeNextType();
  const piece=createPieceFromType(type);
  if(mode==='play') Replay.recordPiece(piece.t);
  nextM=pieceQueue[0]?createPieceFromType(pieceQueue[0]):null;
  updateHudQueue();
  return {m:piece.m.map(r=>r.slice()), x:3, y:0, t:piece.t, o:0};
}
function collide(p){
  for(let y=0;y<p.m.length;y++){
    for(let x=0;x<p.m[y].length;x++){
      if(!p.m[y][x]) continue;
      const nx=p.x+x;
      const ny=p.y+y;
      if(nx<0||nx>=COLS||ny>=ROWS) return true;
      if(getGridCell(grid,nx,ny)) return true;
    }
  }
  return false;
}
function merge(p){
  for(let y=0;y<p.m.length;y++){
    for(let x=0;x<p.m[y].length;x++){
      if(p.m[y][x]) setGridCell(grid,p.x+x,p.y+y,p.m[y][x]);
    }
  }
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

function refreshClearingRows(){
  clearingRows.clear();
  if(!clearPipeline.length) return;
  const active=clearPipeline[0];
  for(const row of active.rows) clearingRows.add(row);
}

function queueLineClear(rows){
  if(!rows?.length) return;
  const sorted=[...rows].sort((a,b)=>a-b);
  clearPipeline.push({ rows:sorted, stage:0, timer:CLEAR_STAGE_SPLIT[0] });
  refreshClearingRows();
}

function clearLines(){
  const rows=[];
  for(let y=0;y<ROWS;y++){
    let filled=true;
    for(let x=0;x<COLS;x++){
      if(!getGridCell(grid,x,y)){ filled=false; break; }
    }
    if(filled) rows.push(y);
  }
  if(rows.length) queueLineClear(rows);
  return rows;
}

function isClearing(){
  return clearPipeline.length>0;
}

function lockPiece(soft=0,hard=0){
  const lockedPiece=clonePiece(cur);
  merge(cur);
  const clearedRows=clearLines();
  const cleared=clearedRows.length;
  const tspinResult=detectTSpin({
    piece: lockedPiece,
    grid: { get: (x,y)=>getGridCell(grid,x,y) },
    lastRotation: lastRotationInfo,
    clearedLines: cleared,
    bounds: { cols: COLS, rows: ROWS },
  });
  const scoringResult=scoringSystem.scoreLock({
    linesCleared: cleared,
    tspin: tspinResult,
    softDrop: soft,
    hardDrop: hard,
  });
  score=scoringResult.score;
  combo=scoringResult.combo;
  backToBack=scoringResult.backToBack;
  syncScoreDisplay();
  const comboCount=getComboCount();
  if(cleared>0){
    if(comboCount>1 && combo!==lastComboEmitted){
      lastComboEmitted=combo;
      gameEvent('combo', {
        slug: GAME_ID,
        count: comboCount,
        meta: {
          cleared,
          level,
        },
      });
    }else if(comboCount<=1){
      lastComboEmitted=-1;
    }
  }else{
    lastComboEmitted=-1;
  }
  if(cleared>0){
    gameEvent('score', {
      slug: GAME_ID,
      value: score,
      delta: scoringResult.points,
      meta: {
        lines: lines + cleared,
        combo: combo,
        cleared,
        level,
        clearType: scoringResult.clearType,
        tspin: tspinResult.type,
      },
    });
  }
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
    emitLineClearEffects(clearedRows);
    playSound('explode');
  }
  if(leveledUp) playSound('power');
  if(leveledUp){
    gameEvent('level_up', {
      slug: GAME_ID,
      level,
      meta: {
        lines,
      },
    });
  }
  if(scoringResult.b2bJustAwarded && cleared===4){
    gameEvent('score_event', {
      slug: GAME_ID,
      name: 'b2b_tetris',
    });
  }
  if(tspinResult.type==='full' && tspinResult.lines===2){
    gameEvent('score_event', {
      slug: GAME_ID,
      name: 'tspin_double',
    });
  }
  updateHudStats();
  lastRotationInfo=null;
  lockResetCount=0;
}

function triggerGameOver(){
  if(over) return;
  over=true;
  updateBest();
  GG.addAch(GAME_ID,'Stacked');
  if(!gameOverSent){
    gameOverSent=true;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const durationMs = Math.max(0, Math.round(now - (runStartTime || now)));
    const meta = { lines, level };
    gameEvent('game_over', {
      slug: GAME_ID,
      value: score,
      durationMs,
      meta,
    });
    gameEvent('lose', {
      slug: GAME_ID,
      meta,
    });
  }
  if(mode==='play'){
    Replay.stop();
    Replay.download('tetris-replay-'+Date.now()+'.json');
  }
}

function onPieceMoved(){
  const touching=collide({...cur,y:cur.y+1});
  if(touching){
    if(lockResetCount<LOCK_RESET_LIMIT){
      lockTimer=0;
      lockResetCount++;
    }
  }else{
    lockTimer=0;
    lockResetCount=0;
  }
  updateGhost();
}

function spawnNextPiece(){
  cur=spawn();
  lastRotationInfo=null;
  canHold=true;
  updateHudHold();
  lockTimer=0;
  lockResetCount=0;
  gravityTimer=0;
  softDropTimer=0;
  updateGhost();
  if(collide(cur)){
    triggerGameOver();
  }
}

function drawCell(x,y,v,cell){
  if(!v) return;
  const alpha=clearingRows.has(y)?0.6:1;
  drawTileValue(v,x*cell,y*cell,cell,alpha,{shadow:false});
}
function drawPieceCell(x,y,v,cell,alpha=1){
  drawTileValue(v,x*cell,y*cell,cell,alpha,{shadow:true});
}
function drawMatrix(m,ox,oy,cell){
  const previewCell=cell*0.8;
  for(let y=0;y<m.length;y++)
    for(let x=0;x<m[y].length;x++){
      if(!m[y][x]) continue;
      drawTileValue(m[y][x],ox+x*previewCell,oy+y*previewCell,previewCell-2,1,{shadow:false});
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
      if(ghost.m[y][x]) drawTileValue(ghost.m[y][x],(ghost.x+x)*cell,(ghost.y+y)*cell,cell,0.6,{shadow:false,ghost:true});
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
    for(let x=0;x<COLS;x++) drawCell(x,y,getGridCell(grid,x,y),cell);
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
  const comboCount=getComboCount();
  if(comboCount>0) ctx.fillText(`Combo x${comboCount}`,8,80);
  if(backToBack) ctx.fillText('B2B READY',8,100);
  const ox=COLS*cell+16;
  ctx.fillText('NEXT',ox,20);
  ensurePieceQueueSize();
  const previewSpacing=Math.max(cell*2.8,48);
  pieceQueue.slice(0,PREVIEW_COUNT).forEach((type,index)=>{
    const previewPiece=createPieceFromType(type);
    drawMatrix(previewPiece.m,ox,30+index*previewSpacing,cell);
  });
  const holdLabelY=30+previewSpacing*PREVIEW_COUNT+10;
  ctx.fillText('HOLD (C)',ox,holdLabelY);
  if(holdM){
    drawMatrix(holdM.m,ox,holdLabelY+10,cell);
  }

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
  if(manual) GG.addXP(1);
  if(collide(cur)){
    cur.y--;
    lockPiece(manual?1:0,0);
    spawnNextPiece();
    return 'lock';
  }
  if(manual){
    scoringSystem.addDropPoints(1,0);
    score=scoringSystem.score;
    updateBest();
    syncScoreDisplay();
    updateHudStats();
  }
  gravityTimer=0;
  onPieceMoved();
  return 'move';
}

function hardDrop(){
  let dist=0;
  while(true){
    const nextPos={...cur,y:cur.y+1};
    if(collide(nextPos)) break;
    cur.y=nextPos.y;
    dist++;
  }
  if(dist>0){
    gravityTimer=0;
  }
  lockPiece(0,dist);
  spawnNextPiece();
  updateBest();
  return true;
}

function hold(){
  if(!canHold) return false;
  const temp=holdM;
  holdM={m:cur.m.map(r=>r.slice()),t:cur.t};
  if(temp){
    cur={m:temp.m.map(r=>r.slice()),x:3,y:0,t:temp.t,o:0};
  } else {
    cur=spawn();
  }
  canHold=false;
  lastRotationInfo=null;
  lockTimer=0;
  lockResetCount=0;
  gravityTimer=0;
  softDropTimer=0;
  updateGhost();
  if(collide(cur)) triggerGameOver();
  updateHudHold();
  return true;
}

function attemptShift(dx){
  const candidate={...cur,x:cur.x+dx};
  if(collide(candidate)) return false;
  cur.x=candidate.x;
  onPieceMoved();
  return true;
}

function attemptRotate(dir=1){
  const result=TetrisEngine.rotateDetailed(cur,rotationGrid,dir);
  const cand=result?.piece;
  if(cand && cand!==cur){
    const previous={ x:cur.x, y:cur.y, o:cur.o };
    cur=cand;
    playSound('click');
    onPieceMoved();
    lastRotationInfo={
      from: previous.o,
      to: cur.o,
      kickIndex: Number.isInteger(result?.kickIndex)?result.kickIndex:-1,
      kicked: !!result?.kicked,
      offsetX: cur.x-previous.x,
      offsetY: cur.y-previous.y,
    };
    return true;
  }
  return false;
}

function executeAction(action,{record=true}={}){
  let result=false;
  switch(action){
    case 'left':
      result=attemptShift(-1);
      break;
    case 'right':
      result=attemptShift(1);
      break;
    case 'rotate':
      result=attemptRotate(1);
      break;
    case 'down': {
      const outcome=drop(true);
      result=outcome==='move'||outcome==='lock';
      break;
    }
    case 'hardDrop':
      result=hardDrop();
      break;
    case 'hold':
      result=hold();
      break;
    default:
      result=false;
  }
  if(record && result && mode==='play') Replay.recordAction(action);
  return result;
}

function activeHorizontalDirection(){
  if(moveState.left.active && moveState.right.active){
    return moveState.lastDir==='right'?'right':'left';
  }
  if(moveState.left.active) return 'left';
  if(moveState.right.active) return 'right';
  return null;
}

function updateHorizontalMovement(dt){
  const dir=activeHorizontalDirection();
  if(!dir) return;
  const state=moveState[dir];
  if(state.das>0){
    state.das=Math.max(0,state.das-dt);
    if(state.das===0){
      executeAction(dir,{record:mode==='play'});
      state.arr=0;
    }
    return;
  }
  const interval=Math.max(MOVE_ARR,0.001);
  state.arr+=dt;
  while(state.arr>=interval){
    const moved=executeAction(dir,{record:mode==='play'});
    state.arr-=interval;
    if(state.arr<0) state.arr=0;
    if(!moved) break;
    if(MOVE_ARR<=0){
      state.arr=0;
      break;
    }
  }
}

function updateSoftDrop(dt){
  if(!moveState.down.active) return;
  const baseInterval=Math.max(dropMs/1000,0.01);
  const interval=Math.max(baseInterval/SOFT_DROP_FACTOR,0.01);
  softDropTimer+=dt;
  while(softDropTimer>=interval){
    const moved=executeAction('down',{record:mode==='play'});
    softDropTimer-=interval;
    if(softDropTimer<0) softDropTimer=0;
    if(!moved) break;
  }
}

addEventListener('keydown',e=>{
  const key=e.key||'';
  const keyLower=key.toLowerCase();
  const preventKeys=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ']);
  if(e.code==='Space' || preventKeys.has(key) || key==='Spacebar'){
    e.preventDefault();
  }
  if((key.startsWith('Arrow') || key==='Spacebar' || e.code==='Space') && e.repeat) return;
  if(keyLower==='g'){
    showGhost=!showGhost;
    localStorage.setItem('tetris:ghost',showGhost?'1':'0');
    updateGhost();
    return;
  }
  if(mode!=='play') return;
  if(!started){
    if(e.code==='Space'){ started=true; Replay.start(rngSeed); return; }
    return;
  }
  if(over && keyLower==='r'){
    grid=createGrid();
    reseed(createSeed());
    initGame();
    score=0; level=1; lines=0; holdM=null; canHold=true;
    syncScoreDisplay();
    over=false; started=false;
    updateGhost();
    return;
  }
  if(keyLower==='p'){ paused=!paused; return; }
  if(paused || over || isClearing()) return;

  if(key==='ArrowLeft'){
    moveState.left.active=true;
    moveState.left.das=MOVE_DAS;
    moveState.left.arr=0;
    moveState.lastDir='left';
    executeAction('left');
    return;
  }
  if(key==='ArrowRight'){
    moveState.right.active=true;
    moveState.right.das=MOVE_DAS;
    moveState.right.arr=0;
    moveState.lastDir='right';
    executeAction('right');
    return;
  }
  if(key==='ArrowDown'){
    moveState.down.active=true;
    softDropTimer=0;
    executeAction('down');
    return;
  }
  if(key==='ArrowUp'){
    executeAction('rotate');
    return;
  }
  if(e.code==='Space'){
    executeAction('hardDrop');
    return;
  }
  if(keyLower==='c'){
    executeAction('hold');
  }
});

addEventListener('keyup',e=>{
  const key=e.key||'';
  if(key==='ArrowLeft'){
    moveState.left.active=false;
    moveState.left.das=0;
    moveState.left.arr=0;
    if(moveState.right.active) moveState.lastDir='right';
  }
  if(key==='ArrowRight'){
    moveState.right.active=false;
    moveState.right.das=0;
    moveState.right.arr=0;
    if(moveState.left.active) moveState.lastDir='left';
  }
  if(key==='ArrowDown'){
    moveState.down.active=false;
    softDropTimer=0;
  }
});


let touchX=null,touchY=null;
function handleAction(a){
  if(mode!=='play' || paused || over || isClearing()) return;
  executeAction(a);
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
  if(!lastFrame) lastFrame=ts;
  const dt=Math.min((ts-lastFrame)/1000,0.05);
  lastFrame=ts;

  if(mode==='replay' && started && !paused && !over){
    const acts=Replay.tick(dt);
    acts.forEach(a=>executeAction(a,{record:false}));
  }

  const canUpdate=mode!=='spectate' && started && !paused && !over;
  const clearing=isClearing();

  if(canUpdate){
    if(!clearing){
      updateHorizontalMovement(dt);
      updateSoftDrop(dt);
      const baseInterval=Math.max(dropMs/1000,0.01);
      gravityTimer+=dt;
      while(gravityTimer>=baseInterval){
        const outcome=drop(false);
        if(outcome==='lock'){
          gravityTimer=0;
          break;
        }
        gravityTimer-=baseInterval;
      }
      const touching=collide({...cur,y:cur.y+1});
      if(touching){
        lockTimer+=dt;
        if(lockTimer>=LOCK_DELAY){
          lockPiece();
          spawnNextPiece();
          lockTimer=0;
        }
      }else{
        lockTimer=0;
      }
    }else{
      gravityTimer=0;
      softDropTimer=0;
      lockTimer=0;
    }
  }
  updateParallax(dt);
  updateEffects(dt);
  updateClearState(dt);
  ctx.clearRect(0,0,c.width,c.height);
  draw();
  if(bc && mode==='play'){
    const payload={
      grid:cloneGrid(grid),
      cur,
      nextM,
      holdM,
      score,
      level,
      lines,
      over,
      paused,
      started,
      showGhost,
      combo,
      backToBack,
      queue: pieceQueue.slice(0,PREVIEW_COUNT).map(t=>({ t })),
      seed:rngSeed,
      randomizerMode:pieceRandomizer.mode,
      dailySeedActive,
      dailySeedLabel,
    };
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
    lastFrame=0;
    gravityTimer=0;
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
