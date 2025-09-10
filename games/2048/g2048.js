(function(){
const c=document.getElementById('board'), ctx=c.getContext('2d');
const N=4, S=80, PAD=12;
const hud=HUD.create({title:'2048', onPauseToggle:()=>{}, onRestart:()=>reset()});

const MAX_UNDO=3;
const LS_UNDO='g2048.undo', LS_BEST='g2048.best';

let grid, score=0, over=false, won=false, hintDir=null;
let history=[];
let undoLeft=parseInt(localStorage.getItem(LS_UNDO) ?? MAX_UNDO);
let best=parseInt(localStorage.getItem(LS_BEST) ?? 0);
if(isNaN(undoLeft)) undoLeft=MAX_UNDO;
if(isNaN(best)) best=0;

function copyGrid(g){ return g.map(r=>r.slice()); }

function reset(keepUndo=false){
  grid=Array.from({length:N},()=>Array(N).fill(0));
  score=0; over=false; won=false; hintDir=null;
  addTile(); addTile();
  history=[{grid:copyGrid(grid), score:0}];
  if(!keepUndo){ undoLeft=MAX_UNDO; localStorage.setItem(LS_UNDO,undoLeft); }
  draw();
}

function addTile(){
  const empty=[];
  for(let y=0;y<N;y++) for(let x=0;x<N;x++) if(!grid[y][x]) empty.push([x,y]);
  if(!empty.length) return;
  const [x,y]=empty[(Math.random()*empty.length)|0];
  grid[y][x]=Math.random()<0.9?2:4;
}

function slide(row){
  const a=row.filter(v=>v);
  for(let i=0;i<a.length-1;i++){
    if(a[i]===a[i+1]){ a[i]*=2; score+=a[i]; a.splice(i+1,1); }
  }
  while(a.length<N) a.push(0);
  return a;
}

function slideSim(row){
  const a=row.filter(v=>v); let gained=0;
  for(let i=0;i<a.length-1;i++){
    if(a[i]===a[i+1]){ a[i]*=2; gained+=a[i]; a.splice(i+1,1); }
  }
  while(a.length<N) a.push(0);
  return {row:a,gained};
}

function saveState(){
  history.push({grid:copyGrid(grid), score});
  if(history.length>10) history.shift();
}

function undoMove(){
  if(undoLeft>0 && history.length>1){
    history.pop();
    const prev=history[history.length-1];
    grid=copyGrid(prev.grid); score=prev.score;
    undoLeft--; localStorage.setItem(LS_UNDO,undoLeft);
    over=false; won=false; hintDir=null;
    draw();
  }
}

function move(dir){ //0=left,1=up,2=right,3=down
  if(over||won) return;
  saveState();
  const before=JSON.stringify(grid);
  if(dir===0){ for(let y=0;y<N;y++) grid[y]=slide(grid[y]); }
  if(dir===2){ for(let y=0;y<N;y++) grid[y]=slide(grid[y].reverse()).reverse(); }
  if(dir===1){ for(let x=0;x<N;x++){ const col=slide([grid[0][x],grid[1][x],grid[2][x],grid[3][x]]); for(let y=0;y<N;y++) grid[y][x]=col[y]; } }
  if(dir===3){ for(let x=0;x<N;x++){ const col=slide([grid[3][x],grid[2][x],grid[1][x],grid[0][x]]).reverse(); for(let y=0;y<N;y++) grid[y][x]=col[y]; } }
  if(JSON.stringify(grid)!==before) addTile(); else history.pop();
  if(score>best){ best=score; localStorage.setItem(LS_BEST,best); }
  check(); draw();
}

function check(){ won = won || grid.flat().some(v=>v>=2048); over = !won && !canMove(); }

function canMove(){
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    if(grid[y][x]===0) return true;
    if(x+1<N && grid[y][x]===grid[y][x+1]) return true;
    if(y+1<N && grid[y][x]===grid[y+1][x]) return true;
  }
  return false;
}

addEventListener('keydown', e=>{
  if(e.key==='ArrowLeft') move(0);
  if(e.key==='ArrowUp') move(1);
  if(e.key==='ArrowRight') move(2);
  if(e.key==='ArrowDown') move(3);
  if(e.key==='r'||e.key==='R') reset();
  if(e.key.toLowerCase()==='z') undoMove();
});

let touchStart=null;
c.addEventListener('touchstart',e=>{touchStart=e.touches[0]});
c.addEventListener('touchend',e=>{
  if(!touchStart) return; const t=e.changedTouches[0];
  const dx=t.clientX-touchStart.clientX, dy=t.clientY-touchStart.clientY;
  if(Math.abs(dx)+Math.abs(dy)>24){ if(Math.abs(dx)>Math.abs(dy)) move(dx>0?2:0); else move(dy>0?3:1); }
  touchStart=null;
});

function draw(){
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle='#e6e7ea';
  ctx.font='16px Inter,system-ui';
  ctx.fillText(`Score: ${score} Best: ${best} Undo:${undoLeft}`,12,20);
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const v=grid[y][x]; const px=PAD + x*(S+10); const py=40 + y*(S+10);
    ctx.fillStyle=v?tileColor(v):'#111827'; ctx.strokeStyle='#243047'; ctx.lineWidth=1;
    roundRect(ctx,px,py,S,S,10,true,true);
    if(v){ ctx.fillStyle=(v<=4)?'#0b1220':'#e6e7ea'; ctx.font=(v<100)?'28px Inter':'24px Inter'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(v,px+S/2,py+S/2+2); }
  }
  if(hintDir!=null){ ctx.fillText('Hint: '+['Left','Up','Right','Down'][hintDir],12,c.height-12); }
  if(won){ overlay('You made 2048! Press R to restart'); }
  else if(over){ overlay('No moves left — Press R'); }
}

function overlay(msg){ ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(0,0,c.width,c.height); ctx.fillStyle='#e6e7ea'; ctx.font='18px Inter'; ctx.textAlign='center'; ctx.fillText(msg,c.width/2,c.height/2); }

function tileColor(v){ const m={2:'#eef2ff',4:'#c7d2fe',8:'#a5b4fc',16:'#93c5fd',32:'#60a5fa',64:'#3b82f6',128:'#22d3ee',256:'#14b8a6',512:'#10b981',1024:'#f59e0b',2048:'#ef4444'}; return m[v]||'#7c3aed'; }

function roundRect(ctx,x,y,w,h,r,fill,stroke){ if(typeof r==='number'){ r={tl:r,tr:r,br:r,bl:r}; } ctx.beginPath(); ctx.moveTo(x+r.tl,y); ctx.lineTo(x+w-r.tr,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r.tr); ctx.lineTo(x+w,y+h-r.br); ctx.quadraticCurveTo(x+w,y+h,x+w-r.br,y+h); ctx.lineTo(x+r.bl,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r.bl); ctx.lineTo(x,y+r.tl); ctx.quadraticCurveTo(x,y,x+r.tl,y); ctx.closePath(); if(fill) ctx.fill(); if(stroke) ctx.stroke(); }

function simulate(dir){
  let g=copyGrid(grid); let s=score; let moved=false;
  if(dir===0){ for(let y=0;y<N;y++){ const {row,gained}=slideSim(g[y]); if(JSON.stringify(g[y])!==JSON.stringify(row)) moved=true; g[y]=row; s+=gained; } }
  if(dir===2){ for(let y=0;y<N;y++){ const {row,gained}=slideSim(g[y].slice().reverse()); const rev=row.reverse(); if(JSON.stringify(g[y])!==JSON.stringify(rev)) moved=true; g[y]=rev; s+=gained; } }
  if(dir===1){ for(let x=0;x<N;x++){ const col=[g[0][x],g[1][x],g[2][x],g[3][x]]; const {row,gained}=slideSim(col); for(let y=0;y<N;y++){ if(g[y][x]!==row[y]) moved=true; g[y][x]=row[y]; } s+=gained; } }
  if(dir===3){ for(let x=0;x<N;x++){ const col=[g[3][x],g[2][x],g[1][x],g[0][x]]; const {row,gained}=slideSim(col); const rev=row.reverse(); for(let y=0;y<N;y++){ if(g[y][x]!==rev[y]) moved=true; g[y][x]=rev[y]; } s+=gained; } }
  if(!moved) return null; return {grid:g, score:s, max:Math.max(...g.flat())};
}

function getHint(){
  let bestDir=null, bestVal=-1;
  for(let d=0;d<4;d++){
    const sim=simulate(d);
    if(sim && sim.max>bestVal){ bestVal=sim.max; bestDir=d; }
  }
  hintDir=bestDir; draw();
}

document.getElementById('hintBtn')?.addEventListener('click',getHint);

reset(true);
})();

