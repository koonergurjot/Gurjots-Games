import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(async () => {
  global.window = globalThis;
  await import('../games/tetris/engine.js');
});

describe('TetrisEngine rotate', () => {
  it('applies SRS kicks to dodge nearby blocks for T piece', () => {
    const grid={
      width:10,
      height:20,
      get(x,y){
        if(x===4 && y===1) return 1;
        return 0;
      },
    };
    const piece={ m:[[0,3,0],[3,3,3]], x:3, y:0, o:0, t:'T' };
    const rotated=window.TetrisEngine.rotate(piece,grid,1);
    expect(rotated).not.toBe(piece);
    expect(rotated.x).toBe(2);
    expect(rotated.o).toBe(1);
  });

  it('applies SRS kicks for I piece near occupied cells', () => {
    const grid={
      width:10,
      height:20,
      get(x,y){
        if(x===6 && y===6) return 1;
        return 0;
      },
    };
    const piece={ m:[[1,1,1,1]], x:6, y:6, o:0, t:'I' };
    const rotated=window.TetrisEngine.rotate(piece,grid,1);
    expect(rotated).not.toBe(piece);
    expect(rotated.x).toBe(4);
    expect(rotated.o).toBe(1);
  });

  it('rejects rotations that collide with occupied cells', () => {
    const blockers=new Set(['3,1','4,2','4,3','5,2','3,2','3,3','4,0','3,0']);
    const occupied={
      width:10,
      height:20,
      get(x,y){
        return blockers.has(`${x},${y}`)?1:0;
      },
    };
    const piece={ m:[[0,3,0],[3,3,3]], x:4, y:1, o:0, t:'T' };
    const rotated=window.TetrisEngine.rotate(piece,occupied,1);
    expect(rotated).toBe(piece);
  });
});
