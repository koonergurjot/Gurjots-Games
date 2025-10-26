import { GameEngine } from '../../shared/gameEngine.js';
import { getLevel } from './levels.js';
import { initHud, updateHudStatus, updateHudPowerups, updateMissionHud } from './ui.js';
import { PowerUpEngine, getPowerUpDefinition, selectPowerUp, POWERUP_DEFINITIONS } from './powerups.js';
import { installErrorReporter } from '../../shared/debug/error-reporter.js';
import { showToast, showModal, clearHud } from '../../shared/ui/hud.js';
import { preloadFirstFrameAssets } from '../../shared/game-asset-preloader.js';
import { loadImage, getCachedImage } from '../../shared/assets.js';
import { play as playSfx } from '../../shared/juice/audio.js';
import { gameEvent } from '../../shared/telemetry.js';

const globalScope = typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : undefined);

const getLeaderboardPromise = (() => {
  let memoised = null;
  return () => {
    if (memoised) return memoised;
    if (typeof window === 'undefined') return null;
    const candidate = window.LB;
    if (!candidate) return null;
    memoised = typeof candidate.then === 'function' ? candidate : Promise.resolve(candidate);
    return memoised;
  };
})();

let leaderboardFailureToastTimer = null;

function notifyLeaderboardFailure(error){
  if (error) {
    try {
      console.warn('[breakout] leaderboard submission failed', error);
    } catch (_) {
      /* noop */
    }
  }
  if (leaderboardFailureToastTimer) {
    return;
  }
  try {
    showToast('Score saved locally. Reconnect to submit online.', { duration: 4200 });
  } catch (_) {
    /* noop */
  }
  leaderboardFailureToastTimer = setTimeout(() => {
    leaderboardFailureToastTimer = null;
  }, 4500);
}

async function submitLeaderboardScore(score){
  const promise = getLeaderboardPromise();
  if (!promise) {
    notifyLeaderboardFailure();
    return;
  }
  try {
    const client = await promise;
    if (client && typeof client.submitScore === 'function') {
      await client.submitScore(GAME_ID, score);
    } else {
      notifyLeaderboardFailure();
    }
  } catch (error) {
    notifyLeaderboardFailure(error);
  }
}

if(typeof CanvasRenderingContext2D!=='undefined' && typeof CanvasRenderingContext2D.prototype.drawImage!=='function'){
  CanvasRenderingContext2D.prototype.drawImage=function drawImageStub(){ return undefined; };
}

if(typeof HTMLCanvasElement!=='undefined'&&typeof HTMLCanvasElement.prototype.getContext==='function'){
  const originalGetContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function patchedGetContext(type,...rest){
    const context=originalGetContext.call(this,type,...rest);
    if(context&&typeof context.drawImage!=='function'){
      context.drawImage=function drawImageFallback(){ return undefined; };
    }
    return context;
  };
}

if(typeof OffscreenCanvas!=='undefined'&&typeof OffscreenCanvas.prototype.getContext==='function'){
  const originalOffscreenGetContext=OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext=function patchedOffscreenGetContext(type,...rest){
    const context=originalOffscreenGetContext.call(this,type,...rest);
    if(context&&typeof context.drawImage!=='function'){
      context.drawImage=function drawImageFallback(){ return undefined; };
    }
    return context;
  };
}

const breakoutReadyQueue = (() => {
  if (!globalScope) return [];
  if (Array.isArray(globalScope.__BREAKOUT_READY__)) return globalScope.__BREAKOUT_READY__;
  const queue = [];
  globalScope.__BREAKOUT_READY__ = queue;
  return queue;
})();

window.fitCanvasToParent = window.fitCanvasToParent || function(){ /* no-op fallback */ };

const BASE_W=1000;
const BASE_H=800;

const LOGICAL_WIDTH=BASE_W;
const LOGICAL_HEIGHT=BASE_H;
let canvasScale=1;

const GAME_ID='breakout';GG.incPlays();
preloadFirstFrameAssets(GAME_ID).catch(()=>{});

const SPRITE_SOURCES={
  paddle:'/assets/sprites/paddle.png',
  ball:'/assets/sprites/ball.png'
};

const PATTERN_SOURCES={
  brick:'/assets/breakout/brick.svg'
};

const BRICK_TILESET={
  size:16,
  variants:[
    {row:4,col:0},
    {row:4,col:4},
    {row:4,col:8},
    {row:4,col:12}
  ]
};

const BRICK_BASE_COLORS=['#a78bfa','#f97316','#38bdf8','#f472b6'];

const BRICK_PADDING_X=20;
const BRICK_TOP=60;
const BRICK_SPACING=8;
const BRICK_ROW_HEIGHT=26;
const BRICK_HEIGHT=20;
const BRICK_HIT_FLASH_DURATION=0.16;

const markFirstFrame = (() => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    try {
      window.ggFirstFrame?.();
    } catch (_) {
      /* noop */
    }
  };
})();

function createBrickSurfaceStyle(){
  const highlightRatio=clamp01(0.16+Math.random()*0.18);
  const highlightAlpha=0.18+Math.random()*0.16;
  const shadowAlpha=0.12+Math.random()*0.14;
  const wedgeWidth=0.32+Math.random()*0.26;
  const wedgeDepth=0.48+Math.random()*0.28;
  const wedgeAlpha=0.05+Math.random()*0.08;
  const cracks=[];
  if(Math.random()<0.38){
    const crackCount=1+Math.floor(Math.random()*3);
    for(let i=0;i<crackCount;i++){
      const startX=clamp01(0.12+Math.random()*0.76);
      const startY=clamp01(0.18+Math.random()*0.64);
      const length=0.18+Math.random()*0.38;
      const angle=-0.5+Math.random()*1.0;
      const endX=clamp01(startX+Math.cos(angle)*length);
      const endY=clamp01(startY+Math.sin(angle)*length);
      cracks.push({
        x1:startX,
        y1:startY,
        x2:endX,
        y2:endY,
        width:0.6+Math.random()*0.9,
        alpha:0.18+Math.random()*0.18
      });
    }
  }
  let emissive=null;
  if(Math.random()<0.32){
    emissive={
      y:clamp01(0.25+Math.random()*0.5),
      thickness:0.07+Math.random()*0.12,
      alpha:0.18+Math.random()*0.16
    };
  }
  return {
    highlightRatio,
    highlightAlpha,
    shadowAlpha,
    wedgeWidth,
    wedgeDepth,
    wedgeAlpha,
    cracks,
    emissive,
    flip:Math.random()<0.5?-1:1
  };
}

function normaliseColor(value){
  if(typeof value!=='string')return null;
  const trimmed=value.trim();
  return trimmed.length?trimmed:null;
}

function getBrickBaseColor(brick){
  const materialColor=normaliseColor(brick?.material?.color);
  if(materialColor)return materialColor;
  const palette=BRICK_BASE_COLORS;
  const variantIndex=Number.isFinite(brick?.variant)?Math.abs(Math.round(brick.variant)):0;
  if(palette.length){
    return palette[variantIndex%palette.length];
  }
  return '#a78bfa';
}

function drawBrickSheen(context,brick){
  if(!brick.surfaceStyle){brick.surfaceStyle=createBrickSurfaceStyle();}
  const style=brick.surfaceStyle;
  const highlightRatio=clamp01(style?.highlightRatio ?? 0.25);
  const highlightHeight=Math.max(1,brick.h*highlightRatio);
  if(highlightHeight>0){
    const highlightGradient=context.createLinearGradient(brick.x,brick.y,brick.x,brick.y+highlightHeight);
    const highlightAlpha=Math.max(0,Math.min(1,style?.highlightAlpha ?? 0.24));
    highlightGradient.addColorStop(0,`rgba(255,255,255,${highlightAlpha})`);
    highlightGradient.addColorStop(1,'rgba(255,255,255,0)');
    context.fillStyle=highlightGradient;
    context.fillRect(brick.x,brick.y,brick.w,highlightHeight);
  }
  const shadowStart=brick.y+brick.h*Math.max(0.32,highlightRatio*0.9);
  const shadowEnd=brick.y+brick.h;
  const shadowHeight=Math.max(0,shadowEnd-shadowStart);
  if(shadowHeight>0){
    const shadowGradient=context.createLinearGradient(brick.x,shadowStart,brick.x,shadowEnd);
    const shadowAlpha=Math.max(0,Math.min(0.32,style?.shadowAlpha ?? 0.22));
    shadowGradient.addColorStop(0,'rgba(0,0,0,0)');
    shadowGradient.addColorStop(1,`rgba(0,0,0,${shadowAlpha})`);
    context.fillStyle=shadowGradient;
    context.fillRect(brick.x,shadowStart,brick.w,shadowHeight);
  }
  const wedgeWidth=Math.max(1,brick.w*(style?.wedgeWidth ?? 0.4));
  const wedgeDepth=Math.max(1,brick.h*(style?.wedgeDepth ?? 0.55));
  const wedgeAlpha=Math.max(0,Math.min(1,style?.wedgeAlpha ?? 0.08));
  context.save();
  context.beginPath();
  if(style?.flip<0){
    context.moveTo(brick.x+brick.w,brick.y);
    context.lineTo(brick.x+brick.w-wedgeWidth,brick.y);
    context.lineTo(brick.x+brick.w-brick.w*0.35,brick.y+wedgeDepth);
  }else{
    context.moveTo(brick.x,brick.y);
    context.lineTo(brick.x+wedgeWidth,brick.y);
    context.lineTo(brick.x+brick.w*0.35,brick.y+wedgeDepth);
  }
  context.closePath();
  context.clip();
  context.fillStyle=`rgba(255,255,255,${wedgeAlpha})`;
  context.fillRect(brick.x,brick.y,brick.w,brick.h);
  context.restore();
  if(Array.isArray(style?.cracks)&&style.cracks.length){
    context.save();
    context.lineCap='round';
    context.lineJoin='round';
    for(const crack of style.cracks){
      const alpha=Math.max(0,Math.min(1,crack.alpha ?? 0.25));
      const width=Math.max(0.6,crack.width ?? 1);
      context.strokeStyle=`rgba(12,18,32,${alpha})`;
      context.lineWidth=width;
      context.beginPath();
      context.moveTo(brick.x+brick.w*clamp01(crack.x1),brick.y+brick.h*clamp01(crack.y1));
      context.lineTo(brick.x+brick.w*clamp01(crack.x2),brick.y+brick.h*clamp01(crack.y2));
      context.stroke();
    }
    context.restore();
  }
  if(style?.emissive){
    const emissive=style.emissive;
    const baseColor=normaliseColor(getBrickBaseColor(brick))||'#aab4ff';
    const rgb=hexToRgb(baseColor);
    const bandY=brick.y+brick.h*clamp01(emissive.y ?? 0.5);
    const thickness=Math.max(1,brick.h*(emissive.thickness ?? 0.1));
    const alpha=Math.max(0,Math.min(1,emissive.alpha ?? 0.22));
    const bright=`rgba(${Math.min(255,rgb.r+80)},${Math.min(255,rgb.g+80)},${Math.min(255,rgb.b+80)},0)`;
    const core=`rgba(${Math.min(255,rgb.r+110)},${Math.min(255,rgb.g+110)},${Math.min(255,rgb.b+110)},${alpha})`;
    context.save();
    context.globalCompositeOperation='lighter';
    const gradient=context.createLinearGradient(brick.x,bandY-thickness/2,brick.x,bandY+thickness/2);
    gradient.addColorStop(0,bright);
    gradient.addColorStop(0.5,core);
    gradient.addColorStop(1,bright);
    context.fillStyle=gradient;
    context.fillRect(brick.x,bandY-thickness/2,brick.w,thickness);
    context.restore();
  }
}

function drawBrickHitFlash(context,brick){
  const remaining=brick?.flashTimer||0;
  if(!(remaining>0)) return;
  const baseColor=normaliseColor(getBrickBaseColor(brick))||'#aab4ff';
  const rgb=hexToRgb(baseColor);
  const duration=Math.max(1e-3,BRICK_HIT_FLASH_DURATION);
  const progress=Math.max(0,Math.min(1,remaining/duration));
  const boost=Math.pow(progress,0.55);
  const r=Math.min(255,rgb.r+160);
  const g=Math.min(255,rgb.g+160);
  const b=Math.min(255,rgb.b+160);
  context.save();
  context.globalCompositeOperation='lighter';
  context.globalAlpha=0.45+0.35*boost;
  context.fillStyle=`rgb(${r},${g},${b})`;
  context.fillRect(brick.x,brick.y,brick.w,brick.h);
  context.restore();
}

function drawPaddleSheen(context,paddleRect){
  if(!context||!paddleRect)return;
  const {x,y,w,h}=paddleRect;
  if(!(w>0&&h>0))return;
  context.save();
  const vertical=context.createLinearGradient(x,y,x,y+h);
  vertical.addColorStop(0,'rgba(255,255,255,0.38)');
  vertical.addColorStop(0.5,'rgba(255,255,255,0.12)');
  vertical.addColorStop(1,'rgba(255,255,255,0)');
  context.globalCompositeOperation='lighter';
  context.fillStyle=vertical;
  context.fillRect(x,y,w,h);
  const sweep=context.createLinearGradient(x,y,x+w,y+h);
  sweep.addColorStop(0,'rgba(255,255,255,0)');
  sweep.addColorStop(0.5,'rgba(255,255,255,0.22)');
  sweep.addColorStop(1,'rgba(255,255,255,0)');
  context.globalCompositeOperation='screen';
  context.globalAlpha=0.55;
  context.beginPath();
  context.moveTo(x+w*0.1,y+1);
  context.lineTo(x+w*0.78,y+1);
  context.lineTo(x+w*0.58,y+h-1);
  context.lineTo(x+w*0.02,y+h-1);
  context.closePath();
  context.fillStyle=sweep;
  context.fill();
  context.restore();
}

const EFFECT_SOURCES={
  spark:'/assets/effects/spark.png',
  explosion:'/assets/effects/explosion.png'
};

const POWERUP_SPRITES=new Map();
for(const def of POWERUP_DEFINITIONS){
  if(!def||!def.id)continue;
  const entries=Array.isArray(def.sprites)?def.sprites.map(src=>typeof src==='string'?src.trim():'').filter(Boolean):[];
  if(entries.length){
    POWERUP_SPRITES.set(def.id,entries);
  }
}

const pendingImages=new Set();
const spriteImages={};
const effectImages={};
const powerupImages={};
const patternImages={};
const powerupCompositeCache=new Map();
const brickPatternCache=new Map();

const PARALLAX_CONFIG=[
  {key:'layer1',src:'/assets/backgrounds/parallax/arcade_layer1.png',speed:28,alpha:0.85},
  {key:'layer2',src:'/assets/backgrounds/parallax/arcade_layer2.png',speed:56,alpha:1}
];
const parallaxImages={};
const parallaxLayers=PARALLAX_CONFIG.map(cfg=>({
  key:cfg.key,
  src:cfg.src,
  speed:cfg.speed,
  alpha:typeof cfg.alpha==='number'?Math.max(0,Math.min(1,cfg.alpha)):1,
  offset:0,
  image:null,
  width:0,
  height:0
}));

const PARALLAX_PALETTES={
  default:{
    layer1:{color:'#13203f',alpha:0.55},
    layer2:{color:'#1e2a4f',alpha:0.65}
  },
  boss:{
    layer1:{color:'#f97316',alpha:0.6},
    layer2:{color:'#f43f5e',alpha:0.75}
  },
  laser:{
    layer1:{color:'#ef4444',alpha:0.65},
    layer2:{color:'#22d3ee',alpha:0.7}
  },
  multi:{
    layer1:{color:'#a855f7',alpha:0.65},
    layer2:{color:'#38bdf8',alpha:0.65}
  },
  slow:{
    layer1:{color:'#38bdf8',alpha:0.5},
    layer2:{color:'#0ea5e9',alpha:0.6}
  },
  sticky:{
    layer1:{color:'#facc15',alpha:0.6},
    layer2:{color:'#fb923c',alpha:0.65}
  },
  shrink:{
    layer1:{color:'#0ea5e9',alpha:0.55},
    layer2:{color:'#6366f1',alpha:0.65}
  },
  combo:{
    layer1:{color:'#14f195',alpha:0.6},
    layer2:{color:'#facc15',alpha:0.7}
  },
  boost:{
    layer1:{color:'#fbbf24',alpha:0.55},
    layer2:{color:'#34d399',alpha:0.6}
  }
};

function hexToRgb(hex){
  if(typeof hex!=='string')return {r:0,g:0,b:0};
  const normalised=hex.trim().replace(/^#/, '');
  if(normalised.length===3){
    const r=parseInt(normalised[0]+normalised[0],16);
    const g=parseInt(normalised[1]+normalised[1],16);
    const b=parseInt(normalised[2]+normalised[2],16);
    if(Number.isNaN(r)||Number.isNaN(g)||Number.isNaN(b))return {r:0,g:0,b:0};
    return {r,g,b};
  }
  if(normalised.length===6){
    const r=parseInt(normalised.slice(0,2),16);
    const g=parseInt(normalised.slice(2,4),16);
    const b=parseInt(normalised.slice(4,6),16);
    if(Number.isNaN(r)||Number.isNaN(g)||Number.isNaN(b))return {r:0,g:0,b:0};
    return {r,g,b};
  }
  return {r:0,g:0,b:0};
}

function normaliseTint(entry){
  if(!entry)return {r:0,g:0,b:0,alpha:0};
  if(typeof entry==='string'){
    const rgb=hexToRgb(entry);
    return {r:rgb.r,g:rgb.g,b:rgb.b,alpha:0.6};
  }
  const rgb=hexToRgb(entry.color||'#000');
  const alpha=typeof entry.alpha==='number'?Math.max(0,Math.min(1,entry.alpha)):0.6;
  return {r:rgb.r,g:rgb.g,b:rgb.b,alpha};
}

function cloneTint(tint){
  return {r:tint?.r||0,g:tint?.g||0,b:tint?.b||0,alpha:typeof tint?.alpha==='number'?tint.alpha:0};
}

function clamp01(value){
  return Math.max(0,Math.min(1,value));
}

function lerp(a,b,t){
  return a+(b-a)*t;
}

function mixTints(fromTint,toTint,t){
  const a=cloneTint(fromTint);
  const b=cloneTint(toTint);
  const progress=Math.max(0,Math.min(1,t));
  return {
    r:lerp(a.r,b.r,progress),
    g:lerp(a.g,b.g,progress),
    b:lerp(a.b,b.b,progress),
    alpha:lerp(a.alpha,b.alpha,progress)
  };
}

function tintToCss(tint){
  const safe=cloneTint(tint);
  return `rgb(${safe.r.toFixed(0)},${safe.g.toFixed(0)},${safe.b.toFixed(0)})`;
}

function normalisePalette(def){
  const base=def&&typeof def==='object'?def:PARALLAX_PALETTES.default;
  return {
    layer1:normaliseTint(base.layer1||base.layerOne||'#000'),
    layer2:normaliseTint(base.layer2||base.layerTwo||'#000')
  };
}

const parallaxPaletteState={
  current:normalisePalette(PARALLAX_PALETTES.default),
  source:normalisePalette(PARALLAX_PALETTES.default),
  target:normalisePalette(PARALLAX_PALETTES.default),
  progress:1,
  duration:0.6,
  holdTimer:0,
  activeId:'default'
};

function triggerParallaxPalette(id,{duration=0.65,hold=1.5}={}){
  const palette=normalisePalette(PARALLAX_PALETTES[id]||PARALLAX_PALETTES.default);
  parallaxPaletteState.source={
    layer1:cloneTint(parallaxPaletteState.current.layer1),
    layer2:cloneTint(parallaxPaletteState.current.layer2)
  };
  parallaxPaletteState.target=palette;
  parallaxPaletteState.progress=0;
  parallaxPaletteState.duration=Math.max(0.1,Number(duration)||0.65);
  parallaxPaletteState.holdTimer=Math.max(0,Number(hold)||0);
  parallaxPaletteState.activeId=id||'default';
}

function updateParallaxPalette(dt){
  const state=parallaxPaletteState;
  if(state.progress<1){
    const duration=state.duration||0.65;
    state.progress=Math.min(1,state.progress+(dt>0?dt/duration:0));
  }else if(state.activeId!=='default'){
    state.holdTimer=Math.max(0,state.holdTimer-dt);
    if(state.holdTimer<=0){
      triggerParallaxPalette('default',{duration:1.2,hold:0});
    }
  }
  const blend=Math.max(0,Math.min(1,state.progress));
  state.current={
    layer1:mixTints(state.source.layer1,state.target.layer1,blend),
    layer2:mixTints(state.source.layer2,state.target.layer2,blend)
  };
}

const trailBuffer=typeof OffscreenCanvas!=='undefined'
  ? new OffscreenCanvas(LOGICAL_WIDTH,LOGICAL_HEIGHT)
  : (()=>{const canvas=document.createElement('canvas');canvas.width=LOGICAL_WIDTH;canvas.height=LOGICAL_HEIGHT;return canvas;})();
const trailCtx=trailBuffer?.getContext?.('2d',{alpha:true})||null;
const TRAIL_FADE_ALPHA=0.18;

function resetTrailBuffer(){
  if(!trailCtx)return;
  trailCtx.clearRect(0,0,LOGICAL_WIDTH,LOGICAL_HEIGHT);
}

function drawTrailGlow(context,x,y,radius,strength=1){
  if(!context||!Number.isFinite(x)||!Number.isFinite(y))return;
  const glowRadius=radius*2.4;
  const gradient=context.createRadialGradient(x,y,radius*0.4,x,y,glowRadius);
  gradient.addColorStop(0,`rgba(236,252,255,${0.65*strength})`);
  gradient.addColorStop(1,'rgba(15,19,32,0)');
  context.beginPath();
  context.fillStyle=gradient;
  context.arc(x,y,glowRadius,0,Math.PI*2);
  context.fill();
}

function renderTrailLayer(){
  if(!trailCtx)return;
  trailCtx.save();
  trailCtx.globalCompositeOperation='source-over';
  trailCtx.fillStyle=`rgba(5,8,20,${TRAIL_FADE_ALPHA})`;
  trailCtx.fillRect(0,0,LOGICAL_WIDTH,LOGICAL_HEIGHT);
  trailCtx.restore();
  trailCtx.save();
  trailCtx.globalCompositeOperation='lighter';
  drawTrailGlow(trailCtx,ball.x,ball.y,(ball.r||8)*2,1);
  for(const m of multiBalls){
    drawTrailGlow(trailCtx,m.x,m.y,(m.r||8)*2,0.8);
  }
  trailCtx.restore();
  ctx.save();
  ctx.globalAlpha=0.85;
  ctx.drawImage(trailBuffer,0,0,LOGICAL_WIDTH,LOGICAL_HEIGHT);
  ctx.restore();
}

function requestImage(target,key,src){
  let img=target[key];
  if(img&&img.naturalWidth) return img;
  const cached=getCachedImage(src);
  if(cached){
    target[key]=cached;
    return cached;
  }
  if(!pendingImages.has(src)){
    pendingImages.add(src);
    loadImage(src,{slug:GAME_ID}).then(loaded=>{
      target[key]=loaded;
    }).catch(()=>{}).finally(()=>{pendingImages.delete(src);});
  }
  return target[key]||null;
}

function isImageReady(img){
  if(!img)return false;
  const width=(img.naturalWidth??img.width)??0;
  const height=(img.naturalHeight??img.height)??0;
  if(!(width>0&&height>0))return false;
  if(typeof img.complete==='boolean'){
    return img.complete;
  }
  if(typeof img.readyState==='string'){
    return img.readyState==='complete';
  }
  return true;
}

function primeImages(){
  Object.entries(SPRITE_SOURCES).forEach(([key,src])=>{requestImage(spriteImages,key,src);});
  Object.entries(EFFECT_SOURCES).forEach(([key,src])=>{requestImage(effectImages,key,src);});
  Object.entries(PATTERN_SOURCES).forEach(([key,src])=>{requestImage(patternImages,key,src);});
  for(const [id,sources] of POWERUP_SPRITES.entries()){
    sources.forEach((src,index)=>{requestImage(powerupImages,`${id}:${index}`,src);});
  }
  parallaxLayers.forEach(layer=>{ layer.image=requestImage(parallaxImages,layer.key,layer.src)||layer.image; });
}

function createScratchCanvas(width,height){
  if(typeof OffscreenCanvas!=='undefined'){return new OffscreenCanvas(width,height);}
  if(typeof document!=='undefined'){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;}
  return null;
}

function invalidateBrickPatterns(){
  brickPatternCache.clear();
}

function getBrickPatternFill(context,baseColor){
  if(!context) return null;
  const img=requestImage(patternImages,'brick',PATTERN_SOURCES.brick);
  if(!isImageReady(img)) return null;
  const tint=normaliseColor(baseColor)||'#ffffff';
  const patternScale=Math.max(1,Math.min(4,canvasScale||1));
  const key=`${tint}|${patternScale}`;
  const cached=brickPatternCache.get(key);
  if(cached && cached.image===img && cached.pattern) return cached.pattern;
  const baseWidth=Math.max(1,Math.round((img.naturalWidth||img.width||32)));
  const baseHeight=Math.max(1,Math.round((img.naturalHeight||img.height||16)));
  const scaledWidth=Math.max(1,Math.round(baseWidth*patternScale));
  const scaledHeight=Math.max(1,Math.round(baseHeight*patternScale));
  const scratch=createScratchCanvas(scaledWidth,scaledHeight);
  if(!scratch) return null;
  scratch.width=scaledWidth;
  scratch.height=scaledHeight;
  const scratchCtx=scratch.getContext('2d');
  if(!scratchCtx) return null;
  scratchCtx.clearRect(0,0,scaledWidth,scaledHeight);
  scratchCtx.fillStyle=tint;
  scratchCtx.fillRect(0,0,scaledWidth,scaledHeight);
  scratchCtx.save();
  scratchCtx.scale(patternScale,patternScale);
  scratchCtx.globalCompositeOperation='multiply';
  scratchCtx.drawImage(img,0,0,baseWidth,baseHeight);
  scratchCtx.globalCompositeOperation='screen';
  scratchCtx.globalAlpha=0.35;
  scratchCtx.drawImage(img,0,0,baseWidth,baseHeight);
  scratchCtx.restore();
  const pattern=context.createPattern(scratch,'repeat');
  if(!pattern) return null;
  brickPatternCache.set(key,{pattern,image:img,scale:patternScale,canvas:scratch});
  return pattern;
}

function getPowerUpVisual(def){
  if(!def||!def.id)return null;
  const sources=POWERUP_SPRITES.get(def.id);
  if(!sources||!sources.length)return null;
  if(sources.length===1){
    return requestImage(powerupImages,`${def.id}:0`,sources[0]);
  }
  const key=def.id;
  let cache=powerupCompositeCache.get(key);
  if(!cache){
    const scratch=createScratchCanvas(28,28);
    if(!scratch)return null;
    cache={canvas:scratch,drawn:false};
    powerupCompositeCache.set(key,cache);
  }
  const imgs=sources.map((src,index)=>requestImage(powerupImages,`${key}:${index}`,src));
  if(!imgs.every(isImageReady)){
    cache.drawn=false;
    return null;
  }
  if(!cache.drawn){
    const canvas=cache.canvas;
    const context=canvas.getContext('2d');
    if(!context)return null;
    const size=Math.min(canvas.width||28,canvas.height||28);
    const radius=size*0.18;
    const iconSize=size*0.66;
    context.clearRect(0,0,canvas.width,canvas.height);
    context.globalCompositeOperation='source-over';
    context.globalAlpha=1;
    for(let i=0;i<imgs.length;i++){
      const angle=(Math.PI*2*i/imgs.length)-Math.PI/2;
      const centerX=(canvas.width||size)/2+Math.cos(angle)*radius;
      const centerY=(canvas.height||size)/2+Math.sin(angle)*radius;
      context.drawImage(imgs[i],centerX-iconSize/2,centerY-iconSize/2,iconSize,iconSize);
    }
    cache.drawn=true;
  }
  return cache.canvas;
}

primeImages();

function playSound(name){
  try{playSfx(name);}catch(err){console.warn('[breakout] sfx failed',err);}
}
const MIN_BALL_SPEED=300;
const MAX_BALL_SPEED=860;
const BALL_PADDLE_MAX_ANGLE=Math.PI*0.35;
const COLLISION_EPSILON=1e-4;

const MIN_PADDLE_WIDTH=60;
const MAX_PADDLE_WIDTH=260;
const widthEffects=new Map();
const timedPowerups=new Map();
const POWERUP_LABELS={
  EXPAND:'Widen Paddle',
  LASER:'Paddle Laser',
  LASER_MULTI:'Laser Barrage',
  MULTI:'Multi-ball',
  SLOW:'Time Dilation',
  STICKY:'Sticky Paddle',
  SHRINK:'Narrow Paddle',
  NARROW:'Narrow Paddle'
};
const POWERUP_TYPE_LABELS={
  enlarge:'Widen Paddle',
  slow:'Time Dilation',
  multi:'Multi-ball',
  laser:'Paddle Laser',
  combo:'Combo Surge',
  sticky:'Sticky Paddle',
  narrow:'Narrow Paddle',
  shrink:'Narrow Paddle'
};

let stickyActive=0;
let goldBricksTotal=0;
let goldBricksRemaining=0;
let tripleBallActive=false;

const missionState={
  goldWall:{
    id:'gold-wall',
    label:'Clear a gold wall',
    complete:false,
    target:0,
    progress:0
  },
  tripleSurvivor:{
    id:'triple-survivor',
    label:'Survive 60s with triple ball',
    complete:false,
    target:60,
    timer:0
  }
};

function resetMissionState(){
  missionState.goldWall.complete=false;
  missionState.goldWall.target=0;
  missionState.goldWall.progress=0;
  missionState.tripleSurvivor.complete=false;
  missionState.tripleSurvivor.timer=0;
}

function describePowerup(def){
  if(!def)return 'Power-up';
  const byId=def.id?POWERUP_LABELS[def.id]:null;
  if(byId)return byId;
  const typeKey=typeof def.type==='string'?def.type.toLowerCase():'';
  const typeLabel=typeKey?POWERUP_TYPE_LABELS[typeKey]:null;
  if(typeLabel)return typeLabel;
  return def.name||def.id||'Power-up';
}

function beginTimedPower(def){
  if(!def)return;
  const duration=Number(def.duration||0);
  if(!(duration>0)){timedPowerups.delete(def.id);return;}
  const label=describePowerup(def);
  const entry=timedPowerups.get(def.id)||{id:def.id,label,duration,remaining:duration};
  entry.duration=duration;
  entry.remaining=duration;
  entry.label=label;
  timedPowerups.set(def.id,entry);
}

function endTimedPower(id){
  if(!id)return;
  timedPowerups.delete(id);
}

function tickTimedPowerups(dt){
  if(!timedPowerups.size||!(dt>0))return;
  for(const entry of timedPowerups.values()){
    entry.remaining=Math.max(0,entry.remaining-dt);
  }
}

function getPowerupSnapshot(){
  if(!timedPowerups.size)return [];
  return Array.from(timedPowerups.values()).sort((a,b)=>a.remaining-b.remaining);
}

function getMissionSnapshot(){
  const missions=[];
  const goldTarget=missionState.goldWall.target||0;
  const goldProgress=missionState.goldWall.complete
    ? goldTarget
    : Math.max(0,Math.min(goldTarget,missionState.goldWall.progress||0));
  missions.push({
    id:missionState.goldWall.id,
    label:missionState.goldWall.label,
    complete:missionState.goldWall.complete,
    progress:goldProgress,
    target:goldTarget,
    unit:' bricks'
  });
  const tripleTarget=missionState.tripleSurvivor.target||60;
  const tripleProgress=missionState.tripleSurvivor.complete
    ? tripleTarget
    : Math.max(0,Math.min(tripleTarget,missionState.tripleSurvivor.timer||0));
  missions.push({
    id:missionState.tripleSurvivor.id,
    label:missionState.tripleSurvivor.label,
    complete:missionState.tripleSurvivor.complete,
    progress:tripleProgress,
    target:tripleTarget,
    unit:'s'
  });
  return missions;
}

function completeMission(key,message){
  const mission=missionState[key];
  if(!mission||mission.complete)return;
  mission.complete=true;
  if(typeof message==='string'&&message){
    showToast(message);
  }
}

function refreshGoldMissionTarget(){
  missionState.goldWall.target=goldBricksTotal;
  if(missionState.goldWall.complete){
    missionState.goldWall.progress=goldBricksTotal;
    return;
  }
  missionState.goldWall.progress=Math.max(0,goldBricksTotal-goldBricksRemaining);
}

function updateHudPanels(elapsedSeconds){
  updateHudStatus({
    score,
    lives,
    level,
    time:Math.max(0,Number.isFinite(elapsedSeconds)?elapsedSeconds:0)
  });
  updateHudPowerups(getPowerupSnapshot());
  updateMissionHud(getMissionSnapshot());
}

let c=document.getElementById('b');
if(!c){
  const fallback=document.getElementById('gameCanvas');
  if(fallback){
    c=fallback;
  }else{
    const host=document.getElementById('game-root')||document.body;
    if(host){
      const created=document.createElement('canvas');
      created.id='b';
      created.width=BASE_W;
      created.height=BASE_H;
      created.dataset.basew=String(BASE_W);
      created.dataset.baseh=String(BASE_H);
      host.appendChild(created);
      c=created;
    }
  }
}

if(!c){
  const error=new Error('Breakout: unable to locate or create a canvas element (#b or #gameCanvas).');
  console.error(error);
  throw error;
}

if(!c.dataset.basew)c.dataset.basew=String(BASE_W);
if(!c.dataset.baseh)c.dataset.baseh=String(BASE_H);
const ctx=c.getContext('2d');
if(!ctx){
  throw new Error('Breakout: unable to obtain a 2D rendering context.');
}
if('imageSmoothingEnabled' in ctx){ctx.imageSmoothingEnabled=false;}

function getDevicePixelRatio(){
  if(typeof window==='undefined'||!Number.isFinite(window.devicePixelRatio))return 1;
  const ratio=window.devicePixelRatio;
  if(!Number.isFinite(ratio)||ratio<=0)return 1;
  return Math.max(1,Math.min(4,ratio));
}

function applyCanvasScale(){
  const desiredScale=getDevicePixelRatio();
  const pixelW=Math.max(1,Math.round(LOGICAL_WIDTH*desiredScale));
  const pixelH=Math.max(1,Math.round(LOGICAL_HEIGHT*desiredScale));
  if(canvasScale===desiredScale && c.width===pixelW && c.height===pixelH){
    return;
  }
  canvasScale=desiredScale;
  c.width=pixelW;
  c.height=pixelH;
  if(c.style){
    c.style.width=`${LOGICAL_WIDTH}px`;
    c.style.height=`${LOGICAL_HEIGHT}px`;
  }
  if(typeof ctx.setTransform==='function'){
    ctx.setTransform(canvasScale,0,0,canvasScale,0,0);
  }else{
    ctx.resetTransform?.();
    ctx.scale(canvasScale,canvasScale);
  }
  if(trailBuffer){
    trailBuffer.width=pixelW;
    trailBuffer.height=pixelH;
  }
  if(trailCtx){
    if(typeof trailCtx.setTransform==='function'){
      trailCtx.setTransform(canvasScale,0,0,canvasScale,0,0);
    }else{
      trailCtx.resetTransform?.();
      trailCtx.scale(canvasScale,canvasScale);
    }
  }
  invalidateBrickPatterns();
  resetTrailBuffer();
}

function refreshCanvasLayout(){
  applyCanvasScale();
  fitCanvasToParent(c,LOGICAL_WIDTH,LOGICAL_HEIGHT,24);
}

refreshCanvasLayout();
addEventListener('resize',refreshCanvasLayout);
if(typeof window!=='undefined'){
  window.addEventListener('orientationchange',refreshCanvasLayout);
}
installErrorReporter();
let postedReady=false;

const paddleBaseW=120;
let paddle={w:paddleBaseW,h:14,x:LOGICAL_WIDTH/2-paddleBaseW/2,y:LOGICAL_HEIGHT-40};
let paddlePrevX=paddle.x;
let paddleVelocity=0;
let ball={x:LOGICAL_WIDTH/2,y:LOGICAL_HEIGHT-60,vx:240,vy:-360,r:8,stuck:true,speed:420};
let bricks=[];let score=0,lives=3,level=1;let bestLevel=parseInt(localStorage.getItem('gg:bestlvl:breakout')||'1');
let telemetryGameOverSent=false;
let currentLevelData=null;let levelDropChance=0.2;let levelDropWeights=null;
const scoreNode=document.getElementById('score');

function recomputePaddleWidth(){
  let multiplier=1;
  let maxWidth=MAX_PADDLE_WIDTH;
  let minWidth=MIN_PADDLE_WIDTH;
  for(const effect of widthEffects.values()){
    if(effect&&Number.isFinite(effect.multiplier)){
      multiplier*=effect.multiplier;
    }
    if(effect&&Number.isFinite(effect.maxWidth)&&effect.maxWidth>0){
      maxWidth=Math.min(maxWidth,effect.maxWidth);
    }
    if(effect&&Number.isFinite(effect.minWidth)&&effect.minWidth>0){
      minWidth=Math.max(minWidth,effect.minWidth);
    }
  }
  const desired=paddleBaseW*multiplier;
  const width=Math.max(minWidth,Math.min(maxWidth,desired));
  const center=paddle.x+paddle.w/2;
  paddle.w=width;
  paddle.x=Math.max(0,Math.min(LOGICAL_WIDTH-width,center-width/2));
}

function releaseBall(entity){
  if(!entity||!entity.stuck)return;
  entity.stuck=false;
  entity.stuckBySticky=false;
  entity.stickyOffset=null;
  if(!Number.isFinite(entity.vx))entity.vx=0;
  if(!Number.isFinite(entity.vy))entity.vy=0;
  if(Math.abs(entity.vx)<=1e-3&&Math.abs(entity.vy)<=1e-3){
    const baseSpeed=Math.max(MIN_BALL_SPEED,entity.speed||MIN_BALL_SPEED);
    entity.vx=0;
    entity.vy=-baseSpeed;
  }
  normaliseBallVelocity(entity);
}

function getActiveBallCount(){
  return 1+(Array.isArray(multiBalls)?multiBalls.length:0);
}
function syncScore(){
  if(!scoreNode)return;
  scoreNode.textContent=String(score); // Keep the shell score display in sync.
  scoreNode.dataset.gameScore=String(score);
}
syncScore();
resetMissionState();
initHud();
updateHudPanels(0);
let paused=false;let pauseToast=null;let gameOverShown=false;
function togglePause(){
  paused=!paused;
  if(paused){
    pauseToast=showToast('Paused — P to resume');
  }else if(pauseToast){
    pauseToast.remove();
    pauseToast=null;
  }
}
addEventListener('keydown',e=>{if(e.key.toLowerCase()==='p')togglePause()});
let runStart=performance.now(),endTime=null,submitted=false;

const powerEngine=new PowerUpEngine();
let levelRamp=9;
function loadLevel(){
  parallaxLayers.forEach(layer=>{ if(layer) layer.offset=0; });
  triggerParallaxPalette('default',{duration:0.8,hold:0});
  bricks=[];
  goldBricksTotal=0;
  goldBricksRemaining=0;
  currentLevelData=getLevel(level-1);
  const lvl=currentLevelData;
  if(lvl){
    levelRamp=(lvl.speedRamp||0.15)*60;
    levelDropChance=Math.max(0,Math.min(1,lvl.dropTable?.chance ?? 0.2));
    levelDropWeights=lvl.dropTable?.weights?{...lvl.dropTable.weights}:null;
  }else{
    levelRamp=0.15*60;
    levelDropChance=0.2;
    levelDropWeights=null;
  }
  const rows=lvl?.rows||[];
  const cols=lvl?.cols||0;
  if(!rows.length||!cols){
    // Fallback simple level if manifest missing.
    const fallbackCols=10;
    const bw=(LOGICAL_WIDTH-BRICK_PADDING_X*2-(fallbackCols-1)*BRICK_SPACING)/fallbackCols;
    for(let r=0;r<5;r++){
      for(let i=0;i<fallbackCols;i++){
        const variantIndex=BRICK_TILESET.variants.length?((r+i)%BRICK_TILESET.variants.length):0;
        bricks.push({x:BRICK_PADDING_X+i*(bw+BRICK_SPACING),y:BRICK_TOP+r*BRICK_ROW_HEIGHT,w:bw,h:BRICK_HEIGHT,hp:1,maxHp:1,variant:variantIndex,score:10,dropMultiplier:1,surfaceStyle:createBrickSurfaceStyle(),flashTimer:0});
      }
    }
    return;
  }
  const bw=(LOGICAL_WIDTH-BRICK_PADDING_X*2-(cols-1)*BRICK_SPACING)/cols;
  for(let r=0;r<rows.length;r++){
    const row=rows[r]||'';
    for(let i=0;i<cols;i++){
      const symbol=row[i];
      if(!symbol||symbol==='0'||symbol==='.')continue;
      const material=lvl.materials?.get(symbol)||null;
      if(!material)continue;
      const hp=Math.max(1,material.hp||1);
      const variantIndex=Number.isFinite(material.variant)?material.variant:(BRICK_TILESET.variants.length?((r+i)%BRICK_TILESET.variants.length):0);
      const brickType=(material.type||'normal').toLowerCase();
      bricks.push({
        x:BRICK_PADDING_X+i*(bw+BRICK_SPACING),
        y:BRICK_TOP+r*BRICK_ROW_HEIGHT,
        w:bw,
        h:BRICK_HEIGHT,
        hp,
        maxHp:hp,
        variant:variantIndex,
        materialKey:symbol,
        material,
        score:material.score||10,
        dropMultiplier:material.powerMultiplier||1,
        dropWeights:material.weights||null,
        alive:true,
        type:brickType,
        surfaceStyle:createBrickSurfaceStyle(),
        flashTimer:0
      });
      if(brickType==='gold'){
        goldBricksTotal++;
        goldBricksRemaining++;
      }
    }
  }
  refreshGoldMissionTarget();
}

function resetBall(){
  ball={
    x:paddle.x+paddle.w/2,
    y:paddle.y-20,
    vx:240*(Math.random()<0.5?-1:1),
    vy:-360,
    r:8,
    stuck:true,
    speed:(7+(level-1)*.5)*60,
    stickyOffset:null,
    stuckBySticky:false
  };
  paddlePrevX=paddle.x;
  paddleVelocity=0;
  resetTrailBuffer();
}

loadLevel();
resetBall();
refreshGoldMissionTarget();
updateHudPanels(0);
gameEvent('play',{ slug: GAME_ID });

c.addEventListener('pointermove',e=>{
  const r=c.getBoundingClientRect();
  const scaleX=LOGICAL_WIDTH/r.width;
  const mx=(e.clientX-r.left)*scaleX;
  const center=Math.max(paddle.w/2,Math.min(LOGICAL_WIDTH-paddle.w/2,mx));
  paddle.x=center-paddle.w/2;
  if(ball.stuck){
    const offset=typeof ball.stickyOffset==='number'
      ? Math.max(ball.r,Math.min(paddle.w-ball.r,ball.stickyOffset))
      : paddle.w/2;
    ball.x=Math.max(ball.r,Math.min(LOGICAL_WIDTH-ball.r,paddle.x+offset));
  }
  if(Array.isArray(multiBalls)){
    for(const m of multiBalls){
      if(!m||!m.stuck)continue;
      const offset=typeof m.stickyOffset==='number'
        ? Math.max(m.r,Math.min(paddle.w-m.r,m.stickyOffset))
        : m.r;
      m.x=Math.max(m.r,Math.min(LOGICAL_WIDTH-m.r,paddle.x+offset));
    }
  }
});
c.addEventListener('pointerdown',()=>{
  if(ball.stuck)releaseBall(ball);
  if(Array.isArray(multiBalls)){
    for(const m of multiBalls){
      if(m.stuck)releaseBall(m);
    }
  }
});
  function resetMatch(){
    powerEngine.reset();
    timedPowerups.clear();
    widthEffects.clear();
    stickyActive=0;
    laserActive=0;
    laserPulseInterval=BASE_LASER_INTERVAL;
    lasers.length=0;
    multiBalls.length=0;
    powerups.length=0;
    paddle.w=paddleBaseW;
    paddle.x=LOGICAL_WIDTH/2-paddleBaseW/2;
    recomputePaddleWidth();
    resetMissionState();
    score=0;lives=3;level=1;
    syncScore();
    loadLevel();resetBall();
    runStart=performance.now();endTime=null;submitted=false;
    telemetryGameOverSent=false;
    gameEvent('play', {
      slug: GAME_ID
    });
    clearHud();gameOverShown=false;
    activeEffects.length=0;effectPool.length=0;
    resetTrailBuffer();
    refreshGoldMissionTarget();
    updateHudPanels(0);
  }

addEventListener('keydown',e=>{
  if(e.key==='ArrowLeft')paddle.x=Math.max(0,paddle.x-24);
  if(e.key==='ArrowRight')paddle.x=Math.min(LOGICAL_WIDTH-paddle.w,paddle.x+24);
  if(e.code==='Space'||e.key===' '){
    releaseBall(ball);
    if(Array.isArray(multiBalls))multiBalls.forEach(releaseBall);
  }
  if(e.key.toLowerCase()==='r'&&lives<=0){
    resetMatch();
  }
});

const POWERUP_FALL_SPEED=120;
let powerups=[];
function spawnPU(x,y,definition){
  const def=typeof definition==='string'?getPowerUpDefinition(definition):definition;
  if(!def)return;
  powerups.push({x,y,v:POWERUP_FALL_SPEED,id:def.id,def,dead:false});
}
function maybeSpawnPowerUp(brick){
  if(!brick)return;
  const chance=Math.min(1,Math.max(0,levelDropChance*(brick.dropMultiplier||1)));
  if(!(chance>0&&Math.random()<chance))return;
  const multipliers={};
  if(levelDropWeights){
    for(const [id,val] of Object.entries(levelDropWeights)){
      if(!(val>0))continue;
      multipliers[id]=(multipliers[id]??1)*val;
    }
  }
  if(brick.dropWeights){
    for(const [id,val] of Object.entries(brick.dropWeights)){
      if(!(val>0))continue;
      multipliers[id]=(multipliers[id]??1)*val;
    }
  }
  const selection=selectPowerUp({multipliers});
  if(selection){
    spawnPU(brick.x+brick.w/2,brick.y+brick.h/2,selection);
  }
}

const BASE_LASER_INTERVAL=0.3;
let laserActive=0,laserTimer=0,laserPulseInterval=BASE_LASER_INTERVAL;
let lasers=[];
let multiBalls=[];
function spawnMultiBallSplit(source,count){
  if(!source||count<=0)return;
  const speed=Math.max(240,source.speed||Math.hypot(source.vx,source.vy)||240);
  const baseAngle=Math.atan2(source.vy,source.vx||1);
  const spread=Math.PI*0.55;
  const created=[];
  for(let i=0;i<count;i++){
    const t=count>1?(i/(count-1))*2-1:0;
    const ang=baseAngle+spread*0.5*t;
    created.push({
      x:source.x,
      y:source.y,
      vx:Math.cos(ang)*speed,
      vy:Math.sin(ang)*speed,
      r:source.r,
      stuck:false,
      stickyOffset:null,
      stuckBySticky:false,
      speed,
      born:performance.now()
    });
  }
  multiBalls.push(...created);
}

function applySinglePower(def){
  if(!def)return;
  const type=(def.type||def.id||'').toLowerCase();
  if(type==='enlarge'){
    const multiplier=def.widthMultiplier&&def.widthMultiplier>0?def.widthMultiplier:1.35;
    const maxWidth=def.maxWidth&&def.maxWidth>0?def.maxWidth:240;
    powerEngine.activate(def.id,def.duration||8,
      ()=>{
        widthEffects.set(def.id,{multiplier,maxWidth});
        recomputePaddleWidth();
      },
      ()=>{
        widthEffects.delete(def.id);
        recomputePaddleWidth();
        endTimedPower(def.id);
      }
    );
    beginTimedPower(def);
    triggerParallaxPalette('boost',{duration:0.45,hold:Math.max(2,def.duration||6)});
  }else if(type==='slow'){
    const scale=def.speedScale&&def.speedScale>0?def.speedScale:0.7;
    powerEngine.activate(def.id,def.duration||6,
      ()=>{ball.speed*=scale;multiBalls.forEach(m=>{m.speed*=scale;});},
      ()=>{const inv=scale?1/scale:1;ball.speed*=inv;multiBalls.forEach(m=>{m.speed*=inv;});endTimedPower(def.id);}
    );
    beginTimedPower(def);
    triggerParallaxPalette('slow',{duration:0.45,hold:Math.max(2,def.duration||6)});
  }else if(type==='multi'){
    const count=Math.max(1,Math.round(def.count||2));
    spawnMultiBallSplit(ball,count);
    triggerParallaxPalette('multi',{duration:0.5,hold:1.6});
  }else if(type==='laser'){
    powerEngine.activate(def.id,def.duration||5,
      ()=>{laserActive++;laserPulseInterval=Math.max(0.12,def.pulseInterval||BASE_LASER_INTERVAL);laserTimer=0;},
      ()=>{laserActive=Math.max(0,laserActive-1);if(laserActive===0){laserPulseInterval=BASE_LASER_INTERVAL;}endTimedPower(def.id);}
    );
    beginTimedPower(def);
    triggerParallaxPalette('laser',{duration:0.4,hold:Math.max(2,def.duration||5)});
  }else if(type==='sticky'){
    const duration=Math.max(2,def.duration||6);
    powerEngine.activate(def.id,duration,
      ()=>{stickyActive++;},
      ()=>{stickyActive=Math.max(0,stickyActive-1);endTimedPower(def.id);}
    );
    beginTimedPower({...def,duration});
    triggerParallaxPalette('sticky',{duration:0.45,hold:Math.max(2,duration)});
  }else if(type==='narrow'||type==='shrink'){
    const multiplier=Math.max(0.35,def.widthMultiplier&&def.widthMultiplier>0?def.widthMultiplier:0.7);
    const duration=Math.max(2,def.duration||7);
    const minWidth=Math.max(MIN_PADDLE_WIDTH*multiplier,MIN_PADDLE_WIDTH*0.5);
    powerEngine.activate(def.id,duration,
      ()=>{
        widthEffects.set(def.id,{multiplier,maxWidth:MAX_PADDLE_WIDTH,minWidth});
        recomputePaddleWidth();
      },
      ()=>{
        widthEffects.delete(def.id);
        recomputePaddleWidth();
        endTimedPower(def.id);
      }
    );
    beginTimedPower({...def,duration});
    triggerParallaxPalette('shrink',{duration:0.45,hold:Math.max(2,duration)});
  }else if(type==='combo'){
    triggerParallaxPalette('combo',{duration:0.6,hold:Math.max(2.5,def.duration||6)});
  }
}

function applyPowerDefinition(def,visited=new Set()){
  if(!def||visited.has(def.id))return;
  visited.add(def.id);
  if(Array.isArray(def.grants)){
    for(const grantId of def.grants){
      const grantDef=getPowerUpDefinition(grantId);
      if(grantDef){
        applyPowerDefinition(grantDef,visited);
      }
    }
  }
  applySinglePower(def);
}

function applyPU(p){
  const def=p?.def||getPowerUpDefinition(p?.id||p?.type);
  if(!def)return;
  applyPowerDefinition(def);
  spawnEffect('spark',paddle.x+paddle.w/2,paddle.y,{scale:1.1,duration:0.4});
  playSound('power');
}

function updatePU(dt){
  for(const p of powerups){
    p.y+=p.v*dt;
    if(p.y>LOGICAL_HEIGHT+24)p.dead=true;
    const catchTop=paddle.y-6;
    const catchBottom=paddle.y+paddle.h+6;
    if(p.y>=catchTop&&p.y<=catchBottom&&p.x>=paddle.x&&p.x<=paddle.x+paddle.w){p.dead=true;applyPU(p);}
  }
  powerups=powerups.filter(p=>!p.dead);
}

const effectPool=[];
let activeEffects=[];
function spawnEffect(type,x,y,opts={}){
  const fx=effectPool.pop()||{};
  fx.type=type;
  fx.x=x;
  fx.y=y;
  fx.duration=opts.duration||0.4;
  fx.life=fx.duration;
  fx.scale=opts.scale||1;
  fx.alpha=typeof opts.alpha==='number'?opts.alpha:1;
  activeEffects.push(fx);
}

function damageBrick(brick,impact,options={}){
  if(!brick||brick.hp<=0)return false;
  const brickType=(brick.type||brick.material?.type||'normal').toLowerCase();
  if(brickType==='gold'){
    const allowLaser=Boolean(options.allowLaser);
    const ballCount=Number.isFinite(options.ballCount)?options.ballCount:getActiveBallCount();
    if(!allowLaser && ballCount<3){
      const hitX=impact?.x ?? (brick.x+brick.w/2);
      const hitY=impact?.y ?? (brick.y+brick.h/2);
      spawnEffect('spark',hitX,hitY,{scale:Math.max(0.4,Math.min(0.85,brick.w/90)),duration:0.3,alpha:0.9});
      playSound('hit');
      return false;
    }
  }
  brick.hp=Math.max(0,brick.hp-1);
  const destroyed=brick.hp<=0;
  brick.flashTimer=Math.max(brick.flashTimer||0,BRICK_HIT_FLASH_DURATION);
  const centerX=brick.x+brick.w/2;
  const centerY=brick.y+brick.h/2;
  const fxScale=Math.max(0.55,Math.min(1.25,brick.w/80));
  const bossBrick=(brick.maxHp||brick.hp||0)>=3;
  if(destroyed){
    brick.alive=false;
    score+=brick.score||10;
    syncScore();
    gameEvent('score', {
      slug: GAME_ID,
      value: score,
      meta: {
        level,
        lives,
        bricks: bricks.length,
      },
    });
    if(typeof GG?.addXP==='function')GG.addXP(1);
    spawnEffect('explosion',centerX,centerY,{scale:fxScale,duration:0.45});
    maybeSpawnPowerUp(brick);
    if(brickType==='gold'){
      goldBricksRemaining=Math.max(0,goldBricksRemaining-1);
      if(!missionState.goldWall.complete){
        missionState.goldWall.progress=Math.max(0,goldBricksTotal-goldBricksRemaining);
        if(goldBricksTotal>0&&goldBricksRemaining===0){
          completeMission('goldWall','Mission complete: Clear a gold wall.');
          missionState.goldWall.progress=goldBricksTotal;
        }
      }
    }
    if(bossBrick){
      triggerParallaxPalette('boss',{duration:0.6,hold:2});
    }
  }else{
    const hitX=impact?.x??centerX;
    const hitY=impact?.y??centerY;
    spawnEffect('spark',hitX,hitY,{scale:Math.max(0.4,Math.min(0.85,brick.w/90)),duration:0.3,alpha:0.9});
    if(bossBrick){
      triggerParallaxPalette('boss',{duration:0.4,hold:1.2});
    }
  }
  playSound('hit');
  return destroyed;
}
function updateEffects(dt){
  if(!activeEffects.length)return;
  for(let i=activeEffects.length-1;i>=0;i--){
    const fx=activeEffects[i];
    fx.life-=dt;
    if(fx.life<=0){
      activeEffects.splice(i,1);
      effectPool.push(fx);
    }
  }
}

function drawEffects(){
  if(!activeEffects.length)return;
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  for(const fx of activeEffects){
    const src=EFFECT_SOURCES[fx.type];
    if(!src)continue;
    const sprite=requestImage(effectImages,fx.type,src);
    if(!sprite||!(sprite.naturalWidth||sprite.width))continue;
    const duration=fx.duration||0.4;
    const progress=Math.max(0,Math.min(1,fx.life/duration));
    const alpha=Math.pow(progress,0.6)*(fx.alpha??1);
    const baseW=sprite.naturalWidth||sprite.width;
    const baseH=sprite.naturalHeight||sprite.height;
    const w=baseW*(fx.scale||1);
    const h=baseH*(fx.scale||1);
    ctx.globalAlpha=alpha;
    ctx.drawImage(sprite,fx.x-w/2,fx.y-h/2,w,h);
  }
  ctx.restore();
}

function ensureParallaxLayers(){
  for(const layer of parallaxLayers){
    const img=requestImage(parallaxImages,layer.key,layer.src);
    if(img && img!==layer.image){
      layer.image=img;
      layer.width=img.naturalWidth||img.width||layer.width||0;
      layer.height=img.naturalHeight||img.height||layer.height||0;
    }
  }
}

function getParallaxMetrics(layer){
  if(!layer) return null;
  const img=layer.image;
  const baseW=img?.naturalWidth||img?.width||layer.width||0;
  const baseH=img?.naturalHeight||img?.height||layer.height||0;
  if(!baseW||!baseH) return null;
  const destHeight=LOGICAL_HEIGHT;
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
  updateParallaxPalette(Number.isFinite(dt)?dt:0);
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

function drawParallaxBackground(){
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  ctx.fillStyle='#050516';
  ctx.fillRect(0,0,LOGICAL_WIDTH,LOGICAL_HEIGHT);
  ensureParallaxLayers();
  const palette=parallaxPaletteState.current;
  for(const layer of parallaxLayers){
    const metrics=getParallaxMetrics(layer);
    if(!metrics || !isImageReady(layer.image)) continue;
    let startX=-(layer.offset||0);
    while(startX>0) startX-=metrics.width;
    ctx.save();
    ctx.globalAlpha=layer.alpha ?? 1;
    const tint=layer.key==='layer1'?palette.layer1:palette.layer2;
    for(let x=startX; x<LOGICAL_WIDTH; x+=metrics.width){
      ctx.drawImage(layer.image,x,0,metrics.width,metrics.height);
      if(tint && tint.alpha>0){
        ctx.save();
        ctx.beginPath();
        ctx.rect(x,0,metrics.width,metrics.height);
        ctx.clip();
        const alpha=Math.max(0,Math.min(1,tint.alpha));
        ctx.globalAlpha=(layer.alpha ?? 1)*alpha;
        ctx.globalCompositeOperation='source-atop';
        ctx.fillStyle=tintToCss(tint);
        ctx.fillRect(x,0,metrics.width,metrics.height);
        ctx.restore();
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

function clamp(value,min,max){
  return Math.max(min,Math.min(max,value));
}

function normaliseBallVelocity(entity){
  const speed=Math.hypot(entity.vx||0,entity.vy||0)||1;
  let target=entity.speed||speed;
  target=clamp(target,MIN_BALL_SPEED,MAX_BALL_SPEED);
  let nx=(entity.vx||0)/speed;
  let ny=(entity.vy||0)/speed;
  if(Math.abs(ny)<0.1){
    ny=Math.sign(ny||-1)*0.1;
    const scale=Math.sqrt(Math.max(0,1-ny*ny));
    nx=Math.sign(nx||1)*scale;
  }
  entity.vx=nx*target;
  entity.vy=ny*target;
  entity.speed=target;
}

function reflectVelocity(entity,normal){
  if(normal.x)entity.vx*=-1;
  if(normal.y)entity.vy*=-1;
}

function sweptAabb(entity,rect,dt){
  if(!rect||!dt)return null;
  const radius=entity.r||0;
  const expandedLeft=rect.x-radius;
  const expandedTop=rect.y-radius;
  const expandedRight=rect.x+rect.w+radius;
  const expandedBottom=rect.y+rect.h+radius;
  const insideX=entity.x>expandedLeft&&entity.x<expandedRight;
  const insideY=entity.y>expandedTop&&entity.y<expandedBottom;
  if(insideX&&insideY){
    const dx=Math.min(entity.x-expandedLeft,expandedRight-entity.x);
    const dy=Math.min(entity.y-expandedTop,expandedBottom-entity.y);
    if(dx<dy){
      return {time:0,normal:{x:entity.x>rect.x+rect.w/2?1:-1,y:0},contactX:entity.x,contactY:entity.y};
    }
    return {time:0,normal:{x:0,y:entity.y>rect.y+rect.h/2?1:-1},contactX:entity.x,contactY:entity.y};
  }
  const vx=entity.vx||0;
  const vy=entity.vy||0;
  let xEntry,xExit,yEntry,yExit;
  if(vx>0){
    xEntry=(expandedLeft-entity.x)/vx;
    xExit=(expandedRight-entity.x)/vx;
  }else if(vx<0){
    xEntry=(expandedRight-entity.x)/vx;
    xExit=(expandedLeft-entity.x)/vx;
  }else{
    xEntry=-Infinity;
    xExit=Infinity;
  }
  if(vy>0){
    yEntry=(expandedTop-entity.y)/vy;
    yExit=(expandedBottom-entity.y)/vy;
  }else if(vy<0){
    yEntry=(expandedBottom-entity.y)/vy;
    yExit=(expandedTop-entity.y)/vy;
  }else{
    yEntry=-Infinity;
    yExit=Infinity;
  }
  const entryTime=Math.max(xEntry,yEntry);
  const exitTime=Math.min(xExit,yExit);
  if(entryTime>exitTime||entryTime>dt||entryTime<-COLLISION_EPSILON) return null;
  const normal={x:0,y:0};
  if(xEntry>yEntry){
    normal.x=vx>0?-1:1;
  }else{
    normal.y=vy>0?-1:1;
  }
  const time=Math.max(0,entryTime);
  const contactX=entity.x+vx*time;
  const contactY=entity.y+vy*time;
  return {time,normal,contactX,contactY};
}

function findNextCollision(entity,dt){
  let best=null;
  const consider=(collision)=>{
    if(!collision)return;
    if(!(collision.time<=dt))return;
    if(collision.time<0)collision.time=0;
    if(!best||collision.time<best.time){
      best=collision;
    }
  };
  const vx=entity.vx||0;
  const vy=entity.vy||0;
  if(vx<0){
    const t=(entity.r-entity.x)/vx;
    if(t>=0&&t<=dt)consider({time:t,normal:{x:1,y:0},type:'wall'});
  }else if(vx>0){
    const t=((LOGICAL_WIDTH-entity.r)-entity.x)/vx;
    if(t>=0&&t<=dt)consider({time:t,normal:{x:-1,y:0},type:'wall'});
  }
  if(vy<0){
    const t=(entity.r-entity.y)/vy;
    if(t>=0&&t<=dt)consider({time:t,normal:{x:0,y:1},type:'ceiling'});
  }
  if(entity!==null&&vy>0){
    const paddleHit=sweptAabb(entity,paddle,dt);
    if(paddleHit){
      consider({...paddleHit,type:'paddle'});
    }
  }
  for(const brick of bricks){
    if(!brick||brick.hp<=0)continue;
    const hit=sweptAabb(entity,brick,dt);
    if(hit){
      consider({...hit,type:'brick',target:brick});
    }
  }
  return best;
}

function applyPaddleBounce(entity,collision){
  const contactX=collision?.contactX ?? entity.x;
  const rel=(contactX-(paddle.x+paddle.w/2))/(paddle.w/2||1);
  const angle=-Math.PI/2+clamp(rel,-1,1)*BALL_PADDLE_MAX_ANGLE+clamp(paddleVelocity/600,-0.35,0.35);
  const speed=clamp((entity.speed||MIN_BALL_SPEED)+levelRamp,MIN_BALL_SPEED,MAX_BALL_SPEED);
  entity.speed=speed;
  entity.vx=Math.cos(angle)*speed;
  entity.vy=Math.sin(angle)*speed;
  entity.y=paddle.y-(entity.r||0)-COLLISION_EPSILON;
  spawnEffect('spark',contactX,paddle.y,{scale:0.8,duration:0.3});
  playSound('hit');
  if(stickyActive>0){
    const offset=Math.max(entity.r||0,Math.min(paddle.w-(entity.r||0),contactX-paddle.x));
    entity.stuck=true;
    entity.stuckBySticky=true;
    entity.stickyOffset=isFinite(offset)?offset:Math.max(entity.r||0,paddle.w/2);
  }else{
    entity.stuck=false;
    entity.stuckBySticky=false;
    entity.stickyOffset=null;
  }
}

function handleCollision(entity,collision){
  if(!collision)return;
  if(collision.type==='brick'&&collision.target){
    reflectVelocity(entity,collision.normal||{x:0,y:-1});
    damageBrick(collision.target,{x:collision.contactX,y:collision.contactY},{
      source:'ball',
      ballCount:getActiveBallCount(),
      allowLaser:laserActive>0
    });
  }else if(collision.type==='paddle'){
    applyPaddleBounce(entity,collision);
  }else{
    reflectVelocity(entity,collision.normal||{x:0,y:-1});
  }
  entity.x+= (collision.normal?.x||0)*COLLISION_EPSILON;
  entity.y+= (collision.normal?.y||0)*COLLISION_EPSILON;
  normaliseBallVelocity(entity);
}

function advanceBall(entity,dt){
  if(!entity||entity.stuck)return;
  normaliseBallVelocity(entity);
  let remaining=dt;
  let safety=0;
  while(remaining>0&&safety<6){
    safety++;
    const collision=findNextCollision(entity,remaining);
    if(!collision){
      entity.x+=entity.vx*remaining;
      entity.y+=entity.vy*remaining;
      break;
    }
    const moveTime=Math.min(remaining,Math.max(0,collision.time));
    if(moveTime>0){
      entity.x+=entity.vx*moveTime;
      entity.y+=entity.vy*moveTime;
      remaining-=moveTime;
    }
    collision.contactX=entity.x;
    collision.contactY=entity.y;
    handleCollision(entity,collision);
    remaining=Math.max(0,remaining-COLLISION_EPSILON);
  }
}

function step(dt){
  syncScore();
  updateParallax(dt);
  const deltaX=paddle.x-paddlePrevX;
  if(paused){
    paddleVelocity=0;
    paddlePrevX=paddle.x;
    updateHudPanels(Math.max(0,((endTime||performance.now())-runStart)/1000));
    return;
  }
  powerEngine.update(dt);
  tickTimedPowerups(dt);
  if(stickyActive===0){
    if(ball.stuck&&ball.stuckBySticky)releaseBall(ball);
    if(Array.isArray(multiBalls)){
      for(const m of multiBalls){
        if(m&&m.stuck&&m.stuckBySticky)releaseBall(m);
      }
    }
  }

  if(!Number.isFinite(dt)||dt<=0){
    paddleVelocity=0;
  }else{
    paddleVelocity=deltaX/dt;
  }
  paddlePrevX=paddle.x;

  if(ball.stuck){
    const offset=typeof ball.stickyOffset==='number'
      ? Math.max(ball.r,Math.min(paddle.w-ball.r,ball.stickyOffset))
      : paddle.w/2;
    const destX=Math.max(ball.r,Math.min(LOGICAL_WIDTH-ball.r,paddle.x+offset));
    ball.x=destX;
    ball.y=paddle.y-ball.r-6;
  }else{
    advanceBall(ball,dt);
  }

  if(ball.y>LOGICAL_HEIGHT+20){
    lives--;
    playSound('explode');
    resetBall();
    multiBalls.length=0;
    lasers.length=0;
    powerups.length=0;
    if(lives<=0){
      if(typeof GG?.addAch==='function')GG.addAch(GAME_ID,'Game Over');
      if(!submitted){
        submitted=true;
        submitLeaderboardScore(score);
      }
      if(!endTime)endTime=performance.now();
      if(!telemetryGameOverSent){
        telemetryGameOverSent=true;
        const durationMs=Math.max(0,Math.round((endTime-runStart)));
        gameEvent('game_over', {
          slug: GAME_ID,
          value: score,
          durationMs,
          meta: {
            level,
            lives,
          },
        });
        gameEvent('lose', {
          slug: GAME_ID,
          meta: {
            level,
            score,
          },
        });
      }
    }
  }

  const survivors=[];
  for(const m of multiBalls){
    if(m.stuck){
      const offset=typeof m.stickyOffset==='number'
        ? Math.max(m.r,Math.min(paddle.w-m.r,m.stickyOffset))
        : m.r;
      m.x=Math.max(m.r,Math.min(LOGICAL_WIDTH-m.r,paddle.x+offset));
      m.y=paddle.y-m.r-6;
      survivors.push(m);
      continue;
    }
    advanceBall(m,dt);
    if(m.y>LOGICAL_HEIGHT+20)continue;
    survivors.push(m);
  }
  multiBalls=survivors;

  const activeBallCount=getActiveBallCount();
  if(activeBallCount>=3){
    if(!tripleBallActive){
      tripleBallActive=true;
      gameEvent('score_event',{ slug: GAME_ID, name:'triple_ball' });
    }
    if(!missionState.tripleSurvivor.complete&&Number.isFinite(dt)&&dt>0){
      missionState.tripleSurvivor.timer=Math.min(
        missionState.tripleSurvivor.target,
        missionState.tripleSurvivor.timer+dt
      );
      if(missionState.tripleSurvivor.timer>=missionState.tripleSurvivor.target){
        completeMission('tripleSurvivor','Mission complete: Survive 60s with triple ball.');
        missionState.tripleSurvivor.timer=missionState.tripleSurvivor.target;
      }
    }
  }else{
    if(tripleBallActive){
      tripleBallActive=false;
    }
    if(!missionState.tripleSurvivor.complete){
      missionState.tripleSurvivor.timer=0;
    }
  }

  if(laserActive>0){
    laserTimer-=dt;
    if(laserTimer<=0){
      const left=paddle.x+paddle.w*0.25;
      const right=paddle.x+paddle.w*0.75;
      lasers.push({x:left,y:paddle.y,vy:-540});
      lasers.push({x:right,y:paddle.y,vy:-540});
      laserTimer+=laserPulseInterval;
    }
  }
  for(const beam of lasers){
    beam.y+=beam.vy*dt;
  }
  lasers=lasers.filter(beam=>beam.y>-40);
  for(const beam of lasers){
    for(const brick of bricks){
      if(brick.hp<=0)continue;
      if(beam.x>=brick.x&&beam.x<=brick.x+brick.w&&beam.y>=brick.y&&beam.y<=brick.y+brick.h){
        damageBrick(brick,{x:beam.x,y:beam.y},{source:'laser',allowLaser:true});
      }
    }
  }

  updatePU(dt);
  updateEffects(dt);

  if(Number.isFinite(dt) && dt>0){
    for(const brick of bricks){
      if(brick&&brick.flashTimer>0){
        brick.flashTimer=Math.max(0,brick.flashTimer-dt);
      }
    }
  }

  if(bricks.length&&bricks.every(b=>b.hp<=0)){
    level++;
    gameEvent('level_up', {
      slug: GAME_ID,
      level,
    });
    if(level>bestLevel){bestLevel=level;localStorage.setItem('gg:bestlvl:breakout',bestLevel);}
    loadLevel();
    resetBall();
  }
  updateHudPanels(Math.max(0,((endTime||performance.now())-runStart)/1000));
}

function draw(){
  if(!postedReady){
    postedReady=true;
    try { window.parent?.postMessage({ type:'GAME_READY', slug:'breakout' }, '*'); } catch {}
  }
  if('imageSmoothingEnabled' in ctx&&ctx.imageSmoothingEnabled)ctx.imageSmoothingEnabled=false;
  drawParallaxBackground();
  renderTrailLayer();
  const colorBuckets=new Map();
  for(const b of bricks){
    if(b.hp<=0)continue;
    const baseColor=normaliseColor(getBrickBaseColor(b))||'#a78bfa';
    if(!colorBuckets.has(baseColor))colorBuckets.set(baseColor,[]);
    colorBuckets.get(baseColor).push(b);
  }
  for(const [color,list] of colorBuckets.entries()){
    const pattern=getBrickPatternFill(ctx,color);
    ctx.fillStyle=pattern||color;
    for(const brick of list){
      ctx.fillRect(brick.x,brick.y,brick.w,brick.h);
    }
  }
  for(const b of bricks){
    if(b.hp<=0)continue;
    drawBrickSheen(ctx,b);
    drawBrickHitFlash(ctx,b);
  }
  const paddleSprite=requestImage(spriteImages,'paddle',SPRITE_SOURCES.paddle);
  if(paddleSprite&&paddleSprite.complete&&paddleSprite.naturalWidth){
    ctx.drawImage(paddleSprite,paddle.x,paddle.y,paddle.w,paddle.h);
  }else{
    ctx.fillStyle='#e6e7ea';ctx.fillRect(paddle.x,paddle.y,paddle.w,paddle.h);
  }
  drawPaddleSheen(ctx,paddle);
  const ballSprite=requestImage(spriteImages,'ball',SPRITE_SOURCES.ball);
  const ballSize=ball.r*2;
  if(ballSprite&&ballSprite.complete&&ballSprite.naturalWidth){
    ctx.drawImage(ballSprite,ball.x-ballSize/2,ball.y-ballSize/2,ballSize,ballSize);
  }else{
    ctx.fillStyle='#e6e7ea';ctx.beginPath();ctx.arc(ball.x,ball.y,ball.r,0,Math.PI*2);ctx.fill();
  }
  powerups.forEach(p=>{
    const visual=getPowerUpVisual(p.def||getPowerUpDefinition(p.id));
    if(visual&&isImageReady(visual)){
      ctx.drawImage(visual,p.x-12,p.y-12,24,24);
    }else{
      ctx.fillStyle='#e6e7ea';ctx.beginPath();ctx.arc(p.x,p.y,10,0,Math.PI*2);ctx.fill();
    }
  });
  ctx.fillStyle='#ef4444';for(const L of lasers){ctx.fillRect(L.x-2,L.y-10,4,10);}
  for(const m of multiBalls){
    if(ballSprite&&ballSprite.complete&&ballSprite.naturalWidth){
      const size=m.r*2;
      ctx.drawImage(ballSprite,m.x-size/2,m.y-size/2,size,size);
    }else{
      ctx.fillStyle='#e6e7ea';ctx.beginPath();ctx.arc(m.x,m.y,m.r,0,Math.PI*2);ctx.fill();
    }
  }
  drawEffects();
  ctx.fillStyle='#e6e7ea';ctx.font='bold 18px Inter';
  const rt=((endTime||performance.now())-runStart)/1000;
  ctx.fillText(`Score ${score} • Lives ${lives} • Lv ${level} • Time ${rt.toFixed(1)}s`,10,24);
  const best=parseInt(localStorage.getItem('gg:best:breakout')||'0');
  if(score>best)localStorage.setItem('gg:best:breakout',score);
  GG.setMeta(GAME_ID,'Best score: '+Math.max(best,score)+' • Best level: '+bestLevel);
  if(lives<=0 && !gameOverShown){
    const rt2=((endTime||performance.now())-runStart)/1000;
    showModal(`<p>Game Over — ${rt2.toFixed(1)}s — Press R</p>`,{closeButton:false});
    gameOverShown=true;
  }
  markFirstFrame();
}

const engine=new GameEngine();
engine.update=step;
engine.render=draw;
engine.start();
if(window.reportReady) window.reportReady('breakout');

if(globalScope){
  const breakoutGlobal = (typeof globalScope.Breakout === 'object' && globalScope.Breakout)
    ? globalScope.Breakout
    : {};

  Object.defineProperties(breakoutGlobal,{
    engine:{value:engine,enumerable:true,configurable:true},
    score:{get:()=>score,enumerable:true,configurable:true},
    ball:{get:()=>ball,enumerable:true,configurable:true},
    paddle:{get:()=>paddle,enumerable:true,configurable:true},
    bricks:{get:()=>bricks,enumerable:true,configurable:true},
    resetMatch:{value:resetMatch,enumerable:true,configurable:true,writable:true}
  });

  globalScope.Breakout=breakoutGlobal;

  const invokeReady=(callback)=>{
    if(typeof callback!=='function')return;
    try{callback(breakoutGlobal);}catch(err){console.error('Breakout ready callback failed',err);}
  };

  const queueTarget = Array.isArray(breakoutReadyQueue) ? breakoutReadyQueue : [];
  breakoutGlobal.__readyCallbacks=queueTarget;

  if(queueTarget.length){
    const pending=queueTarget.splice(0,queueTarget.length);
    pending.forEach(invokeReady);
  }

  breakoutGlobal.ready=(callback)=>{
    invokeReady(callback);
  };
}

import('./adapter.js');

