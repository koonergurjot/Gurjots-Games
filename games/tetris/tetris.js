import '../../shared/fx/canvasFx.js';
import '../../shared/skins/index.js';
import { installErrorReporter } from '../../shared/debug/error-reporter.js';

window.fitCanvasToParent = window.fitCanvasToParent || function(){ /* no-op fallback */ };

installErrorReporter();

const GAME_ID='tetris';GG.incPlays();
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
let postedReady=false;
const COLS=10, ROWS=20;
const COLORS=['#000','#8b5cf6','#22d3ee','#f59e0b','#ef4444','#10b981','#e879f9','#38bdf8'];
const SHAPES={I:[[1,1,1,1]],O:[[2,2],[2,2]],T:[[0,3,0],[3,3,3]],S:[[0,4,4],[4,4,0]],Z:[[5,5,0],[0,5,5]],J:[[6,0,0],[6,6,6]],L:[[0,0,7],[7,7,7]]};
const LINES_PER_LEVEL=10;

function getCellSize(){
  return Math.floor(c.height/ROWS);
}

const params=new URLSearchParams(location.search);
const mode=params.has('spectate')?'spectate':(params.get('replay')?'replay':'play');
const replayFile=params.get('replay');
let bc=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('tetris'):null;
if(bc && mode==='spectate'){
  bc.onmessage=e=>{
    ({grid,cur,nextM,holdM,score,level,lines,over,paused,started,showGhost}=e.data);
    updateGhost();
  };
}

let bestScore=+(localStorage.getItem('tetris:bestScore')||0);
let bestLines=+(localStorage.getItem('tetris:bestLines')||0);
let started=false;
let grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
let bag=[];

function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
}

function nextFromBag(){
  if(mode==='replay'){
    const t=Replay.nextPiece();
    return {m:SHAPES[t].map(r=>r.slice()),t};
  }
  if(bag.length===0){
    bag=Object.keys(SHAPES);
    shuffle(bag);
  }
  const t=bag.pop();
  return {m:SHAPES[t].map(r=>r.slice()),t};
}
let nextM;
let holdM=null;
let canHold=true;

let cur;
let ghost;
let showGhost=localStorage.getItem('tetris:ghost')!=='0';
let score=0, level=1, lines=0, over=false, dropMs=700, last=0, paused=false;
let lockTimer=0; const LOCK_DELAY=0.5; let lastFrame=0;
let shellPaused=false;
let pausedByShell=false;
let rafId=0;
let clearAnim=0, clearRows=[];
let bgShift=0;
let combo=-1;
let rotated=false;

function initGame(){
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
  while(!collide(ghost)) ghost.y++;
  ghost.y--;
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
    clearAnim=8;
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
  lines+=cleared;
  GG.addXP(2*cleared);
  if(lines>=level*LINES_PER_LEVEL){ level++; dropMs=Math.max(120,dropMs-60); }
  updateBest();
  GG.setMeta(GAME_ID,'Best lines: '+lines);
  if(cleared) SFX.seq([[600,0.06],[800,0.06],[1000,0.06]].slice(0,cleared));
  rotated=false;
}

function drawCell(x,y,v,cell){
  if(!v) return;
  ctx.fillStyle=COLORS[v];
  ctx.fillRect(x*cell,y*cell,cell-1,cell-1);
}
function drawPieceCell(x,y,v,cell,alpha=1){
  ctx.fillStyle=`rgba(0,0,0,${0.4*alpha})`;
  ctx.fillRect(x*cell+2,y*cell+2,cell-1,cell-1);
  ctx.globalAlpha=alpha;
  ctx.fillStyle=COLORS[v];
  ctx.fillRect(x*cell,y*cell,cell-1,cell-1);
  ctx.globalAlpha=1;
}
function drawMatrix(m,ox,oy,cell){
  const previewCell=cell*0.8;
  for(let y=0;y<m.length;y++)
    for(let x=0;x<m[y].length;x++){
      if(!m[y][x]) continue;
      ctx.fillStyle=COLORS[m[y][x]];
      ctx.fillRect(ox+x*previewCell, oy+y*previewCell, previewCell-2, previewCell-2);
    }
}
function drawGhost(cell){
  if(!showGhost||!ghost) return;
  for(let y=0;y<ghost.m.length;y++)
    for(let x=0;x<ghost.m[y].length;x++)
      if(ghost.m[y][x]) drawPieceCell(ghost.x+x,ghost.y+y,ghost.m[y][x],cell,0.3);
}
function draw(){
  if(!postedReady){
    postedReady=true;
    try { window.parent?.postMessage({ type:'GAME_READY', slug:'tetris' }, '*'); } catch {}
  }
  const cell=getCellSize();
  bgShift=(bgShift+0.5)%c.height;
  const bg=ctx.createLinearGradient(0,bgShift,0,c.height+bgShift);
  bg.addColorStop(0,'#0f1320');
  bg.addColorStop(1,'#19253f');
  ctx.fillStyle=bg;
  ctx.fillRect(0,0,c.width,c.height);

  if(!started){
    ctx.fillStyle='#e6e7ea';
    ctx.font='bold 32px Inter';
    ctx.textAlign='center';
    ctx.fillText('Tetris',c.width/2,c.height/2-40);
    ctx.font='14px Inter';
    ctx.fillText(`High Score ${bestScore}`,c.width/2,c.height/2);
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

  if(clearAnim>0){
    const alpha=clearAnim/8;
    ctx.fillStyle=`rgba(255,255,255,${alpha})`;
    for(const y of clearRows) ctx.fillRect(0,y*cell,COLS*cell,cell);
    clearAnim--;
    if(clearAnim===0){
      grid=grid.filter((r,i)=>!clearRows.includes(i));
      while(grid.length<ROWS) grid.unshift(Array(COLS).fill(0));
      clearRows=[];
    }
  }

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
    if(manual){ score++; updateBest(); }
    lockTimer=0;
  }
  updateGhost();
}
function hardDrop(){
  let dist=0;
  while(!collide(cur)){ cur.y++; dist++; }
  cur.y--;
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
    if(cand!==cur){ cur=cand; SFX.beep({freq:500,dur:0.03}); lockTimer=0; updateGhost(); rotated=true; }
  }
  if(a==='down'){
    drop(true); SFX.beep({freq:500,dur:0.03}); GG.addXP(1);
  }
  if(a==='hardDrop'){
    hardDrop(); SFX.seq([[600,0.05],[700,0.05]]);
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
    over=false; started=false;
    updateGhost();
    return;
  }
  if(keyLower==='p'){ paused=!paused; return; }
  if(paused || over || clearAnim) return;

  if(e.key==='ArrowLeft'){ applyAction('left'); Replay.recordAction('left'); }
  if(e.key==='ArrowRight'){ applyAction('right'); Replay.recordAction('right'); }
  if(e.key==='ArrowUp'){ applyAction('rotate'); Replay.recordAction('rotate'); }
  if(e.key==='ArrowDown'){ applyAction('down'); Replay.recordAction('down'); }
  if(e.code==='Space'){ applyAction('hardDrop'); Replay.recordAction('hardDrop'); }
  if(keyLower==='c'){ applyAction('hold'); Replay.recordAction('hold'); }
});


let touchX=null,touchY=null;
function handleAction(a){
  if(mode!=='play' || paused || over || clearAnim) return;
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

  if(mode!=='spectate' && started && !paused && !over && clearAnim===0 && ts-last>dropMs){
    drop();
    last=ts;
  }
  if(mode!=='spectate' && started && !paused && !over && clearAnim===0){
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
  ctx.clearRect(0,0,c.width,c.height);
  draw();
  if(bc && mode==='play') bc.postMessage({grid,cur,nextM,holdM,score,level,lines,over,paused,started,showGhost});
  rafId=requestAnimationFrame(loop);
}

function startLoop(){ if(!rafId) rafId=requestAnimationFrame(loop); }

function pauseForShell(){
  if(shellPaused) return;
  if(!over && !paused){ paused=true; pausedByShell=true; }
  shellPaused=true;
  if(rafId){ cancelAnimationFrame(rafId); rafId=0; }
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
  startLoop();
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
  Replay.load(`./replays/${replayFile}`).then(()=>{initGame();started=true;startLoop();if(typeof reportReady==='function') reportReady('tetris');});
}else{
  initGame();
  if(mode==='spectate') started=true;
  startLoop();
  if(typeof reportReady==='function') reportReady('tetris');
}
