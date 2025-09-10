(function(){
const c=document.getElementById('board'), ctx=c.getContext('2d'); const S=60;
const hud=HUD.create({title:'Chess', onPauseToggle:()=>{}, onRestart:()=>reset()});
const statusEl=document.getElementById('status');
const depthEl=document.getElementById('difficulty');
const COLS=8, ROWS=8;
const EMPTY = '.';
// Simple FEN start
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const COLORS={w:1,b:-1};
let board=[], turn='w', sel=null, moves=[], over=false;
let lastMove=null; let premove=null;

function reset(){ board = parseFEN(START); turn='w'; sel=null; moves=[]; over=false; draw(); status('White to move'); }
function parseFEN(f){ const rows=f.split('/'); const b=[]; for(const r of rows){ const row=[]; for(const ch of r){ if(/[1-8]/.test(ch)){ for(let i=0;i<Number(ch);i++) row.push(EMPTY);} else row.push(ch);} b.push(row);} return b; }
function boardToFEN(){
  const rows=[];
  for(const r of board){
    let line=""; let count=0;
    for(const p of r){
      if(p===EMPTY){ count++; }
      else {
        if(count){ line+=count; count=0; }
        line+=p;
      }
    }
    if(count) line+=count;
    rows.push(line);
  }
  return rows.join('/');
}
function pieceAt(x,y){ if(y<0||y>=8||x<0||x>=8) return null; return board[y][x]; }
function colorOf(p){ if(!p||p===EMPTY) return null; return (p===p.toUpperCase())?'w':'b'; }
function toUpper(p){return p.toUpperCase();}
function same(a,b){return a.x===b.x&&a.y===b.y;}

function genMoves(x,y){
  const p=pieceAt(x,y); if(!p||p===EMPTY) return [];
  const isW = colorOf(p)==='w';
  const capdir = isW? -1: 1;
  const res=[]; const P=toUpper(p);
  function push(nx,ny,capOnly=false,quietOnly=false){
    const t=pieceAt(nx,ny); if(nx<0||nx>=8||ny<0||ny>=8) return;
    if(t!==EMPTY && colorOf(t)===colorOf(p)) return;
    if(capOnly && (t===EMPTY)) return;
    if(quietOnly && (t!==EMPTY)) return;
    res.push({x:nx,y:ny});
  }
  if(P==='P'){
    const dir = isW? -1: +1;
    push(x, y+dir, false, true);
    if((isW&&y===6) || (!isW&&y===1)){ if(pieceAt(x,y+dir)===EMPTY && pieceAt(x,y+2*dir)===EMPTY) push(x,y+2*dir,false,true); }
    push(x-1, y+dir, true, false);
    push(x+1, y+dir, true, false);
  } else if(P==='N'){
    [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]].forEach(d=>push(x+d[0], y+d[1]));
  } else if(P in {'B':1,'R':1,'Q':1}){
    const dirs = (P==='B')? [[1,1],[-1,1],[1,-1],[-1,-1]] : (P==='R')? [[1,0],[-1,0],[0,1],[0,-1]] : [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){
      let nx=x+dx, ny=y+dy;
      while(nx>=0&&nx<8&&ny>=0&&ny<8){
        const t=pieceAt(nx,ny);
        if(t===EMPTY){ res.push({x:nx,y:ny}); }
        else { if(colorOf(t)!==colorOf(p)) res.push({x:nx,y:ny}); break; }
        nx+=dx; ny+=dy;
      }
    }
  } else if(P==='K'){
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){ if(dx||dy) push(x+dx,y+dy); }
  }
  // Filter out moves that leave own king in check (basic legality)
  const legal=[];
  for(const m of res){
    const saved = board[m.y][m.x]; const from = board[y][x];
    board[m.y][m.x]=board[y][x]; board[y][x]=EMPTY;
    if(!inCheck(colorOf(from))) legal.push(m);
    board[y][x]=from; board[m.y][m.x]=saved;
  }
  return legal;
}

function kingPos(side){ for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=pieceAt(x,y); if(p!==EMPTY && toUpper(p)==='K' && colorOf(p)===side) return {x,y}; } return null; }
function inCheck(side){
  const k=kingPos(side); if(!k) return false;
  // naive: see if any enemy move attacks k
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=pieceAt(x,y); if(p===EMPTY || colorOf(p)===side) continue;
    const ms = genMovesNoFilter(x,y); // pseudo
    if(ms.some(m=>m.x===k.x && m.y===k.y)) return true;
  }
  return false;
}
function genMovesNoFilter(x,y){ // like genMoves but no legality filter
  const p=pieceAt(x,y); if(!p||p===EMPTY) return [];
  const isW = colorOf(p)==='w';
  const res=[]; const P=toUpper(p);
  function push(nx,ny,capOnly=false,quietOnly=false){
    const t=pieceAt(nx,ny); if(nx<0||nx>=8||ny<0||ny>=8) return;
    if(t!==EMPTY && colorOf(t)===colorOf(p)) return;
    if(capOnly && (t===EMPTY)) return;
    if(quietOnly && (t!==EMPTY)) return;
    res.push({x:nx,y:ny});
  }
  if(P==='P'){
    const dir = isW? -1: +1;
    push(x+1, y+dir, true, false);
    push(x-1, y+dir, true, false);
    // (No en passant / promotions in pseudo)
  } else if(P==='N'){
    [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]].forEach(d=>push(x+d[0], y+d[1]));
  } else if(P in {'B':1,'R':1,'Q':1}){
    const dirs = (P==='B')? [[1,1],[-1,1],[1,-1],[-1,-1]] : (P==='R')? [[1,0],[-1,0],[0,1],[0,-1]] : [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of dirs){
      let nx=x+dx, ny=y+dy;
      while(nx>=0&&nx<8&&ny>=0&&ny<8){
        const t=pieceAt(nx,ny);
        if(t===EMPTY){ res.push({x:nx,y:ny}); }
        else { if(colorOf(t)!==colorOf(p)) res.push({x:nx,y:ny}); break; }
        nx+=dx; ny+=dy;
      }
    }
  } else if(P==='K'){
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){ if(dx||dy) push(x+dx,y+dy); }
  }
  return res;
}

function status(t){ statusEl.textContent=t; }
function draw(){
  ctx.clearRect(0,0,c.width,c.height);
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const light=((x+y)%2)===0;
    ctx.fillStyle=light?'#182235':'#0f172a';
    ctx.fillRect(x*S,y*S,S,S);
  }
  if(sel){
    ctx.fillStyle='rgba(80,200,255,.25)';
    ctx.fillRect(sel.x*S, sel.y*S, S,S);
    ctx.fillStyle='rgba(80,200,255,.25)';
    moves.forEach(m=>{ ctx.beginPath(); ctx.arc(m.x*S+S/2, m.y*S+S/2, 10, 0, Math.PI*2); ctx.fill(); });
  }
  if(lastMove){ ctx.fillStyle='rgba(255,230,0,0.18)'; ctx.fillRect(lastMove.from.x*S,lastMove.from.y*S,S,S); ctx.fillRect(lastMove.to.x*S,lastMove.to.y*S,S,S); }
  // draw pieces (simple text glyphs)
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=pieceAt(x,y); if(p===EMPTY) continue;
    ctx.fillStyle= (colorOf(p)==='w') ? '#e6e7ea' : '#8aa3ff';
    ctx.font='36px system-ui,Segoe UI,Inter';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    const map={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙'};
    const g = map[toUpper(p)];
    ctx.fillText(g, x*S+S/2, y*S+S/2+2);
  }
}

function aiMove(){
  if(over) return;
  const depth=parseInt(depthEl.value,10)||1;
  const fen=boardToFEN()+" "+turn;
  const move=ai.bestMove(fen, depth);
  if(!move) return;
  board[move.to.y][move.to.x]=board[move.from.y][move.from.x];
  board[move.from.y][move.from.x]=EMPTY;
  lastMove={from:{x:move.from.x,y:move.from.y},to:{x:move.to.x,y:move.to.y}};
  turn='w';
  if(checkmate(turn)){ status('White in checkmate!'); over=true; }
  else if(inCheck(turn)){ status('White to move — CHECK!'); }
  else status('White to move');
  draw();
}
c.addEventListener('click', (e)=>{
  if(over) return;
  const r=c.getBoundingClientRect();
  const x=((e.clientX-r.left)/S)|0, y=((e.clientY-r.top)/S)|0;
  if(!sel){
    const p=pieceAt(x,y); if(!p||p===EMPTY||colorOf(p)!==turn) return;
    sel={x,y}; moves=genMoves(x,y); draw(); return;
  } else {
    const m = moves.find(mm=>mm.x===x&&mm.y===y);
    if(m){
        const from={x:sel.x,y:sel.y};
        board[m.y][m.x]=board[sel.y][sel.x]; board[sel.y][sel.x]=EMPTY; lastMove={from,to:{x:m.x,y:m.y}};
        sel=null; moves=[]; turn = (turn==='w'?'b':'w');
        // if premove set and it's now your color, execute if legal
        if(premove && colorOf(pieceAt(premove.from.x,premove.from.y))===turn){
        const legal=genMoves(premove.from.x,premove.from.y).find(z=>z.x===premove.to.x&&z.y===premove.to.y);
        if(legal){ sel={x:premove.from.x,y:premove.from.y}; moves=[legal]; const fakeEvt={clientX:(legal.x+0.5)*S + r.left, clientY:(legal.y+0.5)*S + r.top}; // not used further
          board[legal.y][legal.x]=board[sel.y][sel.x]; board[sel.y][sel.x]=EMPTY; lastMove={from:{x:sel.x,y:sel.y},to:{x:legal.x,y:legal.y}}; sel=null; moves=[]; turn=(turn==='w'?'b':'w'); }
        premove=null;
      }
        if (checkmate(turn)){ status((turn==='w'?'White':'Black')+' in checkmate!'); over=true; draw(); return; }
        if(turn==='b'){ draw(); status('AI thinking...'); setTimeout(aiMove,20); return; }
        if (inCheck(turn)){ status('White to move — CHECK!'); }
        else status('White to move');
        draw(); return;
    } else { sel=null; moves=[]; draw(); }
  }
});
// Right-click to set premove
c.addEventListener('contextmenu',(e)=>{ e.preventDefault(); const r=c.getBoundingClientRect(); const x=((e.clientX-r.left)/S)|0, y=((e.clientY-r.top)/S)|0; if(!sel){ const p=pieceAt(x,y); if(!p||p===EMPTY||colorOf(p)!==turn) return; sel={x,y}; moves=genMoves(x,y); draw(); } else { const m=moves.find(mm=>mm.x===x&&mm.y===y); if(m){ premove={from:{x:sel.x,y:sel.y}, to:{x:m.x,y:m.y}}; sel=null; moves=[]; status('Premove set'); draw(); } else { sel=null; moves=[]; draw(); } } });
function checkmate(side){
  // if in check and no legal moves
  if(!inCheck(side)) return false;
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=pieceAt(x,y); if(p===EMPTY||colorOf(p)!==side) continue;
    const ms=genMoves(x,y); if(ms.length) return false;
  }
  return true;
}
addEventListener('keydown', e=>{ if(e.key==='r'||e.key==='R') reset(); });
reset();
})();