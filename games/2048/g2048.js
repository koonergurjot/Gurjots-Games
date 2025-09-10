
(function(){
const c=document.getElementById('board'), ctx=c.getContext('2d');
const PAD=12, S=80, GAP=10;
const LS_SIZE='g2048.size';
const sizeSel=document.getElementById('sizeSel');
let N=parseInt(localStorage.getItem(LS_SIZE) || '4');
if(sizeSel){
  sizeSel.value=String(N);
  sizeSel.addEventListener('change',()=>{
    N=parseInt(sizeSel.value)||4;
    localStorage.setItem(LS_SIZE,N);
    reset();
  });
}
const hud=HUD.create({title:'2048', onPauseToggle:()=>{}, onRestart:()=>reset()});

const MAX_UNDO=3;
const LS_UNDO='g2048.undo', LS_BEST='g2048.best', LS_THEME='g2048.theme';
const ANIM_TIME=120;

const themes={
  light:{
    boardBg:'#fafafa',
    empty:'#d1d5db',
    text:'#111827',
    tileTextDark:'#111827',
    tileTextLight:'#f9fafb',
    tileColors:{2:'#fef9c3',4:'#fde68a',8:'#fbbf24',16:'#f59e0b',32:'#f97316',64:'#ea580c',128:'#d946ef',256:'#a855f7',512:'#8b5cf6',1024:'#6366f1',2048:'#4f46e5',default:'#4338ca'}
  },
  dark:{
    boardBg:'#0f172a',
    empty:'#111827',
    text:'#e6e7ea',
    tileTextDark:'#0b1220',
    tileTextLight:'#e6e7ea',
    tileColors:{2:'#eef2ff',4:'#c7d2fe',8:'#a5b4fc',16:'#93c5fd',32:'#60a5fa',64:'#3b82f6',128:'#22d3ee',256:'#14b8a6',512:'#10b981',1024:'#f59e0b',2048:'#ef4444',default:'#7c3aed'}
  }
};

let currentTheme=localStorage.getItem(LS_THEME) || 'dark';

let grid, score=0, over=false, won=false, hintDir=null;
let history=[];
let undoLeft=parseInt(localStorage.getItem(LS_UNDO) ?? MAX_UNDO);
let best=parseInt(localStorage.getItem(LS_BEST) ?? 0);
if(isNaN(undoLeft)) undoLeft=MAX_UNDO;
if(isNaN(best)) best=0;

let animating=false;

function updateCanvas(){
  c.width = 2*PAD + N*S + (N-1)*GAP;
  c.height = 40 + N*S + (N-1)*GAP + 30;
}

function copyGrid(g){ return g.map(r=>r.slice()); }

function applyTheme(){
  const t=themes[currentTheme];
  document.body.style.background=currentTheme==='dark'?'#0b1220':'#fafafa';
  document.body.style.color=t.text;
  c.style.borderColor=currentTheme==='dark'?'#243047':'#9ca3af';
  const hintBtn=document.getElementById('hintBtn');
  const themeBtn=document.getElementById('themeToggle');
  const sizeSel=document.getElementById('sizeSel');
  if(hintBtn){ hintBtn.style.background=t.empty; hintBtn.style.color=t.text; hintBtn.style.borderColor=c.style.borderColor; }
  if(themeBtn){ themeBtn.style.background=t.empty; themeBtn.style.color=t.text; themeBtn.style.borderColor=c.style.borderColor; themeBtn.textContent=currentTheme==='dark'?'Light':'Dark'; }
  if(sizeSel){ sizeSel.style.background=t.empty; sizeSel.style.color=t.text; sizeSel.style.borderColor=c.style.borderColor; }
}

function reset(keepUndo=false){
  updateCanvas();
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
  if(animating) return;
  if(undoLeft>0 && history.length>1){
    history.pop();
    const prev=history[history.length-1];
    grid=copyGrid(prev.grid); score=prev.score;
    undoLeft--; localStorage.setItem(LS_UNDO,undoLeft);
    over=false; won=false; hintDir=null;
    draw();
  }
}

function computeMove(dir){
  const after=Array.from({length:N},()=>Array(N).fill(0));
  const animations=[];
  let moved=false; let gained=0;
  if(dir===0){
    for(let y=0;y<N;y++){
      let target=0, lastMerge=-1;
      for(let x=0;x<N;x++){
        const v=grid[y][x]; if(!v) continue;
        if(after[y][target]===0){
          after[y][target]=v;
          if(target!==x) moved=true;
          animations.push({value:v,fromX:x,fromY:y,toX:target,toY:y});
        }else if(after[y][target]===v && lastMerge!==target){
          after[y][target]+=v; gained+=after[y][target];
          lastMerge=target; moved=true;
          animations.push({value:v,fromX:x,fromY:y,toX:target,toY:y});
        }else{
          target++; after[y][target]=v;
          if(target!==x) moved=true;
          animations.push({value:v,fromX:x,fromY:y,toX:target,toY:y});
        }
      }
    }
  }else if(dir===2){
    for(let y=0;y<N;y++){
      let target=0, lastMerge=-1;
      for(let x=0;x<N;x++){
        const v=grid[y][N-1-x]; if(!v) continue;
        const fromX=N-1-x, toX=N-1-target;
        if(after[y][toX]===0){
          after[y][toX]=v;
          if(fromX!==toX) moved=true;
          animations.push({value:v,fromX,fromY:y,toX,toY:y});
        }else if(after[y][toX]===v && lastMerge!==target){
          after[y][toX]+=v; gained+=after[y][toX];
          lastMerge=target; moved=true;
          animations.push({value:v,fromX,fromY:y,toX,toY:y});
        }else{
          target++; const nx=N-1-target;
          after[y][nx]=v;
          if(fromX!==nx) moved=true;
          animations.push({value:v,fromX,fromY:y,toX:nx,toY:y});
        }
      }
    }
  }else if(dir===1){
    for(let x=0;x<N;x++){
      let target=0, lastMerge=-1;
      for(let y=0;y<N;y++){
        const v=grid[y][x]; if(!v) continue;
        if(after[target][x]===0){
          after[target][x]=v;
          if(target!==y) moved=true;
          animations.push({value:v,fromX:x,fromY:y,toX:x,toY:target});
        }else if(after[target][x]===v && lastMerge!==target){
          after[target][x]+=v; gained+=after[target][x];
          lastMerge=target; moved=true;
          animations.push({value:v,fromX:x,fromY:y,toX:x,toY:target});
        }else{
          target++; after[target][x]=v;
          if(target!==y) moved=true;
          animations.push({value:v,fromX:x,fromY:y,toX:x,toY:target});
        }
      }
    }
  }else if(dir===3){
    for(let x=0;x<N;x++){
      let target=0, lastMerge=-1;
      for(let y=0;y<N;y++){
        const v=grid[N-1-y][x]; if(!v) continue;
        const fromY=N-1-y, toY=N-1-target;
        if(after[toY][x]===0){
          after[toY][x]=v;
          if(fromY!==toY) moved=true;
          animations.push({value:v,fromX:x,fromY,toX:x,toY});
        }else if(after[toY][x]===v && lastMerge!==target){
          after[toY][x]+=v; gained+=after[toY][x];
          lastMerge=target; moved=true;
          animations.push({value:v,fromX:x,fromY,toX:x,toY});
        }else{
          target++; const ny=N-1-target;
          after[ny][x]=v;
          if(fromY!==ny) moved=true;
          animations.push({value:v,fromX:x,fromY,toX:x,toY:ny});
        }
      }
    }
  }
  return {after, animations, moved, gained};
}

function animateMove(anims, after){
  animating=true;
  const base=copyGrid(grid);
  anims.forEach(a=>{ base[a.fromY][a.fromX]=0; });
  let start=null;
  function step(ts){
    if(start==null) start=ts;
    const p=Math.min((ts-start)/ANIM_TIME,1);
    draw({base, tiles:anims, p});
    if(p<1) requestAnimationFrame(step);
    else{
      grid=after;
      addTile();
      check();
      draw();
      animating=false;
    }
  }
  requestAnimationFrame(step);
}

function move(dir){
  if(over||won||animating) return;
  saveState();
  const {after, animations, moved, gained}=computeMove(dir);
  if(!moved){ history.pop(); return; }
  score+=gained;
  if(score>best){ best=score; localStorage.setItem(LS_BEST,best); }
  animateMove(animations, after);
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

function draw(anim){
  const theme=themes[currentTheme];
  ctx.fillStyle=theme.boardBg;
  ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle=theme.text;
  ctx.font='16px Inter,system-ui';
  ctx.fillText(`Score: ${score} Best: ${best} Undo:${undoLeft}`,12,20);
  const base=anim?anim.base:grid;
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const v=base[y][x]; const px=PAD + x*(S+GAP); const py=40 + y*(S+GAP);
    ctx.fillStyle=v?tileColor(v):theme.empty; ctx.strokeStyle=c.style.borderColor; ctx.lineWidth=1;
    roundRect(ctx,px,py,S,S,10,true,true);
    if(v){ ctx.fillStyle=(v<=4)?theme.tileTextDark:theme.tileTextLight; ctx.font=(v<100)?'28px Inter':'24px Inter'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(v,px+S/2,py+S/2+2); }
  }
  if(anim){
    for(const t of anim.tiles){
      const px=PAD + (t.fromX + (t.toX - t.fromX)*anim.p)*(S+GAP);
      const py=40 + (t.fromY + (t.toY - t.fromY)*anim.p)*(S+GAP);
      const v=t.value;
      ctx.fillStyle=tileColor(v); ctx.strokeStyle=c.style.borderColor; ctx.lineWidth=1;
      roundRect(ctx,px,py,S,S,10,true,true);
      ctx.fillStyle=(v<=4)?theme.tileTextDark:theme.tileTextLight;
      ctx.font=(v<100)?'28px Inter':'24px Inter'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(v,px+S/2,py+S/2+2);
    }
  }
  if(hintDir!=null){ ctx.fillText('Hint: '+['Left','Up','Right','Down'][hintDir],12,c.height-12); }
  if(won){ overlay('You made 2048! Press R to restart'); }
  else if(over){ overlay('No moves left — Press R'); }
}

function overlay(msg){
  ctx.fillStyle='rgba(0,0,0,0.55)';
  ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle=themes[currentTheme].tileTextLight;
  ctx.font='18px Inter';
  ctx.textAlign='center';
  ctx.fillText(msg,c.width/2,c.height/2);
}

function tileColor(v){
  const m=themes[currentTheme].tileColors;
  return m[v]||m.default;
}

function roundRect(ctx,x,y,w,h,r,fill,stroke){
  if(typeof r==='number'){ r={tl:r,tr:r,br:r,bl:r}; }
  ctx.beginPath();
  ctx.moveTo(x+r.tl,y);
  ctx.lineTo(x+w-r.tr,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r.tr);
  ctx.lineTo(x+w,y+h-r.br);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r.br,y+h);
  ctx.lineTo(x+r.bl,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r.bl);
  ctx.lineTo(x,y+r.tl);
  ctx.quadraticCurveTo(x,y,x+r.tl,y);
  ctx.closePath();
  if(fill) ctx.fill();
  if(stroke) ctx.stroke();
}

function simulate(dir){
  let g=copyGrid(grid); let s=score; let moved=false;
  if(dir===0){ for(let y=0;y<N;y++){ const {row,gained}=slideSim(g[y]); if(JSON.stringify(g[y])!==JSON.stringify(row)) moved=true; g[y]=row; s+=gained; } }
  if(dir===2){ for(let y=0;y<N;y++){ const {row,gained}=slideSim(g[y].slice().reverse()); const rev=row.reverse(); if(JSON.stringify(g[y])!==JSON.stringify(rev)) moved=true; g[y]=rev; s+=gained; } }
  if(dir===1){
    for(let x=0;x<N;x++){
      const col=[]; for(let y=0;y<N;y++) col.push(g[y][x]);
      const {row,gained}=slideSim(col);
      for(let y=0;y<N;y++){ if(g[y][x]!==row[y]) moved=true; g[y][x]=row[y]; }
      s+=gained;
    }
  }
  if(dir===3){
    for(let x=0;x<N;x++){
      const col=[]; for(let y=0;y<N;y++) col.push(g[N-1-y][x]);
      const {row,gained}=slideSim(col);
      const rev=row.reverse();
      for(let y=0;y<N;y++){ if(g[y][x]!==rev[y]) moved=true; g[y][x]=rev[y]; }
      s+=gained;
    }
  }
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
document.getElementById('themeToggle')?.addEventListener('click',()=>{
  currentTheme=currentTheme==='dark'?'light':'dark';
  localStorage.setItem(LS_THEME,currentTheme);
  applyTheme();
  draw();
});

applyTheme();
reset(true);
})();
