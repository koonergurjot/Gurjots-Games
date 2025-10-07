export function copyGrid(grid){
  return grid.map(r=>r.slice());
}

export function computeMove(grid, dir){
  const N=grid.length;
  const after=Array.from({length:N},()=>Array(N).fill(0));
  const animations=[]; let moved=false; let gained=0;
  if(dir===0){
    for(let y=0;y<N;y++){
      let target=0, lastMerge=-1;
      for(let x=0;x<N;x++){
        const v=grid[y][x]; if(!v) continue;
        if(after[y][target]===0){
          after[y][target]=v; if(target!==x) moved=true;
          animations.push({value:v,fromX:x,fromY:y,toX:target,toY:y});
        }else if(after[y][target]===v && lastMerge!==target){
          after[y][target]+=v; gained+=after[y][target]; lastMerge=target; moved=true;
          animations.push({value:v,fromX:x,fromY:y,toX:target,toY:y});
        }else{
          target++; after[y][target]=v; if(target!==x) moved=true;
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
          after[y][toX]=v; if(fromX!==toX) moved=true;
          animations.push({value:v,fromX,fromY:y,toX,toY:y});
        }else if(after[y][toX]===v && lastMerge!==target){
          after[y][toX]+=v; gained+=after[y][toX]; lastMerge=target; moved=true;
          animations.push({value:v,fromX,fromY:y,toX,toY:y});
        }else{
          target++; const nx=N-1-target; after[y][nx]=v; if(fromX!==nx) moved=true;
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
          after[target][x]=v; if(target!==y) moved=true;
          animations.push({value:v,fromX:x,fromY:y,toX:x,toY:target});
        }else if(after[target][x]===v && lastMerge!==target){
          after[target][x]+=v; gained+=after[target][x]; lastMerge=target; moved=true;
          animations.push({value:v,fromX:x,fromY:y,toX:x,toY:target});
        }else{
          target++; after[target][x]=v; if(target!==y) moved=true;
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
          after[toY][x]=v; if(fromY!==toY) moved=true;
          animations.push({value:v,fromX:x,fromY,toX:x,toY});
        }else if(after[toY][x]===v && lastMerge!==target){
          after[toY][x]+=v; gained+=after[toY][x]; lastMerge=target; moved=true;
          animations.push({value:v,fromX:x,fromY,toX:x,toY});
        }else{
          target++; const ny=N-1-target; after[ny][x]=v; if(fromY!==ny) moved=true;
          animations.push({value:v,fromX:x,fromY,toX:x,toY:ny});
        }
      }
    }
  }
  return {after, animations, moved, gained};
}

export function pushState(history, grid, score){
  const h=[...history,{grid:copyGrid(grid),score}];
  if(h.length>10) h.shift();
  return h;
}

export function undo(history){
  if(history.length<=1) return null;
  const h=history.slice(0,-1);
  const {grid,score}=h[h.length-1];
  return {grid:copyGrid(grid),score,history:h};
}

export function canMove(grid){
  const N=grid.length;
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    if(grid[y][x]===0) return true;
    if(x+1<N && grid[y][x]===grid[y][x+1]) return true;
    if(y+1<N && grid[y][x]===grid[y+1][x]) return true;
  }
  return false;
}

export function simulate(grid, score, dir){
  const {after,moved,gained}=computeMove(grid,dir);
  if(!moved) return null;
  return {grid:after,score:score+gained,max:Math.max(...after.flat())};
}

function heuristic(grid){
  let max=0, empty=0;
  for(const row of grid) for(const v of row){
    if(v===0) empty++; else if(v>max) max=v;
  }
  return max + empty;
}

function expectimax(grid, depth, isPlayer){
  if(depth===0 || !canMove(grid)) return heuristic(grid);
  if(isPlayer){
    let best=-Infinity;
    for(let d=0;d<4;d++){
      const {after,moved,gained}=computeMove(grid,d);
      if(!moved) continue;
      const val=gained+expectimax(after, depth-1, false);
      if(val>best) best=val;
    }
    return best===-Infinity?heuristic(grid):best;
  }else{
    const cells=[]; const N=grid.length;
    for(let y=0;y<N;y++) for(let x=0;x<N;x++) if(grid[y][x]===0) cells.push([x,y]);
    if(!cells.length) return heuristic(grid);
    let total=0;
    for(const [x,y] of cells){
      const g2=copyGrid(grid); g2[y][x]=2;
      total+=0.9*expectimax(g2, depth-1, true);
      const g4=copyGrid(grid); g4[y][x]=4;
      total+=0.1*expectimax(g4, depth-1, true);
    }
    return total/cells.length;
  }
}

export function getHint(grid, depth){
  let bestDir=null, bestVal=-Infinity;
  for(let d=0;d<4;d++){
    const {after,moved,gained}=computeMove(grid,d);
    if(!moved) continue;
    const val=gained+expectimax(after, depth-1, false);
    if(val>bestVal){ bestVal=val; bestDir=d; }
  }
  return bestDir;
}
