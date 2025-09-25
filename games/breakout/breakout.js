import { GameEngine } from '../../shared/gameEngine.js';
import { LEVELS } from './levels.js';
import { PowerUpEngine } from './powerups.js';
import { installErrorReporter } from '../../shared/debug/error-reporter.js';
import { showToast, showModal, clearHud } from '../../shared/ui/hud.js';
import { createParticleSystem } from '../../shared/fx/canvasFx.js';

window.fitCanvasToParent = window.fitCanvasToParent || function(){ /* no-op fallback */ };

const GAME_ID='breakout';GG.incPlays();
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
installErrorReporter();
let postedReady=false;

const paddleBaseW=120;
let paddle={w:paddleBaseW,h:14,x:c.width/2-paddleBaseW/2,y:c.height-40};
let ball={x:c.width/2,y:c.height-60,vx:240,vy:-360,r:8,stuck:true,speed:420};
let bricks=[];let score=0,lives=3,level=1;let bestLevel=parseInt(localStorage.getItem('gg:bestlvl:breakout')||'1');
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
      bricks.push({x:pad+i*(bw+8),y:top+r*26,w:bw,h:20,hp,pu});
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
  const mx=e.clientX-r.left;
  paddle.x=Math.max(0,Math.min(c.width-paddle.w,mx-paddle.w/2));
  if(ball.stuck){ball.x=paddle.x+paddle.w/2;}
});
c.addEventListener('pointerdown',()=>{if(ball.stuck)ball.stuck=false});
addEventListener('keydown',e=>{
  if(e.key==='ArrowLeft')paddle.x=Math.max(0,paddle.x-24);
  if(e.key==='ArrowRight')paddle.x=Math.min(c.width-paddle.w,paddle.x+24);
  if(e.key.toLowerCase()==='r'&&lives<=0){
    powerEngine.reset();
    score=0;lives=3;level=1;
    loadLevel();resetBall();
    runStart=performance.now();endTime=null;submitted=false;
    clearHud();gameOverShown=false;
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
  SFX.seq([[900,0.05],[1200,0.06]]);
}

function updatePU(dt){
  for(const p of powerups){
    p.y+=p.v*dt;
    if(p.y>c.height)p.dead=true;
    if(p.y>paddle.y-6&&p.x>paddle.x&&p.x<paddle.x+paddle.w){p.dead=true;applyPU(p);}
  }
  powerups=powerups.filter(p=>!p.dead);
}

const particleSystem=createParticleSystem(ctx);let bgT=0;
function spawnParticles(x,y){
  for(let i=0;i<12;i++){
    particleSystem.add(x,y,{
      vx:(Math.random()*4-2),
      vy:(Math.random()*4-2),
      life:20,
      size:2,
      color:'#a78bfa',
      decay:0.92
    });
  }
}
function updateParticles(){
  particleSystem.update();
}

function step(dt){
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
    SFX.beep({freq:520});
  }
  for(const b of bricks){
    if(b.hp<=0)continue;
    if(ball.x>b.x&&ball.x<b.x+b.w&&ball.y>b.y&&ball.y<b.y+b.h){
      b.hp=0;score+=10;GG.addXP(1);ball.vy*=-1;spawnParticles(b.x+b.w/2,b.y+b.h/2);if(b.pu)spawnPU(ball.x,ball.y,b.pu);SFX.beep({freq:700});
    }
  }
  if(ball.y>c.height+20){
    lives--;SFX.seq([[260,0.06],[200,0.08]]);resetBall();
    if(lives<=0){GG.addAch(GAME_ID,'Game Over');if(!submitted&&window.LB){LB.submitScore(GAME_ID,score);submitted=true;}if(!endTime)endTime=performance.now();}
  }
  if(bricks.every(b=>b.hp<=0)){
    level++;if(level>bestLevel){bestLevel=level;localStorage.setItem('gg:bestlvl:breakout',bestLevel);}
    loadLevel();resetBall();
  }
  updatePU(dt);
  updateParticles();
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
      if(b.hp>0&&L.x>b.x&&L.x<b.x+b.w&&L.y<b.y+b.h&&L.y>b.y){b.hp=0;score+=10;spawnParticles(b.x+b.w/2,b.y+b.h/2);}
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
    }
    for(const b of bricks){
      if(b.hp<=0)continue;
      if(m.x>b.x&&m.x<b.x+b.w&&m.y>b.y&&m.y<b.y+b.h){b.hp=0;score+=10;m.vy*=-1;spawnParticles(b.x+b.w/2,b.y+b.h/2);}
    }
  }
  multiBalls=multiBalls.filter(m=>m.y<=c.height+20);
}

function draw(){
  if(!postedReady){
    postedReady=true;
    try { window.parent?.postMessage({ type:'GAME_READY', slug:'breakout' }, '*'); } catch {}
  }
  ctx.shadowColor='rgba(0,200,255,0.6)';ctx.shadowBlur=12;
  bgT+=0.3;const bg=ctx.createLinearGradient(0,0,0,c.height);
  bg.addColorStop(0,`hsl(${bgT%360},40%,10%)`);
  bg.addColorStop(1,`hsl(${(bgT+60)%360},40%,5%)`);
  ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);
  for(const b of bricks){
    if(b.hp>0){
      const g=ctx.createLinearGradient(b.x,b.y,b.x,b.y+b.h);
      g.addColorStop(0,'#a78bfa');g.addColorStop(1,'#6d28d9');
      ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(b.x,b.y,b.w,b.h,4);ctx.fill();
    }
  }
  ctx.save();ctx.shadowBlur=0;
  particleSystem.draw();
  ctx.restore();
  ctx.fillStyle='#e6e7ea';ctx.fillRect(paddle.x,paddle.y,paddle.w,paddle.h);
  ctx.beginPath();ctx.arc(ball.x,ball.y,ball.r,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#e6e7ea';ctx.font='bold 18px Inter';
  const rt=((endTime||performance.now())-runStart)/1000;
  ctx.fillText(`Score ${score} • Lives ${lives} • Lv ${level} • Time ${rt.toFixed(1)}s`,10,24);
  powerups.forEach(p=>{
    ctx.fillStyle=p.type==='EXPAND'?'#10b981':p.type==='SLOW'?'#38bdf8':p.type==='MULTI'?'#eab308':'#ef4444';
    ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fill();
  });
  ctx.fillStyle='#ef4444';for(const L of lasers){ctx.fillRect(L.x-2,L.y-10,4,10);}
  ctx.fillStyle='#e6e7ea';for(const m of multiBalls){ctx.beginPath();ctx.arc(m.x,m.y,m.r,0,Math.PI*2);ctx.fill();}
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

