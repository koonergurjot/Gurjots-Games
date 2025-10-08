import { GameEngine } from '../../shared/gameEngine.js';
import { getLevel } from './levels.js';
import { PowerUpEngine, getPowerUpDefinition, selectPowerUp, POWERUP_DEFINITIONS } from './powerups.js';
import { installErrorReporter } from '../../shared/debug/error-reporter.js';
import { showToast, showModal, clearHud } from '../../shared/ui/hud.js';
import { preloadFirstFrameAssets } from '../../shared/game-asset-preloader.js';
import { loadImage, getCachedImage } from '../../shared/assets.js';
import { play as playSfx } from '../../shared/juice/audio.js';

const globalScope = typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : undefined);

const breakoutReadyQueue = (() => {
  if (!globalScope) return [];
  if (Array.isArray(globalScope.__BREAKOUT_READY__)) return globalScope.__BREAKOUT_READY__;
  const queue = [];
  globalScope.__BREAKOUT_READY__ = queue;
  return queue;
})();

window.fitCanvasToParent = window.fitCanvasToParent || function(){ /* no-op fallback */ };

const GAME_ID='breakout';GG.incPlays();
preloadFirstFrameAssets(GAME_ID).catch(()=>{});

const SPRITE_SOURCES={
  paddle:'/assets/sprites/paddle.png',
  brick:'/assets/tilesets/industrial.png',
  ball:'/assets/sprites/ball.png'
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

const BRICK_PADDING_X=20;
const BRICK_TOP=60;
const BRICK_SPACING=8;
const BRICK_ROW_HEIGHT=26;
const BRICK_HEIGHT=20;

const EFFECT_SOURCES={
  spark:'/assets/effects/spark.png',
  explosion:'/assets/effects/explosion.png'
};

const POWERUP_SOURCES=POWERUP_DEFINITIONS.reduce((acc,def)=>{
  if(def?.id&&def.sprite){acc[def.id]=def.sprite;}
  return acc;
},{});

const pendingImages=new Set();
const spriteImages={};
const effectImages={};
const powerupImages={};

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

const trailBuffer=typeof OffscreenCanvas!=='undefined'
  ? new OffscreenCanvas(BASE_W,BASE_H)
  : (()=>{const canvas=document.createElement('canvas');canvas.width=BASE_W;canvas.height=BASE_H;return canvas;})();
const trailCtx=trailBuffer?.getContext?.('2d',{alpha:true})||null;
const TRAIL_FADE_ALPHA=0.18;

function resetTrailBuffer(){
  if(!trailCtx)return;
  trailCtx.clearRect(0,0,trailBuffer.width,trailBuffer.height);
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
  trailCtx.fillRect(0,0,trailBuffer.width,trailBuffer.height);
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
  ctx.drawImage(trailBuffer,0,0,c.width,c.height);
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
  return !!img && (img.complete||img.readyState==="complete") && (img.naturalWidth||img.width||0) && (img.naturalHeight||img.height||0);
}

function primeImages(){
  Object.entries(SPRITE_SOURCES).forEach(([key,src])=>{requestImage(spriteImages,key,src);});
  Object.entries(EFFECT_SOURCES).forEach(([key,src])=>{requestImage(effectImages,key,src);});
  Object.entries(POWERUP_SOURCES).forEach(([key,src])=>{requestImage(powerupImages,key,src);});
  parallaxLayers.forEach(layer=>{ layer.image=requestImage(parallaxImages,layer.key,layer.src)||layer.image; });
}

primeImages();

function playSound(name){
  try{playSfx(name);}catch(err){console.warn('[breakout] sfx failed',err);}
}
const BASE_W=1000;
const BASE_H=800;
const MIN_BALL_SPEED=300;
const MAX_BALL_SPEED=860;
const BALL_PADDLE_MAX_ANGLE=Math.PI*0.35;
const COLLISION_EPSILON=1e-4;

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
c.width=BASE_W;
c.height=BASE_H;
fitCanvasToParent(c,BASE_W,BASE_H,24);addEventListener('resize',()=>fitCanvasToParent(c,BASE_W,BASE_H,24));
const ctx=c.getContext('2d');
if(ctx&&'imageSmoothingEnabled' in ctx){ctx.imageSmoothingEnabled=false;}
installErrorReporter();
let postedReady=false;

const paddleBaseW=120;
let paddle={w:paddleBaseW,h:14,x:c.width/2-paddleBaseW/2,y:c.height-40};
let paddlePrevX=paddle.x;
let paddleVelocity=0;
let ball={x:c.width/2,y:c.height-60,vx:240,vy:-360,r:8,stuck:true,speed:420};
let bricks=[];let score=0,lives=3,level=1;let bestLevel=parseInt(localStorage.getItem('gg:bestlvl:breakout')||'1');
let currentLevelData=null;let levelDropChance=0.2;let levelDropWeights=null;
const scoreNode=document.getElementById('score');
function syncScore(){
  if(!scoreNode)return;
  scoreNode.textContent=String(score); // Keep the shell score display in sync.
  scoreNode.dataset.gameScore=String(score);
}
syncScore();
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
  bricks=[];
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
    const bw=(c.width-BRICK_PADDING_X*2-(fallbackCols-1)*BRICK_SPACING)/fallbackCols;
    for(let r=0;r<5;r++){
      for(let i=0;i<fallbackCols;i++){
        const variantIndex=BRICK_TILESET.variants.length?((r+i)%BRICK_TILESET.variants.length):0;
        bricks.push({x:BRICK_PADDING_X+i*(bw+BRICK_SPACING),y:BRICK_TOP+r*BRICK_ROW_HEIGHT,w:bw,h:BRICK_HEIGHT,hp:1,maxHp:1,variant:variantIndex,score:10,dropMultiplier:1});
      }
    }
    return;
  }
  const bw=(c.width-BRICK_PADDING_X*2-(cols-1)*BRICK_SPACING)/cols;
  for(let r=0;r<rows.length;r++){
    const row=rows[r]||'';
    for(let i=0;i<cols;i++){
      const symbol=row[i];
      if(!symbol||symbol==='0'||symbol==='.')continue;
      const material=lvl.materials?.get(symbol)||null;
      if(!material)continue;
      const hp=Math.max(1,material.hp||1);
      const variantIndex=Number.isFinite(material.variant)?material.variant:(BRICK_TILESET.variants.length?((r+i)%BRICK_TILESET.variants.length):0);
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
        alive:true
      });
    }
  }
}

function resetBall(){
  ball={x:paddle.x+paddle.w/2,y:paddle.y-20,vx:240*(Math.random()<0.5?-1:1),vy:-360,r:8,stuck:true,speed:(7+(level-1)*.5)*60};
  paddlePrevX=paddle.x;
  paddleVelocity=0;
  resetTrailBuffer();
}

loadLevel();
resetBall();

c.addEventListener('pointermove',e=>{
  const r=c.getBoundingClientRect();
  const scaleX=c.width/r.width;
  const mx=(e.clientX-r.left)*scaleX;
  const center=Math.max(paddle.w/2,Math.min(c.width-paddle.w/2,mx));
  paddle.x=center-paddle.w/2;
  if(ball.stuck){ball.x=center;}
});
c.addEventListener('pointerdown',()=>{if(ball.stuck)ball.stuck=false});
function resetMatch(){
  powerEngine.reset();
  score=0;lives=3;level=1;
  syncScore();
  loadLevel();resetBall();
  runStart=performance.now();endTime=null;submitted=false;
  clearHud();gameOverShown=false;
  activeEffects.length=0;effectPool.length=0;
  resetTrailBuffer();
  lasers.length=0;
  multiBalls.length=0;
  powerups.length=0;
}

addEventListener('keydown',e=>{
  if(e.key==='ArrowLeft')paddle.x=Math.max(0,paddle.x-24);
  if(e.key==='ArrowRight')paddle.x=Math.min(c.width-paddle.w,paddle.x+24);
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
      speed,
      born:performance.now()
    });
  }
  multiBalls.push(...created);
}
function applyPU(p){
  const def=p?.def||getPowerUpDefinition(p?.id||p?.type);
  if(!def)return;
  const type=def.type||def.id;
  if(type==='enlarge'){
    const multiplier=def.widthMultiplier&&def.widthMultiplier>0?def.widthMultiplier:1.35;
    const maxWidth=def.maxWidth&&def.maxWidth>0?def.maxWidth:240;
    powerEngine.activate(def.id,def.duration||8,
      ()=>{
        paddle.w=Math.min(Math.max(paddle.w, paddleBaseW)*multiplier,maxWidth);
        paddle.x=Math.min(Math.max(0,paddle.x),c.width-paddle.w);
      },
      ()=>{
        paddle.w=Math.max(paddleBaseW,Math.min(paddle.w/multiplier,maxWidth));
        paddle.x=Math.min(Math.max(0,paddle.x),c.width-paddle.w);
      }
    );
  }else if(type==='slow'){
    const scale=def.speedScale&&def.speedScale>0?def.speedScale:0.7;
    powerEngine.activate(def.id,def.duration||6,
      ()=>{ball.speed*=scale;multiBalls.forEach(m=>{m.speed*=scale;});},
      ()=>{const inv=scale?1/scale:1;ball.speed*=inv;multiBalls.forEach(m=>{m.speed*=inv;});}
    );
  }else if(type==='multi'){
    const count=Math.max(1,Math.round(def.count||2));
    spawnMultiBallSplit(ball,count);
  }else if(type==='laser'){
    powerEngine.activate(def.id,def.duration||5,
      ()=>{laserActive++;laserPulseInterval=Math.max(0.12,def.pulseInterval||BASE_LASER_INTERVAL);laserTimer=0;},
      ()=>{laserActive=Math.max(0,laserActive-1);if(laserActive===0){laserPulseInterval=BASE_LASER_INTERVAL;}}
    );
  }
  spawnEffect('spark',paddle.x+paddle.w/2,paddle.y,{scale:1.1,duration:0.4});
  playSound('power');
}

function updatePU(dt){
  for(const p of powerups){
    p.y+=p.v*dt;
    if(p.y>c.height+24)p.dead=true;
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

function damageBrick(brick,impact){
  if(!brick||brick.hp<=0)return false;
  brick.hp=Math.max(0,brick.hp-1);
  const destroyed=brick.hp<=0;
  const centerX=brick.x+brick.w/2;
  const centerY=brick.y+brick.h/2;
  const fxScale=Math.max(0.55,Math.min(1.25,brick.w/80));
  if(destroyed){
    brick.alive=false;
    score+=brick.score||10;
    syncScore();
    if(typeof GG?.addXP==='function')GG.addXP(1);
    spawnEffect('explosion',centerX,centerY,{scale:fxScale,duration:0.45});
    maybeSpawnPowerUp(brick);
  }else{
    const hitX=impact?.x??centerX;
    const hitY=impact?.y??centerY;
    spawnEffect('spark',hitX,hitY,{scale:Math.max(0.4,Math.min(0.85,brick.w/90)),duration:0.3,alpha:0.9});
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
    const t=((c.width-entity.r)-entity.x)/vx;
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
}

function handleCollision(entity,collision){
  if(!collision)return;
  if(collision.type==='brick'&&collision.target){
    reflectVelocity(entity,collision.normal||{x:0,y:-1});
    damageBrick(collision.target,{x:collision.contactX,y:collision.contactY});
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
    return;
  }
  powerEngine.update(dt);

  if(!Number.isFinite(dt)||dt<=0){
    paddleVelocity=0;
  }else{
    paddleVelocity=deltaX/dt;
  }
  paddlePrevX=paddle.x;

  if(ball.stuck){
    const center=clamp(paddle.x+paddle.w/2,ball.r,c.width-ball.r);
    ball.x=center;
    ball.y=paddle.y-ball.r-6;
    normaliseBallVelocity(ball);
  }else{
    advanceBall(ball,dt);
  }

  if(ball.y>c.height+20){
    lives--;
    playSound('explode');
    resetBall();
    multiBalls.length=0;
    lasers.length=0;
    powerups.length=0;
    if(lives<=0){
      if(typeof GG?.addAch==='function')GG.addAch(GAME_ID,'Game Over');
      if(!submitted&&window.LB){LB.submitScore(GAME_ID,score);submitted=true;}
      if(!endTime)endTime=performance.now();
    }
  }

  const survivors=[];
  for(const m of multiBalls){
    advanceBall(m,dt);
    if(m.y>c.height+20)continue;
    survivors.push(m);
  }
  multiBalls=survivors;

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
        damageBrick(brick,{x:beam.x,y:beam.y});
      }
    }
  }

  updatePU(dt);
  updateEffects(dt);

  if(bricks.length&&bricks.every(b=>b.hp<=0)){
    level++;
    if(level>bestLevel){bestLevel=level;localStorage.setItem('gg:bestlvl:breakout',bestLevel);}
    loadLevel();
    resetBall();
  }
}

function draw(){
  if(!postedReady){
    postedReady=true;
    try { window.parent?.postMessage({ type:'GAME_READY', slug:'breakout' }, '*'); } catch {}
  }
  if('imageSmoothingEnabled' in ctx&&ctx.imageSmoothingEnabled)ctx.imageSmoothingEnabled=false;
  drawParallaxBackground();
  renderTrailLayer();
  const brickSprite=requestImage(spriteImages,'brick',SPRITE_SOURCES.brick);
  for(const b of bricks){
    if(b.hp>0){
      if(brickSprite&&brickSprite.complete&&brickSprite.naturalWidth){
        const tileSize=BRICK_TILESET.size;
        const variants=BRICK_TILESET.variants;
        const variantIndex=typeof b.variant==='number'?b.variant:0;
        const variant=variants.length?variants[variantIndex%variants.length]:null;
        if(variant){
          const sx=variant.col*tileSize;
          const sy=variant.row*tileSize;
          ctx.drawImage(brickSprite,sx,sy,tileSize,tileSize,b.x,b.y,b.w,b.h);
        }else{
          ctx.drawImage(brickSprite,b.x,b.y,b.w,b.h);
        }
      }else{
        ctx.fillStyle='#a78bfa';ctx.fillRect(b.x,b.y,b.w,b.h);
      }
    }
  }
  const paddleSprite=requestImage(spriteImages,'paddle',SPRITE_SOURCES.paddle);
  if(paddleSprite&&paddleSprite.complete&&paddleSprite.naturalWidth){
    ctx.drawImage(paddleSprite,paddle.x,paddle.y,paddle.w,paddle.h);
  }else{
    ctx.fillStyle='#e6e7ea';ctx.fillRect(paddle.x,paddle.y,paddle.w,paddle.h);
  }
  const ballSprite=requestImage(spriteImages,'ball',SPRITE_SOURCES.ball);
  const ballSize=ball.r*2;
  if(ballSprite&&ballSprite.complete&&ballSprite.naturalWidth){
    ctx.drawImage(ballSprite,ball.x-ballSize/2,ball.y-ballSize/2,ballSize,ballSize);
  }else{
    ctx.fillStyle='#e6e7ea';ctx.beginPath();ctx.arc(ball.x,ball.y,ball.r,0,Math.PI*2);ctx.fill();
  }
  powerups.forEach(p=>{
    const src=POWERUP_SOURCES[p.id];
    const img=src?requestImage(powerupImages,p.id,src):null;
    if(img&&img.complete&&img.naturalWidth){
      ctx.drawImage(img,p.x-12,p.y-12,24,24);
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

