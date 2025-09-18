
import { GameEngine } from '../../shared/gameEngine.js';
import { copyGrid, computeMove, pushState, undo as undoState, getHint as engineHint, canMove } from './engine.js';

// Feature Configuration (all feature-flagged)
const FEATURES = {
  oneStepUndo: true,      // Enable 1-step undo (default ON)
  mergeStreaks: true,     // Enable merge-streak multiplier (default ON)  
  boardSizeToggle: true   // Enable 4x4/5x5 board size toggle (default ON)
};

const c=document.getElementById('board'), ctx=c.getContext('2d');
const oppC=document.getElementById('oppBoard'), oppCtx=oppC?.getContext('2d');
const net=window.Net;
let oppGrid=null, oppScore=0;
const PAD=12, S=80, GAP=10;
const LS_SIZE='g2048.size';
const sizeSel=document.getElementById('sizeSel');
const diffSel=document.getElementById('diffSel');
let N=parseInt(localStorage.getItem(LS_SIZE) || '4');

// Apply board size restrictions if feature enabled
if(FEATURES.boardSizeToggle && sizeSel) {
  // Remove all options and add only 4x4 and 5x5
  sizeSel.innerHTML = '<option value="4">4×4</option><option value="5">5×5</option>';
  // Validate and set current size
  N = (N === 5) ? 5 : 4;  // Default to 4x4 if not 5x5
}

if(sizeSel){
  sizeSel.value=String(N);
  sizeSel.addEventListener('change',()=>{
    const newN = parseInt(sizeSel.value)||4;
    // Additional validation for restricted feature
    if(FEATURES.boardSizeToggle && newN !== 4 && newN !== 5) return;
    N = newN;
    localStorage.setItem(LS_SIZE,N);
    reset();
  });
}
let hintDepth=parseInt(diffSel?.value||'1');
diffSel?.addEventListener('change',()=>{
  hintDepth=parseInt(diffSel.value)||1;
});
const hud=HUD.create({title:'2048', onPauseToggle:()=>{}, onRestart:()=>reset()});

const gameOverOverlay=document.getElementById('gameOverOverlay');
const gameOverTitle=document.getElementById('gameOverTitle');
const gameOverMessage=document.getElementById('gameOverMessage');
const overlayRestartBtn=document.getElementById('overlayRestart');
const overlayBackBtn=document.getElementById('overlayBack');
let gameOverShown=false;

const MAX_UNDO = FEATURES.oneStepUndo ? 1 : 3;
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

// Merge-streak multiplier system
let mergeStreak = 1;      // Current streak multiplier (x1, x2, x3...)
let lastMoveHadMerge = false;

// Animation state
let anim=null;
let newTileAnim = null;   // Animation for new tiles scaling in
let mergedAnim = new Map(); // Track merged tiles animation with decay timing

function updateStatus(){
  const el=document.getElementById('status');
  if(el) el.textContent=`You: ${score} Opponent: ${oppScore||0}`;
}

function drawOpponent(){
  if(!oppCtx||!oppGrid) return;
  const theme=themes[currentTheme];
  oppCtx.fillStyle=theme.boardBg;
  oppCtx.fillRect(0,0,oppC.width,oppC.height);
  oppCtx.fillStyle=theme.text;
  oppCtx.font='16px Inter,system-ui';
  oppCtx.fillText(`Opponent: ${oppScore}`,12,20);
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const v=oppGrid[y]?.[x]||0; const px=PAD + x*(S+GAP); const py=40 + y*(S+GAP);
    oppCtx.fillStyle=v?tileColor(v):theme.empty; oppCtx.strokeStyle=oppC.style.borderColor; oppCtx.lineWidth=1;
    roundRect(oppCtx,px,py,S,S,10,true,true);
    if(v){ oppCtx.fillStyle=(v<=4)?theme.tileTextDark:theme.tileTextLight; oppCtx.font=(v<100)?'28px Inter':'24px Inter'; oppCtx.textAlign='center'; oppCtx.textBaseline='middle'; oppCtx.fillText(v,px+S/2,py+S/2+2); }
  }
}

function injectGarbage(count){
  for(let i=0;i<count;i++) addTile();
  check();
  draw();
  net?.send('move',{grid,score});
}

function updateCanvas(){
  c.width = 2*PAD + N*S + (N-1)*GAP;
  c.height = 40 + N*S + (N-1)*GAP + 30;
}

function applyTheme(){
  const t=themes[currentTheme];
  document.body.style.background=currentTheme==='dark'?'#0b1220':'#fafafa';
  document.body.style.color=t.text;
  c.style.borderColor=currentTheme==='dark'?'#243047':'#9ca3af';
  if(oppC) oppC.style.borderColor=c.style.borderColor;
  const hintBtn=document.getElementById('hintBtn');
  const themeBtn=document.getElementById('themeToggle');
  const sizeSel=document.getElementById('sizeSel');
  const diffSel=document.getElementById('diffSel');
  if(hintBtn){ hintBtn.style.background=t.empty; hintBtn.style.color=t.text; hintBtn.style.borderColor=c.style.borderColor; }
  if(themeBtn){ themeBtn.style.background=t.empty; themeBtn.style.color=t.text; themeBtn.style.borderColor=c.style.borderColor; themeBtn.textContent=currentTheme==='dark'?'Light':'Dark'; }
  if(sizeSel){ sizeSel.style.background=t.empty; sizeSel.style.color=t.text; sizeSel.style.borderColor=c.style.borderColor; }
  if(diffSel){ diffSel.style.background=t.empty; diffSel.style.color=t.text; diffSel.style.borderColor=c.style.borderColor; }
  if(gameOverOverlay){
    gameOverOverlay.style.background=currentTheme==='dark'?'rgba(11,18,32,0.7)':'rgba(15,23,42,0.45)';
    gameOverOverlay.setAttribute('aria-hidden', gameOverOverlay.classList.contains('hidden')?'true':'false');
    const panel=gameOverOverlay.querySelector('.modal-panel');
    if(panel){
      panel.style.background=currentTheme==='dark'?'#111827':'#f3f4f6';
      panel.style.color=t.text;
      panel.style.borderColor=currentTheme==='dark'?'#243047':'#d1d5db';
      panel.style.boxShadow=currentTheme==='dark'?'0 20px 40px rgba(15,23,42,0.45)':'0 20px 40px rgba(148,163,184,0.35)';
    }
    gameOverOverlay.querySelectorAll('.overlay-actions button').forEach(btn=>{
      btn.style.background=t.empty;
      btn.style.color=t.text;
      btn.style.borderColor=c.style.borderColor;
    });
  }
}

function reset(keepUndo=false){
  updateCanvas();
  grid=Array.from({length:N},()=>Array(N).fill(0));
  score=0; over=false; won=false; hintDir=null; anim=null;
  
  // Clean up animation state
  newTileAnim = null;
  mergedAnim.clear();
  
  // Reset merge-streak system
  mergeStreak = 1;
  lastMoveHadMerge = false;
  
  addTile(); addTile();
  history=[{grid:copyGrid(grid), score:0}];
  if(!keepUndo){ undoLeft=MAX_UNDO; localStorage.setItem(LS_UNDO,undoLeft); }
  net?.send('move',{grid,score});
  hideGameOverModal();
}

function addTile(){
  const empty=[];
  for(let y=0;y<N;y++) for(let x=0;x<N;x++) if(!grid[y][x]) empty.push([x,y]);
  if(!empty.length) return;
  const [x,y]=empty[(Math.random()*empty.length)|0];
  const value = Math.random()<0.9?2:4;
  grid[y][x] = value;
  
  // Create scale-in animation for new tile
  newTileAnim = {
    x, y, value,
    scale: 0,
    p: 0
  };
}

function undoMove(){
  if(anim) return;
  if(undoLeft>0){
    const res=undoState(history);
    if(res){
      ({grid,score,history}=res);
      undoLeft--; localStorage.setItem(LS_UNDO,undoLeft);
      over=false; won=false; hintDir=null;
      
      // Clean up animation state on undo
      newTileAnim = null;
      mergedAnim.clear();
      
      // Reset merge-streak system on undo
      mergeStreak = 1;
      lastMoveHadMerge = false;
      
      hideGameOverModal();
      net?.send('move',{grid,score});
    }
  }
}

function move(dir){
  if(over||won||anim) return;
  history = pushState(history, grid, score);
  const {after, animations, moved, gained}=computeMove(grid,dir);
  if(!moved){ history = history.slice(0,-1); return; }
  
  // Track merged tiles for animation
  mergedAnim.clear();
  animations.forEach(a => {
    if(after[a.toY][a.toX] !== a.value) { // This is a merge
      mergedAnim.set(`${a.toX},${a.toY}`, { p: 0, scale: 1.1 });
    }
  });

  // Merge-streak multiplier system
  if(FEATURES.mergeStreaks) {
    const hadMerge = gained > 0;
    if(hadMerge && lastMoveHadMerge) {
      mergeStreak = Math.min(mergeStreak + 1, 10); // Cap at x10
    } else if(hadMerge) {
      mergeStreak = 2; // Start streak at x2
    } else {
      mergeStreak = 1; // Reset streak
    }
    lastMoveHadMerge = hadMerge;
    
    // Apply multiplier to gained score
    const multipliedGain = Math.floor(gained * mergeStreak);
    score += multipliedGain;
  } else {
    score += gained;
  }
  
  if(score>best){ best=score; localStorage.setItem(LS_BEST,best); }
  if(gained>=128) net?.send('garbage',{count:1});
  const base=copyGrid(grid);
  animations.forEach(a=>{ base[a.fromY][a.fromX]=0; });
  anim={base, tiles:animations, after, p:0};
}

function hideGameOverModal(){
  if(gameOverOverlay){
    gameOverOverlay.classList.add('hidden');
    gameOverOverlay.setAttribute('aria-hidden','true');
  }
  gameOverShown=false;
}

function showGameOverModal(title,message){
  if(!gameOverOverlay) return;
  if(gameOverTitle) gameOverTitle.textContent=title;
  if(gameOverMessage) gameOverMessage.textContent=message;
  gameOverOverlay.classList.remove('hidden');
  gameOverOverlay.setAttribute('aria-hidden','false');
  overlayRestartBtn?.focus();
  gameOverShown=true;
}

function check(){
  won = won || grid.flat().some(v=>v>=2048);
  over = !won && !canMove(grid);
  if((won||over) && !gameOverShown){
    showGameOverModal(won?'2048!':'Game over', won?'You made 2048! Want to go again?':'No moves left. Try again?');
  }
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
  const streakText = FEATURES.mergeStreaks && mergeStreak > 1 ? ` Streak:x${mergeStreak}` : '';
  ctx.fillText(`Score: ${score} Best: ${best} Undo:${undoLeft}${streakText}`,12,20);
  const base=anim?anim.base:grid;
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    // Skip rendering base tile if new tile animation is active at this position
    if(newTileAnim && newTileAnim.x === x && newTileAnim.y === y) {
      // Draw empty cell background only
      const px=PAD + x*(S+GAP); const py=40 + y*(S+GAP);
      ctx.fillStyle=theme.empty; ctx.strokeStyle=c.style.borderColor; ctx.lineWidth=1;
      roundRect(ctx,px,py,S,S,10,true,true);
      continue;
    }
    
    const v=base[y][x]; const px=PAD + x*(S+GAP); const py=40 + y*(S+GAP);
    
    // Check if this is a merged tile for scale effect
    let scale = 1;
    const mergedKey = `${x},${y}`;
    if(mergedAnim.has(mergedKey) && !anim) {
      scale = mergedAnim.get(mergedKey).scale;
    }
    
    ctx.fillStyle=v?tileColor(v):theme.empty; ctx.strokeStyle=c.style.borderColor; ctx.lineWidth=1;
    roundRect(ctx,px,py,S,S,10,true,true,scale);
    if(v){ 
      if(scale !== 1) {
        ctx.save();
        const cx = px + S/2, cy = py + S/2;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);
      }
      ctx.fillStyle=(v<=4)?theme.tileTextDark:theme.tileTextLight; 
      ctx.font=(v<100)?'28px Inter':'24px Inter'; 
      ctx.textAlign='center'; ctx.textBaseline='middle'; 
      ctx.fillText(v,px+S/2,py+S/2+2);
      if(scale !== 1) ctx.restore();
    }
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
  
  // Render new tile scale-in animation
  if(newTileAnim && newTileAnim.scale > 0) {
    const px = PAD + newTileAnim.x * (S + GAP);
    const py = 40 + newTileAnim.y * (S + GAP);
    const v = newTileAnim.value;
    const scale = newTileAnim.scale;
    
    ctx.fillStyle = tileColor(v);
    ctx.strokeStyle = c.style.borderColor;
    ctx.lineWidth = 1;
    roundRect(ctx, px, py, S, S, 10, true, true, scale);
    
    if(scale > 0.3) { // Only show text when tile is big enough
      ctx.save();
      const cx = px + S/2, cy = py + S/2;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      
      ctx.fillStyle = (v <= 4) ? theme.tileTextDark : theme.tileTextLight;
      ctx.font = (v < 100) ? '28px Inter' : '24px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(v, px + S/2, py + S/2 + 2);
      
      ctx.restore();
    }
  }
  
  if(hintDir!=null){ ctx.fillText('Hint: '+['Left','Up','Right','Down'][hintDir],12,c.height-12); }
  updateStatus();
  drawOpponent();
}

function tileColor(v){
  const m=themes[currentTheme].tileColors;
  return m[v]||m.default;
}

function roundRect(ctx,x,y,w,h,r,fill,stroke,scale=1){
  if(typeof r==='number'){ r={tl:r,tr:r,br:r,bl:r}; }
  
  if(scale !== 1) {
    ctx.save();
    const cx = x + w/2, cy = y + h/2;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }
  
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
  
  if(scale !== 1) {
    ctx.restore();
  }
}

function getHint(){
  hintDir=engineHint(grid,hintDepth);
}

const gameLoop=new GameEngine();
gameLoop.update=dt=>{
  if(anim){
    anim.p+=dt*1000/ANIM_TIME;
    if(anim.p>=1){
      grid=anim.after;
      anim=null;
      
      // Reset merge animations to start the pulse effect now that slide is complete
      for(const [key, mergeAnim] of mergedAnim.entries()) {
        mergeAnim.p = 0;
        mergeAnim.scale = 1.1;
      }
      
      addTile();
      check();
      net?.send('move',{grid,score});
    }
  }
  
  // Update new tile scale-in animation
  if(newTileAnim){
    newTileAnim.p += dt*1000/(ANIM_TIME*1.5); // Slower for better visibility
    newTileAnim.scale = Math.min(newTileAnim.p, 1);
    if(newTileAnim.p >= 1){
      newTileAnim = null;
    }
  }
  
  // Update merged tile pulse animations (decay from 1.1 to 1.0 over ~150ms)
  const MERGE_ANIM_TIME = ANIM_TIME * 1.25;
  for(const [key, anim] of mergedAnim.entries()) {
    anim.p += dt*1000/MERGE_ANIM_TIME;
    if(anim.p >= 1) {
      mergedAnim.delete(key);
    } else {
      // Decay scale from 1.1 to 1.0
      anim.scale = 1.1 - (anim.p * 0.1);
    }
  }
};
gameLoop.render=()=>{ draw(anim?{base:anim.base,tiles:anim.tiles,p:Math.min(anim.p,1)}:null); };

document.getElementById('hintBtn')?.addEventListener('click',()=>{ getHint(); });
document.getElementById('themeToggle')?.addEventListener('click',()=>{
  currentTheme=currentTheme==='dark'?'light':'dark';
  localStorage.setItem(LS_THEME,currentTheme);
  applyTheme();
  draw();
});

overlayRestartBtn?.addEventListener('click',()=>{ hideGameOverModal(); reset(); });
overlayBackBtn?.addEventListener('click',()=>{
  hideGameOverModal();
  if(window.history.length>1) window.history.back();
  else window.location.href='../../';
});

net?.on('move',msg=>{ oppGrid=msg.grid; oppScore=msg.score; drawOpponent(); updateStatus(); });
net?.on('garbage',msg=>injectGarbage(msg.count||1));
net?.on('start',()=>{
  document.getElementById('lobby')?.style.setProperty('display','none');
  document.getElementById('game')?.style.removeProperty('display');
  reset(true);
  net?.send('move',{grid,score});
});

applyTheme();
reset(true);
gameLoop.start();
net?.send('move',{grid,score});
window.DIAG?.ready?.();
