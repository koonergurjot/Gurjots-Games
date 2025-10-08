import { describe, it, expect } from 'vitest';
import { compressLine, mergeLine, computeMove } from '../games/2048/engine.js';

class TestRng {
  constructor(seed){
    this.state = seed >>> 0;
  }

  next(){
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  nextInt(maxExclusive){
    return Math.floor(this.next() * maxExclusive);
  }

  pick(array){
    return array[this.nextInt(array.length)];
  }
}

function referenceLine(line){
  const filtered = line.filter(value => value !== 0);
  const result = [];
  let gained = 0;
  for(let i=0;i<filtered.length;i++){
    const current = filtered[i];
    const next = filtered[i+1];
    if(current !== 0 && current === next){
      const merged = current * 2;
      result.push(merged);
      gained += merged;
      i++;
    }else{
      result.push(current);
    }
  }
  while(result.length < line.length){
    result.push(0);
  }
  return { line: result, gained };
}

function buildCoords(dir, index, size){
  const coords = [];
  if(dir === 0){
    for(let x=0;x<size;x++) coords.push({ x, y: index });
  }else if(dir === 2){
    for(let x=0;x<size;x++) coords.push({ x: size - 1 - x, y: index });
  }else if(dir === 1){
    for(let y=0;y<size;y++) coords.push({ x: index, y });
  }else if(dir === 3){
    for(let y=0;y<size;y++) coords.push({ x: index, y: size - 1 - y });
  }
  return coords;
}

function applyReferenceMove(grid, dir){
  const size = grid.length;
  const after = Array.from({ length: size }, () => Array(size).fill(0));
  let moved = false;
  let totalGained = 0;

  for(let i=0;i<size;i++){
    const coords = buildCoords(dir, i, size);
    const line = coords.map(({ x, y }) => grid[y][x]);
    const { line: expectedLine, gained } = referenceLine(line);
    totalGained += gained;
    coords.forEach(({ x, y }, idx) => {
      after[y][x] = expectedLine[idx];
    });
    if(!moved){
      moved = expectedLine.some((value, idx) => value !== line[idx]);
    }
  }

  return { grid: after, moved, gained: totalGained };
}

describe('2048 engine move pipeline', () => {
  it('compressLine keeps order without mutating input', () => {
    const line = [0, 2, 0, 4, 0, 8];
    const copy = [...line];
    const compressed = compressLine(line);
    expect(line).toEqual(copy);
    expect(compressed).toEqual([2, 4, 8, 0, 0, 0]);
  });

  it('mergeLine merges adjacent pairs exactly once across random lines', () => {
    const rng = new TestRng(0xdeadbeef);
    for(let iteration=0; iteration<300; iteration++){
      const size = 4 + rng.nextInt(2); // 4x4 or 5x5 rows
      const line = Array.from({ length: size }, () => rng.pick([0,0,0,2,4,8,16,32]));
      const compressed = compressLine(line);
      const merged = mergeLine(compressed);
      const final = compressLine(merged.line);
      const expected = referenceLine(line);
      expect(final).toEqual(expected.line);
      expect(merged.gained).toBe(expected.gained);
    }
  });

  it('computeMove matches reference solver for random grids', () => {
    const rng = new TestRng(0x12345678);
    for(let iteration=0; iteration<200; iteration++){
      const size = 4 + rng.nextInt(2);
      const grid = Array.from({ length: size }, () =>
        Array.from({ length: size }, () => rng.pick([0,0,2,4,8,16,32,64]))
      );
      for(let dir=0; dir<4; dir++){
        const { after, moved, gained } = computeMove(grid, dir);
        const reference = applyReferenceMove(grid, dir);
        expect(after).toEqual(reference.grid);
        expect(gained).toBe(reference.gained);
        expect(moved).toBe(reference.moved);
      }
    }
  });
});
