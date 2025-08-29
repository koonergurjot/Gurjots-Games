const GAME_ID='tetris';GG.incPlays();
const c=document.getElementById('t');fitCanvasToParent(c,420,840,24);addEventListener('resize',()=>fitCanvasToParent(c,420,840,24));
const ctx=c.getContext('2d');
const COLS=10, ROWS=20, CELL=Math.floor(c.height/ROWS);
const COLORS=['#000','#8b5cf6','#22d3ee','#f59e0b','#ef4444','#10b981','#e879f9','#38bdf8'];
const SHAPES = { I:[[1,1,1,1]], O:[[2,2],[2,2]], T:[[0,3,0],[3,3,3]], S:[[0,4,4],[4,4,0]], Z:[[5,5,0],[0,5,5]], J:[[6,0,0],[6,6,6]], L:[[0,0,7],[7,7,7]] };
let grid = Array.from({length:ROWS},()=>Array(COLS).fill(0));
let bag = []; function nextFromBag(){ if(bag.length===0) bag = Object.keys(SHAPES); const idx=(Math.random()*bag.length)|0; const t=bag.splice(idx,1)[0]; return SHAPES[t].map(r=>r.slice()); }
let nextM = nextFromBag(); let holdM=null; let canHold=true;
let cur = spawn();
let score=0, level=1, lines=0, over=false, dropMs=700, last=0, paused=false;
function spawn(){ const m = nextM; nextM = nextFromBag(); return {m, x:3, y:0}; }
function rotate(m){ return m[0].map((_,i)=>m.map(r=>r[i]).reverse()); }
function collide(p){ for(let y=0;y<p.m.length;y++) for(let x=0;x<p.m[y].length;x++){ if(!p.m[y][x]) continue; const nx=p.x+x, ny=p.y+y; if (nx<0||nx>=COLS||ny>=ROWS||grid[ny]?.[nx]) return true; } return false; }
function merge(p){ for(let y=0;y<p.m.length;y++) for(let x=0;x<p.m[y].length;x++){ if(p.m[y][x]) grid[p.y+y][p.x+x]=p.m[y][x]; } }
let clearAnim=0;
function clearLines(){ let cleared=0; grid = grid.filter(r=> r.some(v=>!v)); cleared = ROWS - grid.length; while(grid.length<ROWS) grid.unshift(Array(COLS).fill(0)); if (cleared){ lines += cleared; score += [0,100,300,500,800][cleared] || cleared*200; GG.addXP(2*cleared); if (lines >= level*10) { level++; dropMs = Math.max(120, dropMs-60); } GG.setMeta(GAME_ID, 'Best lines: ' + lines); SFX.seq([[600,0.06],[800,0.06],[1000,0.06]].slice(0,cleared)); } }
function drawCell(x,y,v){ ctx.fillStyle = v? COLORS[v] : '#0f1320'; ctx.fillRect(x*CELL,y*CELL,CELL-1,CELL-1); }
function drawMatrix(m, ox, oy){ for(let y=0;y<m.length;y++) for(let x=0;x<m[y].length;x++){ if(!m[y][x]) continue; ctx.fillStyle = COLORS[m[y][x]]; ctx.fillRect(ox + x*CELL*0.8, oy + y*CELL*0.8, CELL*0.8-2, CELL*0.8-2); } }
function drawGhost(){ const g={m:cur.m.map(r=>r.slice()), x:cur.x, y:cur.y}; while(!collide(g)){ g.y++; } g.y--; ctx.globalAlpha=0.25; for(let y=0;y<g.m.length;y++) for(let x=0;x<g.m[y].length;x++){ if(g.m[y][x]) drawCell(g.x+x,g.y+y,g.m[y][x]); } ctx.globalAlpha=1; }
function draw(){ if(clearAnim>0){ clearAnim--; } for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) drawCell(x,y,grid[y][x]); drawGhost(); for(let y=0;y<cur.m.length;y++) for(let x=0;x<cur.m[y].length;x++){ if(cur.m[y][x]) drawCell(cur.x+x,cur.y+y,cur.m[y][x]); } ctx.fillStyle='#e6e7ea'; ctx.font='bold 14px Inter'; ctx.fillText(`Score ${score}`, 8, 20); ctx.fillText(`Level ${level}`, 8, 40); ctx.fillText(`Lines ${lines}`, 8, 60); const ox=COLS*CELL+16; ctx.fillText('NEXT', ox, 20); drawMatrix(nextM, ox, 30); ctx.fillText('HOLD (C)', ox, 120); if(holdM) drawMatrix(holdM, ox, 130); if (over){ ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(0,0,c.width,c.height); ctx.fillStyle='#e6e7ea'; ctx.font='bold 30px Inter'; ctx.fillText('Game Over',70,300); } if (paused){ ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(0,0,c.width,c.height); ctx.fillStyle='#e6e7ea'; ctx.font='bold 28px Inter'; ctx.fillText('Paused — P to resume', 40, c.height/2); } }
function drop(){ cur.y++; if (collide(cur)){ cur.y--; merge(cur); clearLines(); cur=spawn(); canHold=true; if (collide(cur)){ over=true; GG.addAch(GAME_ID,'Stacked'); } } }
function hardDrop(){ while(!collide(cur)){ cur.y++; } cur.y--; score += 2; }
function hold(){ if(!canHold) return; const temp=holdM; holdM=cur.m; if(temp){ cur={m:temp, x:3, y:0}; } else { cur=spawn(); } canHold=false; }
addEventListener('keydown', e=>{ if (over && e.key.toLowerCase()==='r'){ grid=Array.from({length:ROWS},()=>Array(COLS).fill(0)); cur=spawn(); score=0; level=1; lines=0; over=false; return; } if (e.key.toLowerCase()==='p'){ paused=!paused; return; } if (paused) return; if (e.key==='ArrowLeft'){ const nx=cur.x-1; const p={...cur, x:nx}; if(!collide(p)) cur.x=nx; } if (e.key==='ArrowRight'){ const nx=cur.x+1; const p={...cur, x:nx}; if(!collide(p)) cur.x=nx; } if (e.key==='ArrowUp'){ const R=rotate(cur.m); const p={...cur, m:R}; if(!collide(p)) { cur.m=R; SFX.beep({freq:500,dur:0.03}); } } if (e.key==='ArrowDown'){ drop(); SFX.beep({freq:500,dur:0.03}); GG.addXP(1); } if (e.code==='Space'){ hardDrop(); SFX.seq([[600,0.05],[700,0.05]]); merge(cur); clearLines(); cur=spawn(); canHold=true; } if (e.key.toLowerCase()==='c'){ hold(); } });
function loop(ts){ if(!last) last=ts; if(!paused && ts-last>dropMs){ drop(); last=ts; } ctx.clearRect(0,0,c.width,c.height); draw(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
