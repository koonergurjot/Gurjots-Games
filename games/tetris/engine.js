(function(){
  const JLSTZ={
    '0->1':[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    '1->0':[[0,0],[1,0],[1,-1],[0,2],[1,2]],
    '1->2':[[0,0],[1,0],[1,-1],[0,2],[1,2]],
    '2->1':[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    '2->3':[[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    '3->2':[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '3->0':[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '0->3':[[0,0],[1,0],[1,1],[0,-2],[1,-2]]
  };
  const I={
    '0->1':[[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
    '1->0':[[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
    '1->2':[[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
    '2->1':[[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
    '2->3':[[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
    '3->2':[[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
    '3->0':[[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
    '0->3':[[0,0],[-1,0],[2,0],[-1,2],[2,-1]]
  };
  function rotateCW(m){
    return m[0].map((_,i)=>m.map(r=>r[i]).reverse());
  }
  function rotateCCW(m){
    return m[0].map((_,i)=>m.map(r=>r[r.length-1-i]));
  }
  function collide(p,grid){
    const ROWS=grid.length, COLS=grid[0].length;
    for(let y=0;y<p.m.length;y++)
      for(let x=0;x<p.m[y].length;x++){
        if(!p.m[y][x]) continue;
        const nx=p.x+x, ny=p.y+y;
        if(nx<0||nx>=COLS||ny>=ROWS||grid[ny]?.[nx]) return true;
      }
    return false;
  }
  function rotate(piece,grid,dir=1){
    const newO=(piece.o+dir+4)%4;
    const key=`${piece.o}->${newO}`;
    const kicks=(piece.t==='I'?I:JLSTZ)[key]||[[0,0]];
    const R=dir===1?rotateCW(piece.m):rotateCCW(piece.m);
    for(const [kx,ky] of kicks){
      const cand={m:R,x:piece.x+kx,y:piece.y+ky,o:newO,t:piece.t};
      if(!collide(cand,grid)) return cand;
    }
    return piece;
  }
  window.TetrisEngine={rotate};
})();
