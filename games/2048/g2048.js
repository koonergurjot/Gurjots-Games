(function(){
const c=document.getElementById('board'), ctx=c.getContext('2d'); const N=4; const S=80; const PAD=12;
const hud=HUD.create({title:'2048', onPauseToggle:()=>{}, onRestart:()=>reset()});
let grid, score=0, over=false, won=false;
let history=[]; // undo history
function reset(){ grid=Array.from({length:N},()=>Array(N).fill(0)); score=0; over=false; won=false; addTile(); addTile(); draw(); }
function addTile(){ const empty=[]; for(let y=0;y<N;y++) for(let x=0;x<N;x++) if(!grid[y][x]) empty.push([x,y]); if(!empty.length) return; const [x,y]=empty[(Math.random()*empty.length)|0]; grid[y][x] = Math.random()<0.9?2:4; }
function slide(row){ const a=row.filter(v=>v); for(let i=0;i<a.length-1;i++){ if(a[i]===a[i+1]){ a[i]*=2; score+=a[i]; a.splice(i+1,1);} } while(a.length<N) a.push(0); return a; }
function saveState(){ history.push({grid:JSON.parse(JSON.stringify(grid)), score:score}); if(history.length>10) history.shift(); }
function undo(){ if(history.length>1){ history.pop(); const prev=history[history.length-1]; grid=JSON.parse(JSON.stringify(prev.grid)); score=prev.score; over=false; won=false; draw(); } }
function move(dir){ // 0=left,1=up,2=right,3=down
  if(over||won) return; saveState();
  const before = JSON.stringify(grid);
  if(dir===0){ for(let y=0;y<N;y++) grid[y]=slide(grid[y]); }
  if(dir===2){ for(let y=0;y<N;y++) grid[y]=slide(grid[y].reverse()).reverse(); }
  if(dir===1){ for(let x=0;x<N;x++){ const col=slide([grid[0][x],grid[1][x],grid[2][x],grid[3][x]]); for(let y=0;y<N;y++) grid[y][x]=col[y]; } }
  if(dir===3){ for(let x=0;x<N;x++){ const col=slide([grid[3][x],grid[2][x],grid[1][x],grid[0][x]]).reverse(); for(let y=0;y<N;y++) grid[y][x]=col[y]; } }
  if (JSON.stringify(grid)!==before){ addTile(); } else { history.pop(); }
  check(); draw();
}
function check(){ won = won || grid.flat().some(v=>v>=2048); over = !won && !canMove(); }
function canMove(){ // any zero or any mergeable neighbor
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
  if(e.key.toLowerCase()==='z') undo();
});
// swipe controls
let touchStart=null; c.addEventListener('touchstart',e=>{touchStart=e.touches[0]});
c.addEventListener('touchend',e=>{ if(!touchStart)return; const t=e.changedTouches[0]; const dx=t.clientX-touchStart.clientX, dy=t.clientY-touchStart.clientY; if(Math.abs(dx)+Math.abs(dy)>24){ if(Math.abs(dx)>Math.abs(dy)) move(dx>0?2:0); else move(dy>0?3:1); } touchStart=null; });
function draw(){
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle='#e6e7ea'; ctx.font='16px Inter,system-ui'; ctx.fillText('Score: '+score, 12, 20);
  // board
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const v=grid[y][x]; const px=PAD + x*(S+10); const py=40 + y*(S+10);
    ctx.fillStyle=v?tileColor(v):'#111827'; ctx.strokeStyle='#243047'; ctx.lineWidth=1;
    roundRect(ctx, px,py,S,S,10,true,true);
    if(v){ ctx.fillStyle=(v<=4)?'#0b1220':'#e6e7ea'; ctx.font=(v<100)?'28px Inter':'24px Inter'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(v, px+S/2, py+S/2+2); }
  }
  if(won){ overlay('You made 2048! Press R to restart'); }
  else if(over){ overlay('No moves left — Press R'); }
}
function overlay(msg){ ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(0,0,c.width,c.height); ctx.fillStyle='#e6e7ea'; ctx.font='18px Inter'; ctx.textAlign='center'; ctx.fillText(msg, c.width/2, c.height/2); }
function tileColor(v){ const m={2:'#eef2ff',4:'#c7d2fe',8:'#a5b4fc',16:'#93c5fd',32:'#60a5fa',64:'#3b82f6',128:'#22d3ee',256:'#14b8a6',512:'#10b981',1024:'#f59e0b',2048:'#ef4444'}; return m[v]||'#7c3aed'; }
function roundRect(ctx, x,y,w,h,r,fill,stroke){ if (typeof r === 'number'){ r = {tl:r,tr:r,br:r,bl:r}; } ctx.beginPath(); ctx.moveTo(x+r.tl, y); ctx.lineTo(x+w-r.tr, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r.tr); ctx.lineTo(x+w, y+h-r.br); ctx.quadraticCurveTo(x+w, y+h, x+w-r.br, y+h); ctx.lineTo(x+r.bl, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r.bl); ctx.lineTo(x, y+r.tl); ctx.quadraticCurveTo(x, y, x+r.tl, y); ctx.closePath(); if(fill) ctx.fill(); if(stroke) ctx.stroke(); }
reset();
})();