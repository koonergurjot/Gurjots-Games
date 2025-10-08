import { describe, it, expect } from 'vitest';
import { BAG_ORDER, generateSequence } from '../games/tetris/randomizer.js';

function droughtStats(sequence){
  const lastIndex=new Map();
  let maxGap=0;
  for(let i=0;i<sequence.length;i++){
    const piece=sequence[i];
    if(lastIndex.has(piece)){
      const gap=i-lastIndex.get(piece)-1;
      if(gap>maxGap) maxGap=gap;
    }else{
      if(i>maxGap) maxGap=i;
    }
    lastIndex.set(piece,i);
  }
  return { maxGap };
}

describe('tetris randomizer',()=>{
  it('produces canonical 7-bag groupings',()=>{
    const sortedReference=[...BAG_ORDER].sort();
    for(let seed=0; seed<25; seed++){
      const sequence=generateSequence(seed,70);
      for(let i=0;i<sequence.length;i+=BAG_ORDER.length){
        const bag=sequence.slice(i,i+BAG_ORDER.length).sort();
        expect(bag).toEqual(sortedReference);
      }
    }
  });

  it('limits piece drought to at most twelve pieces',()=>{
    for(let seed=0; seed<100; seed++){
      const sequence=generateSequence(seed,140);
      const { maxGap }=droughtStats(sequence);
      expect(maxGap).toBeLessThanOrEqual(12);
    }
  });

  it('is deterministic for a given seed',()=>{
    const seed=123456789;
    const first=generateSequence(seed,28);
    const second=generateSequence(seed,28);
    expect(second).toEqual(first);
  });
});
