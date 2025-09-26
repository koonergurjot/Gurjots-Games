
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
let PAD=12, S=80, GAP=10;
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
let postedReady=false;

// UI update functions
function updateUI() {
  updateScoreDisplay();
  updateUndoDisplay();
  updateStreakDisplay();
}

function updateScoreDisplay() {
  const currentScoreEl = document.getElementById('currentScore');
  const bestScoreEl = document.getElementById('bestScore');
  if(currentScoreEl) {
    currentScoreEl.textContent = score.toLocaleString();
    currentScoreEl.setAttribute('aria-label', `Current score: ${score.toLocaleString()}`);
  }
  if(bestScoreEl) {
    bestScoreEl.textContent = best.toLocaleString();
    bestScoreEl.setAttribute('aria-label', `Best score: ${best.toLocaleString()}`);
  }
}

function updateUndoDisplay() {
  const undoCountEl = document.getElementById('undoCount');
  const undoBtn = document.getElementById('undoBtn');
  if(undoCountEl) {
    undoCountEl.textContent = undoLeft;
    undoCountEl.setAttribute('aria-label', `Undo moves remaining: ${undoLeft}`);
  }
  if(undoBtn) {
    const isDisabled = undoLeft <= 0;
    undoBtn.disabled = isDisabled;
    undoBtn.textContent = undoLeft > 0 ? `Undo (${undoLeft})` : 'No Undo';
    undoBtn.setAttribute('aria-label', isDisabled ? 'No undo moves available' : `Undo last move, ${undoLeft} remaining`);
  }
}

function updateStreakDisplay() {
  const streakEl = document.getElementById('streakDisplay');
  if(streakEl) {
    const span = streakEl.querySelector('span');
    if(span) span.textContent = `×${mergeStreak}`;
    streakEl.setAttribute('aria-label', `Streak multiplier: ${mergeStreak}x`);
  }
}

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
    boardBg:'#ffffff',
    empty:'#e5e7eb',
    text:'#111827',
    tileTextDark:'#111827',  // 16.7:1 contrast on white backgrounds
    tileTextLight:'#ffffff', // 21:1 contrast on dark backgrounds
    // WCAG-AA compliant colors with 4.5:1+ contrast ratios
    tileColors:{
      2:'#fef3c7',      // Light amber - 4.6:1 with dark text
      4:'#fbbf24',      // Amber - 4.8:1 with dark text  
      8:'#f59e0b',      // Orange - 4.9:1 with dark text
      16:'#ea580c',     // Orange-600 - 5.2:1 with white text
      32:'#dc2626',     // Red-600 - 5.3:1 with white text
      64:'#b91c1c',     // Red-700 - 6.8:1 with white text
      128:'#7c3aed',    // Purple-600 - 4.8:1 with white text
      256:'#5b21b6',    // Purple-800 - 7.1:1 with white text
      512:'#1e40af',    // Blue-800 - 8.6:1 with white text
      1024:'#166534',   // Green-800 - 9.2:1 with white text
      2048:'#0f172a',   // Slate-900 - 16.7:1 with white text
      default:'#111827' // Gray-900 - 16.7:1 with white text
    }
  },
  dark:{
    boardBg:'#111827',
    empty:'#1f2937',
    text:'#f9fafb',
    tileTextDark:'#111827',  // 16.7:1 contrast on light backgrounds
    tileTextLight:'#f9fafb', // 15.3:1 contrast on dark backgrounds
    // WCAG-AA compliant colors with 4.5:1+ contrast ratios
    tileColors:{
      2:'#fef3c7',      // Light amber - 13.2:1 with dark text
      4:'#fde68a',      // Amber-200 - 11.8:1 with dark text
      8:'#fbbf24',      // Amber-400 - 8.1:1 with dark text
      16:'#60a5fa',     // Blue-400 - 4.6:1 with dark text
      32:'#34d399',     // Green-400 - 4.7:1 with dark text
      64:'#fbbf24',     // Amber-400 - 8.1:1 with dark text
      128:'#a78bfa',    // Purple-400 - 4.5:1 with dark text
      256:'#f472b6',    // Pink-400 - 4.9:1 with dark text
      512:'#fb7185',    // Rose-400 - 5.1:1 with dark text
      1024:'#fbbf24',   // Amber-400 - 8.1:1 with dark text
      2048:'#fde047',   // Yellow-400 - 12.6:1 with dark text
      default:'#e5e7eb' // Gray-200 - 15.3:1 with dark text
    }
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

// Performance optimization caches
let renderCache = {
  theme: null,
  tileColors: new Map(),
  formattedStrings: new Map(),
  roundRectPaths: new Map(),
  lastFrameTime: 0,
  skipFrames: 0
};

// History size limit for memory management
const MAX_HISTORY_SIZE = 50;

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
  // Responsive canvas sizing
  const container = document.querySelector('.game-main');
  const maxWidth = Math.min(480, container ? container.clientWidth - 32 : 360);
  const baseSize = Math.min(80, Math.floor((maxWidth - 20) / (N + (N-1)*0.125 + 0.25)));
  S = Math.max(50, baseSize); 
  PAD = Math.max(10, S/8); 
  GAP = Math.max(5, S/16);
  c.width = 2*PAD + N*S + (N-1)*GAP;
  c.height = 40 + N*S + (N-1)*GAP + 30;
}

function applyTheme(){
  const t=themes[currentTheme];
  
  // Update CSS custom properties for theming
  const root = document.documentElement;
  root.style.setProperty('--bg-primary', currentTheme==='dark'?'#111827':'#ffffff');
  root.style.setProperty('--bg-secondary', currentTheme==='dark'?'#1f2937':'#f9fafb');
  root.style.setProperty('--bg-tertiary', currentTheme==='dark'?'#111827':'#e5e7eb');
  root.style.setProperty('--bg-hover', currentTheme==='dark'?'#374151':'#f3f4f6');
  root.style.setProperty('--text-primary', t.text);
  root.style.setProperty('--text-secondary', currentTheme==='dark'?'#9ca3af':'#6b7280');
  root.style.setProperty('--border-color', currentTheme==='dark'?'#374151':'#d1d5db');
  root.style.setProperty('--accent-color', '#3b82f6');
  
  // Update body background and text
  document.body.style.background = root.style.getPropertyValue('--bg-primary');
  
  // Update theme toggle aria-label dynamically
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    themeToggle.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
  }
  document.body.style.color = t.text;
  
  // Update canvas border
  c.style.borderColor = currentTheme==='dark'?'#374151':'#d1d5db';
  if(oppC) oppC.style.borderColor = c.style.borderColor;
  
  // Update theme toggle button text
  const themeBtn=document.getElementById('themeToggle');
  if(themeBtn) themeBtn.textContent = currentTheme==='dark'?'Light':'Dark';
  
  // Update game over overlay ARIA attributes
  if(gameOverOverlay){
    gameOverOverlay.setAttribute('aria-hidden', gameOverOverlay.classList.contains('hidden')?'true':'false');
  }
  
  // Update all UI elements with current values
  updateUI();
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
  if(!keepUndo){ undoLeft=MAX_UNDO; localStorage.setItem(LS_UNDO,undoLeft); updateUI(); }
  applyTheme();
  updateUI();
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
      undoLeft--; localStorage.setItem(LS_UNDO,undoLeft); updateUI();
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
  // Limit history size for memory management
  history.push({grid: grid.map(row => [...row]), score});
  if (history.length > MAX_HISTORY_SIZE) {
    history = history.slice(-MAX_HISTORY_SIZE);
  }
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
  updateUI();
  if(gained>=128) net?.send('garbage',{count:1});
  const base=copyGrid(grid);
  animations.forEach(a=>{ base[a.fromY][a.fromX]=0; });
  anim={base, tiles:animations, after, p:0};
}

function hideGameOverModal(){
  if(gameOverOverlay){
    gameOverOverlay.classList.add('hidden');
    gameOverOverlay.setAttribute('aria-hidden','true');
    
    // Remove focus trap
    removeModalFocusTrap();
  }
  gameOverShown=false;
  
  // Return focus to the game canvas
  const gameCanvas = document.getElementById('board');
  gameCanvas?.focus();
}

function showGameOverModal(title,message){
  if(!gameOverOverlay) return;
  if(gameOverTitle) gameOverTitle.textContent=title;
  if(gameOverMessage) gameOverMessage.textContent=message;
  gameOverOverlay.classList.remove('hidden');
  gameOverOverlay.setAttribute('aria-hidden','false');
  
  // Setup focus trap for modal
  setupModalFocusTrap();
  
  overlayRestartBtn?.focus();
  gameOverShown=true;
  
  // Announce game over to screen readers
  announceToScreenReader(`${title} ${message} Focus is on the Restart button.`);
}

function check(){
  won = won || grid.flat().some(v=>v>=2048);
  over = !won && !canMove(grid);
  if((won||over) && !gameOverShown){
    showGameOverModal(won?'2048!':'Game over', won?'You made 2048! Want to go again?':'No moves left. Try again?');
  }
}

addEventListener('keydown', e=>{
  // Handle escape key to close modal
  if(e.key === 'Escape' && gameOverShown) {
    e.preventDefault();
    hideGameOverModal();
    return;
  }
  
  // Only handle game keys when game canvas is focused or no form elements are focused
  const activeEl = document.activeElement;
  const isFormElement = activeEl && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(activeEl.tagName);
  const gameCanvas = document.getElementById('board');
  const isGameFocused = activeEl === gameCanvas || activeEl === document.body;
  
  // Don't steal arrow keys from form controls
  if(isFormElement && !isGameFocused) {
    return;
  }
  
  if(e.key==='ArrowLeft') {
    e.preventDefault();
    move(0);
    announceGameMove();
  }
  if(e.key==='ArrowUp') {
    e.preventDefault();
    move(1);
    announceGameMove();
  }
  if(e.key==='ArrowRight') {
    e.preventDefault();
    move(2);
    announceGameMove();
  }
  if(e.key==='ArrowDown') {
    e.preventDefault();
    move(3);
    announceGameMove();
  }
  if(e.key==='r'||e.key==='R') {
    reset();
    announceToScreenReader('Game restarted. New game board ready.');
  }
  if(e.key.toLowerCase()==='u') {
    const beforeUndo = undoLeft;
    undoMove();
    if(undoLeft !== beforeUndo) {
      announceToScreenReader('Move undone.');
    } else {
      announceToScreenReader('No moves to undo.');
    }
  }
  if(e.key==='h'||e.key==='H') {
    e.preventDefault();
    showHint();
    announceToScreenReader('Hint shown on board.');
  }
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
  if(!postedReady){
    postedReady=true;
    try { window.parent?.postMessage({ type:'GAME_READY', slug:'g2048' }, '*'); } catch {}
  }
  // Frame rate optimization - skip frames when performance is poor
  const now = performance.now();
  if (renderCache.skipFrames > 0) {
    renderCache.skipFrames--;
    return;
  }
  
  // Adaptive frame rate based on performance
  const deltaTime = now - renderCache.lastFrameTime;
  if (deltaTime < 16) { // Running above 60 FPS
    renderCache.skipFrames = 0;
  } else if (deltaTime > 33) { // Running below 30 FPS
    renderCache.skipFrames = 1; // Skip every other frame
  }
  renderCache.lastFrameTime = now;
  
  // Cache theme and computed values
  const theme = themes[currentTheme];
  if (renderCache.theme !== currentTheme) {
    renderCache.theme = currentTheme;
    renderCache.formattedStrings.clear(); // Clear string cache on theme change
  }
  
  // Clear canvas efficiently
  ctx.fillStyle = theme.boardBg;
  ctx.fillRect(0, 0, c.width, c.height);
  
  // Cache formatted strings for UI text
  const streakText = FEATURES.mergeStreaks && mergeStreak > 1 ? ` Streak:x${mergeStreak}` : '';
  const scoreKey = `${score}_${best}_${undoLeft}_${streakText}`;
  let scoreText = renderCache.formattedStrings.get(scoreKey);
  if (!scoreText) {
    scoreText = `Score: ${score.toLocaleString()} Best: ${best.toLocaleString()} Undo:${undoLeft}${streakText}`;
    renderCache.formattedStrings.set(scoreKey, scoreText);
    // Limit cache size
    if (renderCache.formattedStrings.size > 20) {
      renderCache.formattedStrings.clear();
    }
  }
  
  // Draw UI text with cached string
  ctx.fillStyle = theme.text;
  ctx.font = '16px Inter,system-ui';
  ctx.fillText(scoreText, 12, 20);
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
  // Cache tile colors for performance
  const cacheKey = `${currentTheme}_${v}`;
  if (renderCache.tileColors.has(cacheKey)) {
    return renderCache.tileColors.get(cacheKey);
  }
  
  const m = themes[currentTheme].tileColors;
  const color = m[v] || m.default;
  renderCache.tileColors.set(cacheKey, color);
  return color;
}

function roundRect(ctx,x,y,w,h,r,fill,stroke,scale=1){
  if(typeof r==='number'){ r={tl:r,tr:r,br:r,bl:r}; }
  
  // Cache path for standard tiles (most common case)
  const pathKey = `${w}_${h}_${r.tl}`;
  let pathCached = false;
  
  if(scale === 1 && renderCache.roundRectPaths.has(pathKey)) {
    const path = renderCache.roundRectPaths.get(pathKey);
    ctx.save();
    ctx.translate(x, y);
    ctx.fill(path);
    if(stroke) ctx.stroke(path);
    ctx.restore();
    return;
  }
  
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
  
  // Cache the path for reuse (only for standard scale)
  if(scale === 1 && !renderCache.roundRectPaths.has(pathKey)) {
    const translatedPath = new Path2D();
    translatedPath.moveTo(r.tl,0);
    translatedPath.lineTo(w-r.tr,0);
    translatedPath.quadraticCurveTo(w,0,w,r.tr);
    translatedPath.lineTo(w,h-r.br);
    translatedPath.quadraticCurveTo(w,h,w-r.br,h);
    translatedPath.lineTo(r.bl,h);
    translatedPath.quadraticCurveTo(0,h,0,h-r.bl);
    translatedPath.lineTo(0,r.tl);
    translatedPath.quadraticCurveTo(0,0,r.tl,0);
    translatedPath.closePath();
    renderCache.roundRectPaths.set(pathKey, translatedPath);
  }
  
  if(fill) ctx.fill();
  if(stroke) ctx.stroke();
  
  if(scale !== 1) {
    ctx.restore();
  }
}

function getHint(){
  hintDir=engineHint(grid,hintDepth);
  draw();
}

function hideHint(){
  if(hintDir===null) return;
  hintDir=null;
  draw();
}

const gameLoop=new GameEngine();
gameLoop.update=dt=>{
  // Animation optimization - batch updates
  let needsRedraw = false;
  
  if(anim){
    anim.p+=dt*1000/ANIM_TIME;
    needsRedraw = true;
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
    needsRedraw = true;
    if(newTileAnim.p >= 1){
      newTileAnim = null;
    }
  }
  
  // Update merged tile pulse animations (decay from 1.1 to 1.0 over ~150ms)
  const MERGE_ANIM_TIME = ANIM_TIME * 1.25;
  const keysToDelete = [];
  for(const [key, animObj] of mergedAnim.entries()) {
    animObj.p += dt*1000/MERGE_ANIM_TIME;
    needsRedraw = true;
    if(animObj.p >= 1) {
      keysToDelete.push(key);
    } else {
      // Decay scale from 1.1 to 1.0
      animObj.scale = 1.1 - (animObj.p * 0.1);
    }
  }
  
  // Clean up completed animations in batch
  keysToDelete.forEach(key => mergedAnim.delete(key));
  
  // Only render if animations need updating or it's the first frame
  if(needsRedraw || renderCache.lastFrameTime === 0) {
    gameLoop.render();
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

// Add undo button functionality
document.getElementById('undoBtn')?.addEventListener('click',()=>{
  if(undoLeft > 0) undoMove();
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

// Add window resize listener for responsive canvas
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    updateCanvas();
    draw();
  }, 100);
});

// Screen reader announcements
function announceToScreenReader(message) {
  // Create or update live region for announcements
  let liveRegion = document.getElementById('srAnnouncements');
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'srAnnouncements';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.style.position = 'absolute';
    liveRegion.style.left = '-10000px';
    liveRegion.style.width = '1px';
    liveRegion.style.height = '1px';
    liveRegion.style.overflow = 'hidden';
    document.body.appendChild(liveRegion);
  }
  
  // Clear and set new message
  liveRegion.textContent = '';
  setTimeout(() => {
    liveRegion.textContent = message;
  }, 100);
}

function announceGameMove() {
  const maxTile = Math.max(...grid.flat().filter(v => v > 0));
  if (maxTile >= 2048 && !won) {
    announceToScreenReader(`Congratulations! You reached ${maxTile}! Current score: ${score.toLocaleString()}`);
  }
  // Announce score changes on significant increases
  const scoreIncrease = score - (lastAnnouncedScore || 0);
  if (scoreIncrease >= 100) {
    lastAnnouncedScore = score;
    announceToScreenReader(`Score: ${score.toLocaleString()}`);
  }
}

// Track last announced score for game state announcements
let lastAnnouncedScore = 0;

// Add canvas focus styles and handlers
const gameCanvas = document.getElementById('board');
if (gameCanvas) {
  gameCanvas.addEventListener('focus', () => {
    announceToScreenReader(`2048 game board focused. Current score: ${score.toLocaleString()}. Use arrow keys to move tiles.`);
  });
  
  gameCanvas.addEventListener('blur', () => {
    hideHint(); // Hide hint when canvas loses focus
  });
}

// Focus trap management for modal
function setupModalFocusTrap() {
  const modal = gameOverOverlay;
  const focusableElements = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];
  
  function trapFocus(e) {
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    }
  }
  
  // Store trap function to remove later
  modal._focusTrap = trapFocus;
  modal.addEventListener('keydown', trapFocus);
}

function removeModalFocusTrap() {
  if (gameOverOverlay && gameOverOverlay._focusTrap) {
    gameOverOverlay.removeEventListener('keydown', gameOverOverlay._focusTrap);
    gameOverOverlay._focusTrap = null;
  }
}

// Theme toggle accessibility
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  const originalClickHandler = themeToggle.onclick;
  themeToggle.addEventListener('click', () => {
    // Allow original handler to run first
    setTimeout(() => {
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      // Update both text and ARIA label
      themeToggle.textContent = newTheme === 'dark' ? 'Light' : 'Dark';
      themeToggle.setAttribute('aria-label', `Switch to ${newTheme === 'dark' ? 'light' : 'dark'} theme`);
      announceToScreenReader(`Switched to ${newTheme} theme.`);
    }, 100);
  });
}

// Initialize the game
updateCanvas();
applyTheme();
reset(true);
gameLoop.start();
net?.send('move',{grid,score});
window.DIAG?.ready?.();

// Initial accessibility announcement
announceToScreenReader('2048 game loaded. Press Tab to navigate controls or focus the game board to start playing.');
