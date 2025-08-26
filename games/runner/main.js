import { keyState } from '../../shared/controls.js';
import { attachPauseOverlay, saveBestScore, shareScore } from '../../shared/ui.js';
import { startSessionTimer, endSessionTimer } from '../../shared/metrics.js';
import { emitEvent } from '../../shared/achievements.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio||1);
function resize(){
  canvas.width = innerWidth * DPR;
  canvas.height = innerHeight * DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
addEventListener('resize', resize); resize();

// Game constants
const GROUND = 60;
let speed = 5;
const gravity = 0.8;
const jumpVel = 14;
const slideDur = 20;

// State
let player = {x:80,y:0,w:30,h:50,vy:0,sliding:0};
let score = 0;
let obstacles=[]; let coins=[];
let tick=0;
let running=true;
let diff='med';
const keys=keyState();

// UI
const scoreEl=document.getElementById('score');
const diffSel=document.getElementById('diffSel');
diffSel.onchange=()=>{diff=diffSel.value;};
document.getElementById('pauseBtn').onclick=()=>pause();
document.getElementById('restartBtn').onclick=()=>restart();
const shareBtn=document.getElementById('shareBtn');
const overlay=attachPauseOverlay({onResume:()=>running=true,onRestart:()=>restart()});

// Touch controls
const touchL=document.createElement('div');touchL.className='zone left';
const touchR=document.createElement('div');touchR.className='zone right';
document.body.appendChild(Object.assign(document.createElement('div'),{className:'touch'})).append(touchL,touchR);
touchL.addEventListener('click',()=>slide()); touchR.addEventListener('click',()=>jump());

// Functions
function jump(){ if(player.y<=0&&player.sliding<=0){ player.vy=-jumpVel; } }
function slide(){ if(player.y<=0&&player.sliding<=0){ player.sliding=slideDur; } }
function spawn(){
  if(tick%Math.floor(120/speed)===0){
    if(Math.random()<0.6){ // obstacle
      obstacles.push({x:innerWidth+40,y:innerHeight-GROUND-30,w:30,h:30});
    } else { // coin
      coins.push({x:innerWidth+40,y:innerHeight-GROUND-80,w:20,h:20});
    }
  }
}
function restart(){
  player={x:80,y:0,w:30,h:50,vy:0,sliding:0};
  score=0;obstacles=[];coins=[];tick=0;running=true;
  speed=diff==='easy'?4:diff==='med'?5:6.5;
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
  // difficulty scaling
  speed += 0.0005;
  // Player physics
  player.vy+=gravity;
  player.y+=player.vy;
  if(player.y>0){player.y=0;player.vy=0;}
  if(player.sliding>0) player.sliding--;
  // Keys
  if(keys.has('arrowup')||keys.has(' ')) jump();
  if(keys.has('arrowdown')) slide();
  // Spawn obstacles/coins
  spawn();
  obstacles.forEach(o=>o.x-=speed); coins.forEach(c=>c.x-=speed);
  obstacles=obstacles.filter(o=>o.x>-60); coins=coins.filter(c=>c.x>-60);
  // Collisions
  for(const o of obstacles){
    if(player.x<o.x+o.w&&player.x+player.w>o.x&&player.y+player.h>o.y&&player.y<o.y+o.h){
      running=false;
      saveBestScore('runner',Math.floor(score));
      endSessionTimer('runner');
      emitEvent({ type: 'game_over', slug: 'runner', value: Math.floor(score) });
      shareBtn.hidden=false;
      shareBtn.onclick=()=>shareScore('runner',Math.floor(score));
    }
  }
  for(const c of coins){
    if(player.x< c.x+c.w&&player.x+player.w>c.x&&player.y+player.h>c.y&&player.y<c.y+c.h){
      score+=10;
      c.x=-999;
    }
  }
  score+=speed*0.1;
  scoreEl.textContent=Math.floor(score);
}

function render(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // Ground
  ctx.fillStyle='#333'; ctx.fillRect(0,innerHeight-GROUND,innerWidth,GROUND);
  // Player
  ctx.fillStyle='#6ee7b7';
  const h=player.sliding>0?25:player.h;
  ctx.fillRect(player.x,innerHeight-GROUND-h-player.y,h===25?50:player.w,h);
  // Obstacles
  ctx.fillStyle='#e11d48';
  for(const o of obstacles){ctx.fillRect(o.x,o.y,o.w,o.h);}
  // Coins
  ctx.fillStyle='gold';
  for(const c of coins){ctx.beginPath();ctx.arc(c.x,c.y,10,0,Math.PI*2);ctx.fill();}
  // Score text already in HUD
}

function pause(){running=false;overlay.show();}

// Session timing
startSessionTimer('runner');
emitEvent({ type: 'play', slug: 'runner' });
window.addEventListener('beforeunload',()=>endSessionTimer('runner'));
