const GAME_ID='tetris';GG.incPlays();
const c=document.getElementById('t');
fitCanvasToParent(c,420,840,24);
addEventListener('resize',()=>fitCanvasToParent(c,420,840,24));
const ctx=c.getContext('2d');
const COLS=10, ROWS=20, CELL=Math.floor(c.height/ROWS);
const COLORS=['#000','#8b5cf6','#22d3ee','#f59e0b','#ef4444','#10b981','#e879f9','#38bdf8'];
const SHAPES={I:[[1,1,1,1]],O:[[2,2],[2,2]],T:[[0,3,0],[3,3,3]],S:[[0,4,4],[4,4,0]],Z:[[5,5,0],[0,5,5]],J:[[6,0,0],[6,6,6]],L:[[0,0,7],[7,7,7]]};
const LINES_PER_LEVEL=10;

let bestScore=+(localStorage.getItem('tetris:bestScore')||0);
let bestLines=+(localStorage.getItem('tetris:bestLines')||0);
let started=false;
let grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
let bag=[];

function nextFromBag(){
  if(bag.length===0) bag=Object.keys(SHAPES).sort(()=>Math.random()-0.5);
  const t=bag.shift();
  return SHAPES[t].map(r=>r.slice());
}
let nextM=nextFromBag();
let holdM=null;
let canHold=true;

let cur=spawn();
let score=0, level=1, lines=0, over=false, dropMs=700, last=0, paused=false;
let lockTimer=0; const LOCK_DELAY=0.5; let lastFrame=0;
let clearAnim=0, clearRows=[];
let bgShift=0;

function spawn(){
  const m=nextM;
  nextM=nextFromBag();
  return {m, x:3, y:0};
}
function rotate(m){
  return m[0].map((_,i)=>m.map(r=>r[i]).reverse());
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
function tryKick(p,R){
  const tests=[{x:-1,y:0},{x:1,y:0},{x:0,y:-1},{x:-2,y:0},{x:2,y:0}];
  for(const t of tests){
    const cand={m:R,x:p.x+t.x,y:p.y+t.y};
    if(!collide(cand)) return cand;
  }
  return null;
}
function merge(p){
  for(let y=0;y<p.m.length;y++)
    for(let x=0;x<p.m[y].length;x++)
      if(p.m[y][x]) grid[p.y+y][p.x+x]=p.m[y][x];
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
    const cleared=clearRows.length;
    lines+=cleared;
    score+=[0,100,300,500,800][cleared]||cleared*200;
    GG.addXP(2*cleared);
    if(lines>=level*LINES_PER_LEVEL){ level++; dropMs=Math.max(120,dropMs-60); }
    updateBest();
    GG.setMeta(GAME_ID,'Best lines: '+lines);
    SFX.seq([[600,0.06],[800,0.06],[1000,0.06]].slice(0,cleared));
  }
}

function drawCell(x,y,v){
  if(!v) return;
  ctx.fillStyle=COLORS[v];
  ctx.fillRect(x*CELL,y*CELL,CELL-1,CELL-1);
}
function drawPieceCell(x,y,v,alpha=1){
  ctx.fillStyle=`rgba(0,0,0,${0.4*alpha})`;
  ctx.fillRect(x*CELL+2,y*CELL+2,CELL-1,CELL-1);
  ctx.globalAlpha=alpha;
  ctx.fillStyle=COLORS[v];
  ctx.fillRect(x*CELL,y*CELL,CELL-1,CELL-1);
  ctx.globalAlpha=1;
}
function drawMatrix(m,ox,oy){
  for(let y=0;y<m.length;y++)
    for(let x=0;x<m[y].length;x++){
      if(!m[y][x]) continue;
      ctx.fillStyle=COLORS[m[y][x]];
      ctx.fillRect(ox+x*CELL*0.8, oy+y*CELL*0.8, CELL*0.8-2, CELL*0.8-2);
    }
}
function drawGhost(){
  const g={m:cur.m.map(r=>r.slice()),x:cur.x,y:cur.y};
  while(!collide(g)) g.y++;
  g.y--;
  for(let y=0;y<g.m.length;y++)
    for(let x=0;x<g.m[y].length;x++)
      if(g.m[y][x]) drawPieceCell(g.x+x,g.y+y,g.m[y][x],0.3);
}
function draw(){
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
    for(let x=0;x<COLS;x++) drawCell(x,y,grid[y][x]);
  drawGhost();
  for(let y=0;y<cur.m.length;y++)
    for(let x=0;x<cur.m[y].length;x++)
      if(cur.m[y][x]) drawPieceCell(cur.x+x,cur.y+y,cur.m[y][x]);

  if(clearAnim>0){
    const alpha=clearAnim/8;
    ctx.fillStyle=`rgba(255,255,255,${alpha})`;
    for(const y of clearRows) ctx.fillRect(0,y*CELL,COLS*CELL,CELL);
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
  const ox=COLS*CELL+16;
  ctx.fillText('NEXT',ox,20);
  drawMatrix(nextM,ox,30);
  ctx.fillText('HOLD (C)',ox,120);
  if(holdM) drawMatrix(holdM,ox,130);

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

function drop(){
  cur.y++;
  if(collide(cur)){
    cur.y--;
    merge(cur);
    clearLines();
    cur=spawn();
    canHold=true;
    lockTimer=0;
    if(collide(cur)){
      over=true;
      updateBest();
      GG.addAch(GAME_ID,'Stacked');
    }
  } else {
    lockTimer=0;
  }
}
function hardDrop(){
  while(!collide(cur)) cur.y++;
  cur.y--;
  score+=2;
  updateBest();
}
function hold(){
  if(!canHold) return;
  const temp=holdM;
  holdM=cur.m.map(r=>r.slice());
  if(temp){
    cur={m:temp,x:3,y:0};
  } else {
    cur=spawn();
  }
  canHold=false;
}

addEventListener('keydown',e=>{
  if(!started){
    if(e.code==='Space'){ started=true; return; }
    return;
  }
  if(over && e.key.toLowerCase()==='r'){
    grid=Array.from({length:ROWS},()=>Array(COLS).fill(0));
    cur=spawn();
    score=0; level=1; lines=0;
    over=false; started=false;
    return;
  }
  if(e.key.toLowerCase()==='p'){ paused=!paused; return; }
  if(paused || over || clearAnim) return;

  if(e.key==='ArrowLeft'){
    const nx=cur.x-1;
    const p={...cur,x:nx};
    if(!collide(p)){ cur.x=nx; lockTimer=0; }
  }
  if(e.key==='ArrowRight'){
    const nx=cur.x+1;
    const p={...cur,x:nx};
    if(!collide(p)){ cur.x=nx; lockTimer=0; }
  }
  if(e.key==='ArrowUp'){
    const R=rotate(cur.m);
    let cand={...cur,m:R};
    if(collide(cand)){
      const k=tryKick(cur,R);
      if(k && !collide(k)) cand=k;
    }
    if(!collide(cand)){
      cur=cand;
      SFX.beep({freq:500,dur:0.03});
      lockTimer=0;
    }
  }
  if(e.key==='ArrowDown'){
    drop();
    SFX.beep({freq:500,dur:0.03});
    GG.addXP(1);
  }
  if(e.code==='Space'){
    hardDrop();
    SFX.seq([[600,0.05],[700,0.05]]);
    merge(cur);
    clearLines();
    cur=spawn();
    canHold=true;
    lockTimer=0;
  }
  if(e.key.toLowerCase()==='c'){
    hold();
  }
});

function loop(ts){
  if(!last) last=ts;
  if(!lastFrame) lastFrame=ts;
  const dt=Math.min((ts-lastFrame)/1000,0.05);
  lastFrame=ts;
  if(started && !paused && !over && clearAnim===0 && ts-last>dropMs){
    drop();
    last=ts;
  }
  if(started && !paused && !over && clearAnim===0){
    const touching=collide({...cur,y:cur.y+1});
    if(touching){
      lockTimer+=dt;
      if(lockTimer>=LOCK_DELAY){
        merge(cur);
        clearLines();
        cur=spawn();
        canHold=true;
        lockTimer=0;
        if(collide(cur)){
          over=true;
          updateBest();
          GG.addAch(GAME_ID,'Stacked');
        }
      }
    } else {
      lockTimer=0;
    }
  }
  ctx.clearRect(0,0,c.width,c.height);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
