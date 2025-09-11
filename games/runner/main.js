import { Controls } from '../../src/runtime/controls.ts';
import { attachPauseOverlay, saveBestScore, shareScore, showBestScore } from '../../shared/ui.js';
import { startSessionTimer, endSessionTimer } from '../../shared/metrics.js';
import { emitEvent } from '../../shared/achievements.js';
import { getMission, updateMission, formatMission, clearMission } from '../../shared/missions.js';
import { renderFallbackPanel } from '../../shared/fallback.js';
import { GameEngine } from '../../shared/gameEngine.js';
import signature from 'console-signature';
import games from '../../games.json' assert { type: 'json' };

const help = games.find(g => g.id === 'runner')?.help || {};
window.helpData = help;
async function init(){
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio||1);

let clouds=[],buildings=[],foreground=[];
let particles=[];
let wasGrounded=true;
let levelData=null;
const engine = new GameEngine();

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
let distance = 0;
let pickups = 0;
let obstacles=[]; let coins=[]; let powerups=[];
let active={speed:0,shield:0,magnet:0};
let elapsed=0;
let nextPattern=0;
let diff='med';
const controls = new Controls({
  map: {
    a: ['ArrowUp','Space'],
    b: 'ArrowDown',
    pause: 'KeyP',
    restart: 'KeyR'
  }
});
controls.on('pause', () => pause());
controls.on('restart', () => restart());

// UI
const scoreEl=document.getElementById('score');
const missionEl=document.getElementById('mission');
const diffSel=document.getElementById('diffSel');
diffSel.onchange=()=>{diff=diffSel.value;};
document.getElementById('pauseBtn').onclick=()=>pause();
document.getElementById('restartBtn').onclick=()=>restart();
const shareBtn=document.getElementById('shareBtn');
const overlay=attachPauseOverlay({onResume:()=>engine.start(),onRestart:()=>restart()});
const hud=document.querySelector('.hud');
const bestWrap=document.createElement('span');
bestWrap.innerHTML=`Best: <span id="bestScore">0</span> m`;
hud.insertBefore(bestWrap, missionEl);
const bestEl=bestWrap.querySelector('#bestScore');
showBestScore('runner', bestEl);
let mission=getMission('runner');
let missionRewarded=mission?.completed||false;
missionEl.textContent=formatMission(mission);

function loadLevel(data){
  levelData=data;
  restart();
}
window.loadRunnerLevel=loadLevel;

// Functions
function jump(){ if(player.y<=0&&player.sliding<=0){ player.vy=-jumpVel; return true; } return false; }
function slide(){ if(player.y<=0&&player.sliding<=0){ player.sliding=slideDur; return true; } return false; }
const patterns=[
  [{type:'obstacle',dx:0}],
  [{type:'obstacle',dx:0},{type:'coin',dx:60}],
  [{type:'coin',dx:0},{type:'coin',dx:30},{type:'coin',dx:60}],
  [{type:'obstacle',dx:0},{type:'obstacle',dx:40}]
];

function spawnPattern(){
  if(levelData) return;
  const pat=patterns[Math.floor(Math.random()*patterns.length)];
  const base=innerWidth+40;
  for(const item of pat){
    const x=base+item.dx;
    if(item.type==='obstacle') obstacles.push({x,y:innerHeight-GROUND-30,w:30,h:30});
    if(item.type==='coin') coins.push({x,y:innerHeight-GROUND-80,w:20,h:20});
  }
  if(Math.random()<0.2){
    const types=['speed','shield','magnet'];
    const type=types[Math.floor(Math.random()*types.length)];
    powerups.push({x:base+80,y:innerHeight-GROUND-80,w:20,h:20,type});
  }
  nextPattern=elapsed+Math.max(0.8,2-speed*0.1);
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
  engine.stop();
  player={x:80,y:0,w:30,h:50,vy:0,sliding:0};
  distance=0;pickups=0;obstacles=[];coins=[];powerups=[];particles=[];
  speed=diff==='easy'?4:diff==='med'?5:6.5;
  active={speed:0,shield:0,magnet:0};
  elapsed=0;nextPattern=0;
  wasGrounded=true;
  initBackground();
  if(levelData){
    if(levelData.background){
      clouds = levelData.background.clouds||[];
      buildings = levelData.background.buildings||[];
      foreground = levelData.background.foreground||[];
    }
    obstacles = (levelData.obstacles||[]).map(o=>({...o}));
  }
  if(mission?.completed) clearMission('runner');
  mission=getMission('runner');
  missionRewarded=mission?.completed||false;
  missionEl.textContent=formatMission(mission);
  emitEvent({ type: 'play', slug: 'runner' });
  shareBtn.hidden=true;
  scoreEl.textContent='0';
  showBestScore('runner', bestEl);
  engine.start();
}

function update(dt){
  elapsed += dt;
  mission=updateMission('runner',{time:dt});
  missionEl.textContent=formatMission(mission);
  if(jumpBuffer>0) jumpBuffer=Math.max(0,jumpBuffer-dt);
  if(slideBuffer>0) slideBuffer=Math.max(0,slideBuffer-dt);
  speed += 0.03*dt;
  const curSpeed = speed + (active.speed>0?2:0);
  if(active.speed>0) active.speed-=dt;
  if(active.shield>0) active.shield-=dt;
  if(active.magnet>0) active.magnet-=dt;
  clouds.forEach(c=>c.x-=curSpeed*0.2*60*dt);
  if(clouds.length&&clouds[0].x+clouds[0].w<0){
    const last=clouds[clouds.length-1];
    clouds.shift();
    clouds.push({x:last.x+120,y:50+Math.random()*100,w:100,h:40});
  }
  buildings.forEach(b=>b.x-=curSpeed*0.5*60*dt);
  if(buildings.length&&buildings[0].x+buildings[0].w<0){
    const last=buildings[buildings.length-1];
    buildings.shift();
    buildings.push({x:last.x+80,w:80,h:100+Math.random()*100});
  }
  foreground.forEach(f=>f.x-=curSpeed*60*dt);
  if(foreground.length&&foreground[0].x+foreground[0].w<0){
    const last=foreground[foreground.length-1];
    foreground.shift();
    foreground.push({x:last.x+40,w:40,h:20+Math.random()*20});
  }
  player.vy+=gravity*60*dt;
  player.y+=player.vy*60*dt;
  const grounded=player.y<=0;
  if(grounded){
    if(!wasGrounded) spawnDust(player.x+player.w/2,innerHeight-GROUND);
    player.y=0;player.vy=0;
  }
  wasGrounded=grounded;
  if(player.sliding>0) player.sliding=Math.max(0,player.sliding-60*dt);
  if(controls.isDown('a')) jumpBuffer = BUF_MAX;
  if(controls.isDown('b')) slideBuffer = BUF_MAX;
  if(jumpBuffer>0 && player.y<=0 && player.sliding<=0){ if(jump()) jumpBuffer=0; }
  if(slideBuffer>0 && player.y<=0 && player.sliding<=0){ if(slide()) slideBuffer=0; }
  if(elapsed>=nextPattern) spawnPattern();
  const move=curSpeed*60*dt;
  obstacles.forEach(o=>o.x-=move); coins.forEach(c=>c.x-=move); powerups.forEach(p=>p.x-=move);
  obstacles=obstacles.filter(o=>o.x>-60); coins=coins.filter(c=>c.x>-60); powerups=powerups.filter(p=>p.x>-60);
  particles.forEach(p=>{p.x+=p.vx*60*dt;p.y+=p.vy*60*dt;p.vy+=p.type==='dust'?0.2*60*dt:0.1*60*dt;p.life-=60*dt;});
  particles=particles.filter(p=>p.life>0);
  if(active.magnet>0){
    for(const c of coins){
      if(player.x-80< c.x+c.w && player.x+player.w+80>c.x && player.y+player.h+80>c.y && player.y-80<c.y+c.h){
        pickups++;
        c.x=-999;
        mission=updateMission('runner',{coins:1});
        missionEl.textContent=formatMission(mission);
      }
    }
  }
  for(const o of obstacles){
    if(player.x<o.x+o.w&&player.x+player.w>o.x&&player.y+player.h>o.y&&player.y<o.y+o.h){
      spawnSparks(o.x+o.w/2,o.y);
      if(active.shield>0){ o.x=-999; continue; }
      engine.stop();
      saveBestScore('runner',Math.floor(distance));
      endSessionTimer('runner');
      emitEvent({ type: 'game_over', slug: 'runner', value: Math.floor(distance) });
      shareBtn.hidden=false;
      shareBtn.onclick=()=>shareScore('runner',Math.floor(distance));
      showBestScore('runner', bestEl);
    }
  }
  for(const p of powerups){
    if(player.x< p.x+p.w&&player.x+player.w>p.x&&player.y+player.h>p.y&&player.y<p.y+p.h){
      if(p.type==='speed') active.speed=5;
      if(p.type==='shield') active.shield=5;
      if(p.type==='magnet') active.magnet=5;
      p.x=-999;
    }
  }
  for(const c of coins){
    if(player.x< c.x+c.w&&player.x+player.w>c.x&&player.y+player.h>c.y&&player.y<c.y+c.h){
      pickups++;
      c.x=-999;
      mission=updateMission('runner',{coins:1});
      missionEl.textContent=formatMission(mission);
    }
  }
  if(mission.completed && !missionRewarded){
    missionRewarded=true;
    missionEl.textContent=formatMission(mission);
  }
  distance+=curSpeed*0.1*60*dt;
  scoreEl.textContent=Math.floor(distance);
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

engine.update=update;
engine.render=render;

restart();

function pause(){engine.stop();overlay.show();}

// Session timing
startSessionTimer('runner');
emitEvent({ type: 'play', slug: 'runner' });
window.addEventListener('beforeunload',()=>endSessionTimer('runner'));
}

init().catch(e => {
  signature(e);
  renderFallbackPanel(e, 'runner');
});
