import { keyState } from '../../shared/controls.js';
import { attachPauseOverlay, saveBestScore, shareScore } from '../../shared/ui.js';
import { startSessionTimer, endSessionTimer } from '../../shared/metrics.js';
import { emitEvent } from '../../shared/achievements.js';
import { getMission, updateMission, formatMission, clearMission } from '../../shared/missions.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio||1);

let clouds=[],buildings=[],foreground=[];
let particles=[];
let wasGrounded=true;

function initBackground(){
  clouds=[];buildings=[];foreground=[];
  for(let x=0;x<innerWidth+200;x+=120){
    clouds.push({x,y:50+Math.random()*100,w:100,h:40});
  }
  for(let x=0;x<innerWidth+200;x+=80){
    buildings.push({x,w:80,h:100+Math.random()*100});
  }
  for(let x=0;x<innerWidth+200;x+=40){
    foreground.push({x,w:40,h:20+Math.random()*20});
  }
}

function resize(){
  canvas.width = innerWidth * DPR;
  canvas.height = innerHeight * DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  initBackground();
}
addEventListener('resize', resize); resize();

// Game constants
const GROUND = 60;
let speed = 5;
const gravity = 0.8;
const jumpVel = 14;
// input buffers (seconds)
let jumpBuffer = 0, slideBuffer = 0; const BUF_MAX = 0.12;
const slideDur = 20;

// State
let player = {x:80,y:0,w:30,h:50,vy:0,sliding:0};
let score = 0;
let obstacles=[]; let coins=[]; let powerups=[];
let active={speed:0,shield:0,magnet:0};
let tick=0;
let running=true;
let diff='med';
const keys=keyState();

// UI
const scoreEl=document.getElementById('score');
const missionEl=document.getElementById('mission');
const diffSel=document.getElementById('diffSel');
diffSel.onchange=()=>{diff=diffSel.value;};
document.getElementById('pauseBtn').onclick=()=>pause();
document.getElementById('restartBtn').onclick=()=>restart();
const shareBtn=document.getElementById('shareBtn');
const overlay=attachPauseOverlay({onResume:()=>running=true,onRestart:()=>restart()});
let mission=getMission('runner');
let missionRewarded=mission?.completed||false;
missionEl.textContent=formatMission(mission);

// Touch controls
const touchL=document.createElement('div');touchL.className='zone left';
const touchR=document.createElement('div');touchR.className='zone right';
document.body.appendChild(Object.assign(document.createElement('div'),{className:'touch'})).append(touchL,touchR);
touchL.addEventListener('click',()=>slide()); touchR.addEventListener('click',()=>jump());

// Functions
function jump(){ if(player.y<=0&&player.sliding<=0){ player.vy=-jumpVel; return true; } return false; }
function slide(){ if(player.y<=0&&player.sliding<=0){ player.sliding=slideDur; return true; } return false; }
function spawn(){
  if(tick%Math.floor(120/speed)===0){
    const r=Math.random();
    if(r<0.6){ // obstacle
      obstacles.push({x:innerWidth+40,y:innerHeight-GROUND-30,w:30,h:30});
    } else if(r<0.9){ // coin
      coins.push({x:innerWidth+40,y:innerHeight-GROUND-80,w:20,h:20});
    } else { // powerup
      const types=['speed','shield','magnet'];
      const type=types[Math.floor(Math.random()*types.length)];
      powerups.push({x:innerWidth+40,y:innerHeight-GROUND-80,w:20,h:20,type});
    }
  }
}

function spawnDust(x,y){
  for(let i=0;i<8;i++){
    particles.push({x:x-10+Math.random()*20,y:y-5+Math.random()*10,vx:(Math.random()*2-1),vy:-Math.random()*2-1,life:20,max:20,color:'#d1d5db',type:'dust'});
  }
}

function spawnSparks(x,y){
  for(let i=0;i<15;i++){
    particles.push({x,y,vx:(Math.random()*4-2),vy:-Math.random()*4,life:30,max:30,color:Math.random()<0.5?'#fbbf24':'#f87171',type:'spark'});
  }
}
function restart(){
  player={x:80,y:0,w:30,h:50,vy:0,sliding:0};
  score=0;obstacles=[];coins=[];powerups=[];tick=0;running=true;particles=[];
  speed=diff==='easy'?4:diff==='med'?5:6.5;
  active={speed:0,shield:0,magnet:0};
  wasGrounded=true;
  initBackground();
  if(mission?.completed) clearMission('runner');
  mission=getMission('runner');
  missionRewarded=mission?.completed||false;
  missionEl.textContent=formatMission(mission);
  emitEvent({ type: 'play', slug: 'runner' });
  shareBtn.hidden=true;
}

// Game loop
let last=performance.now();
function loop(t){
  requestAnimationFrame(loop);
  const dt=(t-last)/16; last=t;
  if(running){
    update(dt); render();
  }
}
requestAnimationFrame(loop);

function update(dt){
  tick++;
  mission=updateMission('runner',{time:dt/60});
  missionEl.textContent=formatMission(mission);
  // decay buffers
  if(jumpBuffer>0) jumpBuffer=Math.max(0,jumpBuffer-dt*0.016);
  if(slideBuffer>0) slideBuffer=Math.max(0,slideBuffer-dt*0.016);
  // difficulty scaling
  speed += 0.0005;
  const curSpeed = speed + (active.speed>0?2:0);
  if(active.speed>0) active.speed--;
  if(active.shield>0) active.shield--;
  if(active.magnet>0) active.magnet--;
  // Background scrolling
  clouds.forEach(c=>c.x-=curSpeed*0.2);
  if(clouds.length&&clouds[0].x+clouds[0].w<0){
    const last=clouds[clouds.length-1];
    clouds.shift();
    clouds.push({x:last.x+120,y:50+Math.random()*100,w:100,h:40});
  }
  buildings.forEach(b=>b.x-=curSpeed*0.5);
  if(buildings.length&&buildings[0].x+buildings[0].w<0){
    const last=buildings[buildings.length-1];
    buildings.shift();
    buildings.push({x:last.x+80,w:80,h:100+Math.random()*100});
  }
  foreground.forEach(f=>f.x-=curSpeed*0.8);
  if(foreground.length&&foreground[0].x+foreground[0].w<0){
    const last=foreground[foreground.length-1];
    foreground.shift();
    foreground.push({x:last.x+40,w:40,h:20+Math.random()*20});
  }
  // Player physics
  player.vy+=gravity;
  player.y+=player.vy;
  if(player.y>0){player.y=0;player.vy=0;}
  if(player.sliding>0) player.sliding--;
  const grounded=player.y===0;
  if(!wasGrounded&&grounded){
    spawnDust(player.x+player.w/2,innerHeight-GROUND);
  }
  wasGrounded=grounded;
  // Keys
  if(keys.has('arrowup')||keys.has(' ')) jumpBuffer = BUF_MAX;
  if(keys.has('arrowdown')) slideBuffer = BUF_MAX;
  // consume buffers when eligible
  if(jumpBuffer>0 && player.y<=0 && player.sliding<=0){ if(jump()) jumpBuffer=0; }
  if(slideBuffer>0 && player.y<=0 && player.sliding<=0){ if(slide()) slideBuffer=0; }
  // Spawn obstacles/coins
  spawn();
  obstacles.forEach(o=>o.x-=curSpeed); coins.forEach(c=>c.x-=curSpeed); powerups.forEach(p=>p.x-=curSpeed);
  obstacles=obstacles.filter(o=>o.x>-60); coins=coins.filter(c=>c.x>-60); powerups=powerups.filter(p=>p.x>-60);
  particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=p.type==='dust'?0.2:0.1;p.life--;});
  particles=particles.filter(p=>p.life>0);
  if(active.magnet>0){
    for(const c of coins){
      if(player.x-80< c.x+c.w && player.x+player.w+80>c.x && player.y+player.h+80>c.y && player.y-80<c.y+c.h){
        score+=10;
        c.x=-999;
        mission=updateMission('runner',{coins:1});
        missionEl.textContent=formatMission(mission);
      }
    }
  }
  // Collisions
  for(const o of obstacles){
    if(player.x<o.x+o.w&&player.x+player.w>o.x&&player.y+player.h>o.y&&player.y<o.y+o.h){
      spawnSparks(o.x+o.w/2,o.y);
      if(active.shield>0){ o.x=-999; continue; }
      running=false;
      saveBestScore('runner',Math.floor(score));
      endSessionTimer('runner');
      emitEvent({ type: 'game_over', slug: 'runner', value: Math.floor(score) });
      shareBtn.hidden=false;
      shareBtn.onclick=()=>shareScore('runner',Math.floor(score));
    }
  }
  for(const p of powerups){
    if(player.x< p.x+p.w&&player.x+player.w>p.x&&player.y+player.h>p.y&&player.y<p.y+p.h){
      if(p.type==='speed') active.speed=300;
      if(p.type==='shield') active.shield=300;
      if(p.type==='magnet') active.magnet=300;
      p.x=-999;
    }
  }
  for(const c of coins){
    if(player.x< c.x+c.w&&player.x+player.w>c.x&&player.y+player.h>c.y&&player.y<c.y+c.h){
      score+=10;
      c.x=-999;
      mission=updateMission('runner',{coins:1});
      missionEl.textContent=formatMission(mission);
    }
  }
  if(mission.completed && !missionRewarded){
    score+=mission.score;
    missionRewarded=true;
    missionEl.textContent=formatMission(mission);
  }
  score+=curSpeed*0.1;
  scoreEl.textContent=Math.floor(score);
}

function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // Sky
  ctx.fillStyle='#93c5fd';
  ctx.fillRect(0,0,innerWidth,innerHeight);
  ctx.fillStyle='#fff';
  for(const c of clouds){ctx.beginPath();ctx.ellipse(c.x,c.y,c.w/2,c.h/2,0,0,Math.PI*2);ctx.fill();}
  // Buildings
  ctx.fillStyle='#6b7280';
  for(const b of buildings){ctx.fillRect(b.x,innerHeight-GROUND-b.h,b.w,b.h);}
  // Foreground
  ctx.fillStyle='#374151';
  for(const f of foreground){ctx.fillRect(f.x,innerHeight-GROUND-f.h,f.w,f.h);}
  // Ground
  ctx.fillStyle='#333'; ctx.fillRect(0,innerHeight-GROUND,innerWidth,GROUND);
  // Player
  ctx.fillStyle='#6ee7b7';
  const h=player.sliding>0?25:player.h;
  ctx.fillRect(player.x,innerHeight-GROUND-h-player.y,h===25?50:player.w,h);
  if(active.shield>0){
    ctx.strokeStyle='#fde68a';
    ctx.lineWidth=3;
    ctx.strokeRect(player.x-2,innerHeight-GROUND-h-player.y-2,(h===25?50:player.w)+4,h+4);
  }
  // Obstacles
  ctx.fillStyle='#e11d48';
  for(const o of obstacles){ctx.fillRect(o.x,o.y,o.w,o.h);}
  // Coins
  ctx.fillStyle='gold';
  for(const c of coins){ctx.beginPath();ctx.arc(c.x,c.y,10,0,Math.PI*2);ctx.fill();}
  // Powerups
  for(const p of powerups){
    ctx.fillStyle=p.type==='speed'?'#3b82f6':p.type==='shield'?'#fbbf24':'#a78bfa';
    ctx.fillRect(p.x,p.y,p.w,p.h);
  }
  // Particles
  for(const p of particles){
    ctx.globalAlpha=p.life/p.max;
    ctx.fillStyle=p.color;
    ctx.fillRect(p.x,p.y,4,4);
  }
  ctx.globalAlpha=1;
  // Day-night overlay
  const cycle=(Math.sin(Date.now()/10000 - Math.PI/2)+1)/2;
  ctx.fillStyle=`rgba(0,0,50,${0.5*cycle})`;
  ctx.fillRect(0,0,innerWidth,innerHeight);
  ctx.globalAlpha=1;
  // Score text already in HUD
}

function pause(){running=false;overlay.show();}

// Session timing
startSessionTimer('runner');
emitEvent({ type: 'play', slug: 'runner' });
window.addEventListener('beforeunload',()=>endSessionTimer('runner'));
