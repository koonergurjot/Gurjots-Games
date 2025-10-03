import { GameEngine } from '../../shared/gameEngine.js';
import { LEVELS } from './levels.js';
import { PowerUpEngine } from './powerups.js';
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

const EFFECT_SOURCES={
  spark:'/assets/effects/spark.png',
  explosion:'/assets/effects/explosion.png'
};

const POWERUP_SOURCES={
  EXPAND:'/assets/powerups/shield.png',
  SLOW:'/assets/powerups/slow.png',
  MULTI:'/assets/powerups/multi.png',
  LASER:'/assets/powerups/lightning.png'
};

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
let ball={x:c.width/2,y:c.height-60,vx:240,vy:-360,r:8,stuck:true,speed:420};
let bricks=[];let score=0,lives=3,level=1;let bestLevel=parseInt(localStorage.getItem('gg:bestlvl:breakout')||'1');
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
  const lvl=LEVELS[(level-1)%LEVELS.length];
  levelRamp=(lvl.speedRamp||0.15)*60;
  const layout=lvl.layout;
  const pad=20,top=60;
  const rows=layout.length;
  const cols=layout[0].length;
  const bw=(c.width-pad*2-(cols-1)*8)/cols;
  for(let r=0;r<rows;r++){
    for(let i=0;i<cols;i++){
      const hp=layout[r][i];
      if(hp<=0) continue;
      let pu=null;
      const odds=lvl.powerUpOdds||{};
      const rand=Math.random();
      let acc=0;
      for(const [t,prob] of Object.entries(odds)){
        acc+=prob;
        if(rand<acc){pu=t;break;}
      }
      const variantIndex=BRICK_TILESET.variants.length?((r+i)%BRICK_TILESET.variants.length):0;
      bricks.push({x:pad+i*(bw+8),y:top+r*26,w:bw,h:20,hp,pu,variant:variantIndex});
    }
  }
}

function resetBall(){
  ball={x:paddle.x+paddle.w/2,y:paddle.y-20,vx:240*(Math.random()<0.5?-1:1),vy:-360,r:8,stuck:true,speed:(7+(level-1)*.5)*60};
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
  effects=[];
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
function spawnPU(x,y,type){powerups.push({x,y,v:POWERUP_FALL_SPEED,type,dead:false});}

let laserActive=0,laserTimer=0;
let lasers=[];
let multiBalls=[];
function applyPU(p){
  if(p.type==='EXPAND'){
    powerEngine.activate('EXPAND',10,
      ()=>{paddle.w=Math.min(paddle.w*1.35,220);},
      ()=>{paddle.w=Math.max(paddleBaseW,paddle.w/1.35);}
    );
  }else if(p.type==='SLOW'){
    powerEngine.activate('SLOW',6,
      ()=>{ball.speed*=0.7;multiBalls.forEach(m=>m.speed*=0.7);},
      ()=>{ball.speed/=0.7;multiBalls.forEach(m=>m.speed/=0.7);}
    );
  }else if(p.type==='MULTI'){
    const b1={x:ball.x,y:ball.y,vx:-Math.abs(ball.vx),vy:ball.vy,r:8,stuck:false,speed:ball.speed};
    const b2={x:ball.x,y:ball.y,vx:Math.abs(ball.vx),vy:-ball.vy,r:8,stuck:false,speed:ball.speed};
    multiBalls.push(b1,b2);
  }else if(p.type==='LASER'){
    powerEngine.activate('LASER',5,()=>{laserActive++;},()=>{laserActive--;});
  }
  spawnEffect('spark',paddle.x+paddle.w/2,paddle.y,{scale:1.1,duration:0.4});
  playSound('power');
}

function updatePU(dt){
  for(const p of powerups){
    p.y+=p.v*dt;
    if(p.y>c.height)p.dead=true;
    if(p.y>paddle.y-6&&p.x>paddle.x&&p.x<paddle.x+paddle.w){p.dead=true;applyPU(p);}
  }
  powerups=powerups.filter(p=>!p.dead);
}

let effects=[];
function spawnEffect(type,x,y,opts={}){
  const duration=opts.duration||0.4;
  const scale=opts.scale||1;
  effects.push({type,x,y,duration,life:duration,scale});
}
function updateEffects(dt){
  if(!effects.length)return;
  const next=[];
  for(const fx of effects){
    fx.life-=dt;
    if(fx.life>0){next.push(fx);}
  }
  effects=next;
}

function drawEffects(){
  if(!effects.length)return;
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  for(const fx of effects){
    const src=EFFECT_SOURCES[fx.type];
    if(!src)continue;
    const sprite=requestImage(effectImages,fx.type,src);
    if(!sprite||!(sprite.naturalWidth||sprite.width))continue;
    const duration=fx.duration||0.4;
    const progress=Math.max(0,Math.min(1,fx.life/duration));
    const alpha=Math.pow(progress,0.6);
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

function step(dt){
  syncScore();
  updateParallax(dt);
  if(paused)return;
  powerEngine.update(dt);
  if(ball.stuck)return;
  const sp=Math.max(300,ball.speed);
  const len=Math.hypot(ball.vx,ball.vy)||1;
  ball.vx=ball.vx/len*sp;
  ball.vy=ball.vy/len*sp;
  ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;
  if(ball.x<ball.r||ball.x>c.width-ball.r)ball.vx*=-1;
  if(ball.y<ball.r)ball.vy*=-1;
  if(ball.y>paddle.y-ball.r&&ball.y<paddle.y+paddle.h+ball.r&&ball.x>paddle.x&&ball.x<paddle.x+paddle.w&&ball.vy>0){
    const rel=(ball.x-(paddle.x+paddle.w/2))/(paddle.w/2);
    const maxAng=Math.PI*0.75;
    const ang=(Math.PI*1.5)+rel*(maxAng*0.25);
    ball.vx=Math.cos(ang)*sp;
    ball.vy=Math.sin(ang)*sp;
    ball.speed=Math.min(840,ball.speed+levelRamp);
    spawnEffect('spark',ball.x,paddle.y,{scale:0.8,duration:0.3});
    playSound('hit');
  }
  for(const b of bricks){
    if(b.hp<=0)continue;
      if(ball.x>b.x&&ball.x<b.x+b.w&&ball.y>b.y&&ball.y<b.y+b.h){
      b.hp=0;score+=10;syncScore();GG.addXP(1);ball.vy*=-1;const fxScale=Math.max(0.6,Math.min(1.2,b.w/80));
      spawnEffect('explosion',b.x+b.w/2,b.y+b.h/2,{scale:fxScale,duration:0.45});
      if(b.pu)spawnPU(ball.x,ball.y,b.pu);
      playSound('hit');
      }
  }
  if(ball.y>c.height+20){
    lives--;playSound('explode');resetBall();
    if(lives<=0){GG.addAch(GAME_ID,'Game Over');if(!submitted&&window.LB){LB.submitScore(GAME_ID,score);submitted=true;}if(!endTime)endTime=performance.now();}
  }
  if(bricks.every(b=>b.hp<=0)){
    level++;if(level>bestLevel){bestLevel=level;localStorage.setItem('gg:bestlvl:breakout',bestLevel);}
    loadLevel();resetBall();
  }
  updatePU(dt);
  updateEffects(dt);
  if(laserActive>0){
    laserTimer-=dt;
    if(laserTimer<=0){
      lasers.push({x:paddle.x+paddle.w*0.25,y:paddle.y,vy:-540});
      lasers.push({x:paddle.x+paddle.w*0.75,y:paddle.y,vy:-540});
      laserTimer=0.3;
    }
  }
  lasers.forEach(L=>{L.y+=L.vy*dt;});
  lasers=lasers.filter(L=>L.y>-20);
  for(const L of lasers){
    for(const b of bricks){
      if(b.hp>0&&L.x>b.x&&L.x<b.x+b.w&&L.y<b.y+b.h&&L.y>b.y){b.hp=0;score+=10;syncScore();const fxScale=Math.max(0.55,Math.min(1.1,b.w/90));
        spawnEffect('spark',b.x+b.w/2,b.y+b.h/2,{scale:fxScale,duration:0.35});
        playSound('hit');
      }
    }
  }
  for(const m of multiBalls){
    const spm=Math.max(300,m.speed);
    const ln=Math.hypot(m.vx,m.vy)||1;
    m.vx=m.vx/ln*spm;
    m.vy=m.vy/ln*spm;
    m.x+=m.vx*dt;m.y+=m.vy*dt;
    if(m.x<m.r||m.x>c.width-m.r)m.vx*=-1;
    if(m.y<m.r)m.vy*=-1;
    if(m.y>paddle.y-m.r&&m.y<paddle.y+paddle.h+m.r&&m.x>paddle.x&&m.x<paddle.x+paddle.w&&m.vy>0){
      const rel=(m.x-(paddle.x+paddle.w/2))/(paddle.w/2);
      const ang=(Math.PI*1.5)+rel*(Math.PI*0.75*0.25);
      m.vx=Math.cos(ang)*spm;
      m.vy=Math.sin(ang)*spm;
      spawnEffect('spark',m.x,paddle.y,{scale:0.7,duration:0.3});
      playSound('hit');
    }
    for(const b of bricks){
      if(b.hp<=0)continue;
      if(m.x>b.x&&m.x<b.x+b.w&&m.y>b.y&&m.y<b.y+b.h){b.hp=0;score+=10;syncScore();m.vy*=-1;const fxScale=Math.max(0.6,Math.min(1.2,b.w/80));
        spawnEffect('explosion',b.x+b.w/2,b.y+b.h/2,{scale:fxScale,duration:0.45});
        playSound('hit');
      }
    }
  }
  multiBalls=multiBalls.filter(m=>m.y<=c.height+20);
}

function draw(){
  if(!postedReady){
    postedReady=true;
    try { window.parent?.postMessage({ type:'GAME_READY', slug:'breakout' }, '*'); } catch {}
  }
  if('imageSmoothingEnabled' in ctx&&ctx.imageSmoothingEnabled)ctx.imageSmoothingEnabled=false;
  drawParallaxBackground();
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
    const src=POWERUP_SOURCES[p.type];
    const img=src?requestImage(powerupImages,p.type,src):null;
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

