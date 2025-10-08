export function copyGrid(grid){
  return grid.map(r=>r.slice());
}

export function compressLine(line){
  const filtered=line.filter(v=>v!==0);
  const zeros=Array(line.length-filtered.length).fill(0);
  return filtered.concat(zeros);
}

export function mergeLine(line){
  const merged=line.slice();
  let gained=0;
  const merges=[];
  for(let i=0;i<merged.length-1;i++){
    const current=merged[i];
    if(current===0) continue;
    if(current===merged[i+1]){
      const value=current*2;
      merged[i]=value;
      merged[i+1]=0;
      gained+=value;
      merges.push({from:[i,i+1],to:i,value});
      i++;
    }
  }
  return {line:merged,gained,merges};
}

function compressWithSources(line, sources){
  const compressed=[];
  const compressedSources=[];
  for(let i=0;i<line.length;i++){
    const v=line[i];
    if(v!==0){
      compressed.push(v);
      compressedSources.push(sources[i]);
    }
  }
  while(compressed.length<line.length){
    compressed.push(0);
    compressedSources.push([]);
  }
  return {line:compressed,sources:compressedSources};
}

function buildCoords(dir, index, size){
  const coords=[];
  if(dir===0){
    for(let x=0;x<size;x++) coords.push({x,y:index});
  }else if(dir===2){
    for(let x=0;x<size;x++) coords.push({x:size-1-x,y:index});
  }else if(dir===1){
    for(let y=0;y<size;y++) coords.push({x:index,y});
  }else if(dir===3){
    for(let y=0;y<size;y++) coords.push({x:index,y:size-1-y});
  }
  return coords;
}

function normalizeLine(grid, coords){
  return coords.map(({x,y})=>grid[y][x]);
}

export function computeMove(grid, dir){
  const N=grid.length;
  const after=Array.from({length:N},()=>Array(N).fill(0));
  const animations=[];
  let moved=false;
  let totalGained=0;

  for(let i=0;i<N;i++){
    const coords=buildCoords(dir,i,N);
    const originalLine=normalizeLine(grid,coords);
    const identitySources=originalLine.map((_,idx)=>[idx]);

    const firstCompress=compressWithSources(originalLine,identitySources);
    const merged=mergeLine(firstCompress.line);
    const mergedSources=firstCompress.sources.map(arr=>arr.slice());
    for(const merge of merged.merges){
      const [a,b]=merge.from;
      mergedSources[merge.to]=mergedSources[merge.to].concat(mergedSources[b]);
      mergedSources[b]=[];
    }
    const finalCompress=compressWithSources(merged.line,mergedSources);
    const finalLine=finalCompress.line;
    const finalSources=finalCompress.sources;

    for(let idx=0;idx<N;idx++){
      const {x,y}=coords[idx];
      after[y][x]=finalLine[idx];
    }

    const sourceToTarget=new Map();
    finalSources.forEach((sourcesArr,targetIdx)=>{
      for(const sourceIdx of sourcesArr){
        sourceToTarget.set(sourceIdx,targetIdx);
      }
    });

    for(let sourceIdx=0;sourceIdx<originalLine.length;sourceIdx++){
      const value=originalLine[sourceIdx];
      if(!value) continue;
      const from=coords[sourceIdx];
      const targetIndex=sourceToTarget.has(sourceIdx)?sourceToTarget.get(sourceIdx):sourceIdx;
      const to=coords[targetIndex];
      animations.push({value,fromX:from.x,fromY:from.y,toX:to.x,toY:to.y});
    }

    for(let idx=0;idx<N;idx++){
      if(finalLine[idx]!==originalLine[idx]){
        moved=true;
        break;
      }
    }

    totalGained+=merged.gained;
  }

  return {after,animations,moved,gained:totalGained};
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

export function hashState(grid, score, meta){
  let hash=2166136261 ^ score;
  for(const row of grid){
    for(const value of row){
      hash=Math.imul(hash ^ value,16777619);
    }
  }
  if(meta){
    const streak=meta.mergeStreak ?? 0;
    const last=meta.lastMoveHadMerge ? 1 : 0;
    hash=Math.imul(hash ^ streak,16777619);
    hash=Math.imul(hash ^ last,16777619);
  }
  return (hash>>>0).toString(36);
}

function cloneState(state){
  return {
    grid:copyGrid(state.grid),
    score:state.score,
    rngState:state.rngState?{...state.rngState}:null,
    meta:state.meta?{...state.meta}:null,
    hash:state.hash
  };
}

export function createHistoryManager({maxSize=50}={}){
  let current=null;
  const past=[];
  const future=[];

  return {
    init(state){
      current={...cloneState({...state,hash:hashState(state.grid,state.score,state.meta)})};
      past.length=0;
      future.length=0;
    },
    pushCurrent(){
      if(!current) return;
      if(past.length && past[past.length-1].hash===current.hash) return;
      past.push(cloneState(current));
      if(past.length>maxSize){
        past.shift();
      }
    },
    clearFuture(){
      future.length=0;
    },
    commit(state){
      current={...cloneState({...state,hash:hashState(state.grid,state.score,state.meta)})};
    },
    undo(){
      if(!past.length || !current) return null;
      future.push(cloneState(current));
      current=past.pop();
      return cloneState(current);
    },
    redo(){
      if(!future.length || !current) return null;
      past.push(cloneState(current));
      if(past.length>maxSize){
        past.shift();
      }
      current=future.pop();
      return cloneState(current);
    },
    canUndo(){
      return past.length>0;
    },
    canRedo(){
      return future.length>0;
    },
    getCurrent(){
      return current?cloneState(current):null;
    }
  };
}

export function confirmNoMoves(grid){
  for(let dir=0;dir<4;dir++){
    const {moved}=computeMove(grid,dir);
    if(moved) return false;
  }
  return true;
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
