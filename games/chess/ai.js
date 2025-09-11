(function(global){
  const EMPTY='.';
  const pieceValues={P:1,N:3,B:3,R:5,Q:9,K:1000};
  const pst={
    P:[0,0,0,0,0,0,0,0,
       0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,
       0.1,0.1,0.2,0.3,0.3,0.2,0.1,0.1,
       0,0,0,0.2,0.2,0,0,0,
       0,0,0,-0.2,-0.2,0,0,0,
       0.1,-0.1,-0.2,0,0,-0.2,-0.1,0.1,
       0.1,0.2,0.2,-0.2,-0.2,0.2,0.2,0.1,
       0,0,0,0,0,0,0,0],
    N:[-0.5,-0.4,-0.3,-0.3,-0.3,-0.3,-0.4,-0.5,
       -0.4,-0.2,0,0,0,0,-0.2,-0.4,
       -0.3,0,0.1,0.15,0.15,0.1,0,-0.3,
       -0.3,0.05,0.15,0.2,0.2,0.15,0.05,-0.3,
       -0.3,0,0.15,0.2,0.2,0.15,0,-0.3,
       -0.3,0.05,0.1,0.15,0.15,0.1,0.05,-0.3,
       -0.4,-0.2,0,0.05,0.05,0,-0.2,-0.4,
       -0.5,-0.4,-0.3,-0.3,-0.3,-0.3,-0.4,-0.5],
    B:[-0.2,-0.1,-0.1,-0.1,-0.1,-0.1,-0.1,-0.2,
       -0.1,0,0,0,0,0,0,-0.1,
       -0.1,0,0.05,0.1,0.1,0.05,0,-0.1,
       -0.1,0.05,0.05,0.1,0.1,0.05,0.05,-0.1,
       -0.1,0,0.1,0.1,0.1,0.1,0,-0.1,
       -0.1,0.1,0.1,0.1,0.1,0.1,0.1,-0.1,
       -0.1,0.05,0,0,0,0,0.05,-0.1,
       -0.2,-0.1,-0.1,-0.1,-0.1,-0.1,-0.1,-0.2],
    R:[0,0,0,0,0,0,0,0,
       0.05,0.1,0.1,0.1,0.1,0.1,0.1,0.05,
       -0.05,0,0,0,0,0,0,-0.05,
       -0.05,0,0,0,0,0,0,-0.05,
       -0.05,0,0,0,0,0,0,-0.05,
       -0.05,0,0,0,0,0,0,-0.05,
       -0.05,0,0,0,0,0,0,-0.05,
       0,0,0,0.05,0.05,0,0,0],
    Q:[-0.2,-0.1,-0.1,-0.05,-0.05,-0.1,-0.1,-0.2,
       -0.1,0,0,0,0,0,0,-0.1,
       -0.1,0,0.05,0.05,0.05,0.05,0,-0.1,
       -0.05,0,0.05,0.05,0.05,0.05,0,-0.05,
       0,0,0.05,0.05,0.05,0.05,0,-0.05,
       -0.1,0.05,0.05,0.05,0.05,0.05,0,-0.1,
       -0.1,0,0.05,0,0,0,0,-0.1,
       -0.2,-0.1,-0.1,-0.05,-0.05,-0.1,-0.1,-0.2],
    K:[-0.3,-0.4,-0.4,-0.5,-0.5,-0.4,-0.4,-0.3,
       -0.3,-0.4,-0.4,-0.5,-0.5,-0.4,-0.4,-0.3,
       -0.3,-0.4,-0.4,-0.5,-0.5,-0.4,-0.4,-0.3,
       -0.3,-0.4,-0.4,-0.5,-0.5,-0.4,-0.4,-0.3,
       -0.2,-0.3,-0.3,-0.4,-0.4,-0.3,-0.3,-0.2,
       -0.1,-0.2,-0.2,-0.2,-0.2,-0.2,-0.2,-0.1,
       0.2,0.2,0,0,0,0,0.2,0.2,
       0.2,0.3,0.1,0,0,0.1,0.3,0.2]
  };
  let board=[];

  function parseFEN(fen){
    const parts=fen.trim().split(/\s+/);
    const rows=parts[0].split('/');
    const b=[];
    for(const r of rows){
      const row=[];
      for(const ch of r){
        if(/[1-8]/.test(ch)){
          for(let i=0;i<Number(ch);i++) row.push(EMPTY);
        }else{
          row.push(ch);
        }
      }
      b.push(row);
    }
    return {board:b, turn:parts[1]||'w'};
  }

  function colorOf(p){ if(!p||p===EMPTY) return null; return p===p.toUpperCase()?'w':'b'; }
  function toUpper(p){ return p.toUpperCase(); }
  function pieceAt(x,y){ if(y<0||y>=8||x<0||x>=8) return null; return board[y][x]; }

  function genMoves(x,y){
    const p=pieceAt(x,y); if(!p||p===EMPTY) return [];
    const isW=colorOf(p)==='w';
    const res=[]; const P=toUpper(p);
    function push(nx,ny,capOnly=false,quietOnly=false){
      if(nx<0||nx>=8||ny<0||ny>=8) return;
      const t=pieceAt(nx,ny);
      if(t!==EMPTY && colorOf(t)===colorOf(p)) return;
      if(capOnly && t===EMPTY) return;
      if(quietOnly && t!==EMPTY) return;
      res.push({x:nx,y:ny});
    }
    if(P==='P'){
      const dir=isW?-1:1;
      push(x,y+dir,false,true);
      if((isW&&y===6)||(!isW&&y===1)){
        if(pieceAt(x,y+dir)===EMPTY && pieceAt(x,y+2*dir)===EMPTY) push(x,y+2*dir,false,true);
      }
      push(x-1,y+dir,true,false);
      push(x+1,y+dir,true,false);
    }else if(P==='N'){
      [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]].forEach(d=>push(x+d[0],y+d[1]));
    }else if(P==='B'||P==='R'||P==='Q'){
      const dirs=(P==='B')?[[1,1],[-1,1],[1,-1],[-1,-1]]:(P==='R')?[[1,0],[-1,0],[0,1],[0,-1]]:[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
      for(const [dx,dy] of dirs){
        let nx=x+dx, ny=y+dy;
        while(nx>=0&&nx<8&&ny>=0&&ny<8){
          const t=pieceAt(nx,ny);
          if(t===EMPTY){ res.push({x:nx,y:ny}); }
          else { if(colorOf(t)!==colorOf(p)) res.push({x:nx,y:ny}); break; }
          nx+=dx; ny+=dy;
        }
      }
    }else if(P==='K'){
      for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){ if(dx||dy) push(x+dx,y+dy); }
    }
    const legal=[];
    for(const m of res){
      const saved=board[m.y][m.x]; const from=board[y][x];
      board[m.y][m.x]=board[y][x]; board[y][x]=EMPTY;
      if(!inCheck(colorOf(from))) legal.push(m);
      board[y][x]=from; board[m.y][m.x]=saved;
    }
    return legal;
  }

  function genMovesNoFilter(x,y){
    const p=pieceAt(x,y); if(!p||p===EMPTY) return [];
    const isW=colorOf(p)==='w';
    const res=[]; const P=toUpper(p);
    function push(nx,ny,capOnly=false,quietOnly=false){
      if(nx<0||nx>=8||ny<0||ny>=8) return;
      const t=pieceAt(nx,ny);
      if(t!==EMPTY && colorOf(t)===colorOf(p)) return;
      if(capOnly && t===EMPTY) return;
      if(quietOnly && t!==EMPTY) return;
      res.push({x:nx,y:ny});
    }
    if(P==='P'){
      const dir=isW?-1:1;
      push(x+1,y+dir,true,false);
      push(x-1,y+dir,true,false);
    }else if(P==='N'){
      [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]].forEach(d=>push(x+d[0],y+d[1]));
    }else if(P==='B'||P==='R'||P==='Q'){
      const dirs=(P==='B')?[[1,1],[-1,1],[1,-1],[-1,-1]]:(P==='R')?[[1,0],[-1,0],[0,1],[0,-1]]:[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
      for(const [dx,dy] of dirs){
        let nx=x+dx, ny=y+dy;
        while(nx>=0&&nx<8&&ny>=0&&ny<8){
          const t=pieceAt(nx,ny);
          if(t===EMPTY){ res.push({x:nx,y:ny}); }
          else { if(colorOf(t)!==colorOf(p)) res.push({x:nx,y:ny}); break; }
          nx+=dx; ny+=dy;
        }
      }
    }else if(P==='K'){
      for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){ if(dx||dy) push(x+dx,y+dy); }
    }
    return res;
  }

  function kingPos(side){
    for(let y=0;y<8;y++) for(let x=0;x<8;x++){
      const p=pieceAt(x,y);
      if(p!==EMPTY && toUpper(p)==='K' && colorOf(p)===side) return {x,y};
    }
    return null;
  }

  function inCheck(side){
    const k=kingPos(side); if(!k) return false;
    for(let y=0;y<8;y++) for(let x=0;x<8;x++){
      const p=pieceAt(x,y); if(p===EMPTY || colorOf(p)===side) continue;
      const ms=genMovesNoFilter(x,y);
      if(ms.some(m=>m.x===k.x && m.y===k.y)) return true;
    }
    return false;
  }

  function generateAllMoves(side){
    const ms=[];
    for(let y=0;y<8;y++) for(let x=0;x<8;x++){
      const p=pieceAt(x,y); if(p===EMPTY || colorOf(p)!==side) continue;
      const arr=genMoves(x,y);
      for(const m of arr) ms.push({from:{x,y}, to:{x:m.x,y:m.y}});
    }
    return ms;
  }

  function makeMove(m){
    m.captured=board[m.to.y][m.to.x];
    const piece=board[m.from.y][m.from.x];
    board[m.to.y][m.to.x]=piece;
    board[m.from.y][m.from.x]=EMPTY;
    if(toUpper(piece)==='P' && (m.to.y===0||m.to.y===7)){
      board[m.to.y][m.to.x]=colorOf(piece)==='w'?'Q':'q';
      m.promoted=true;
    }
  }
  function undoMove(m){
    const piece=board[m.to.y][m.to.x];
    board[m.from.y][m.from.x]=m.promoted?(colorOf(piece)==='w'?'P':'p'):piece;
    board[m.to.y][m.to.x]=m.captured;
    delete m.promoted;
  }

  function evaluate(){
    let score=0;
    for(let y=0;y<8;y++) for(let x=0;x<8;x++){
      const p=pieceAt(x,y); if(p===EMPTY) continue;
      const u=toUpper(p);
      let val=pieceValues[u]||0;
      const table=pst[u];
      if(table){
        const idx=colorOf(p)==='w'? y*8+x : (7-y)*8+x;
        val += table[idx];
      }
      score += (colorOf(p)==='w'?val:-val);
    }
    return score;
  }

  function negamax(depth, alpha, beta, color){
    if(depth===0) return color*evaluate();
    const side=color===1?'w':'b';
    const moves=generateAllMoves(side);
    if(moves.length===0) return color*evaluate();
    let best=-Infinity;
    for(const m of moves){
      makeMove(m);
      const score=-negamax(depth-1,-beta,-alpha,-color);
      undoMove(m);
      if(score>best) best=score;
      if(score>alpha) alpha=score;
      if(alpha>=beta) break;
    }
    return best;
  }

  function bestMove(fen, depth){
    const parsed=parseFEN(fen);
    board=parsed.board;
    const color=parsed.turn==='w'?1:-1;
    const moves=generateAllMoves(parsed.turn);
    let best=null; let bestScore=-Infinity;
    for(const m of moves){
      makeMove(m);
      const score=-negamax(depth-1,-Infinity,Infinity,-color);
      undoMove(m);
      if(score>bestScore){ bestScore=score; best={from:m.from,to:m.to}; }
    }
    return best;
  }

  global.ai={bestMove};
})(this);
