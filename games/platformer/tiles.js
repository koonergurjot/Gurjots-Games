import { getSpriteFrame } from '../../shared/render/tileTextures.js';

export const TILE = 50;

// Collision masks describe the ground height for each x coordinate within a tile.
// The array value is the y position (0 at top) of the solid surface.
export const tileMasks = {
  '1': Array(TILE).fill(TILE), // full solid block
  // Slope rising to the right: ground goes from bottom-left to top-right
  '4': Array.from({ length: TILE }, (_, x) => TILE - x),
  // Slope rising to the left: ground goes from top-left to bottom-right
  '5': Array.from({ length: TILE }, (_, x) => x + 1),
  '6': Array(TILE).fill(TILE), // lava top, treated as solid surface for collisions
};

export const tiles = {
  '0': { name: 'empty' },
  '1': { name: 'block', solid: true, mask: tileMasks['1'], texture: 'block' },
  '2': {
    name: 'coin',
    sprite: { key: 'coin', frame: getSpriteFrame('coin') },
  },
  '3': {
    name: 'goal',
    sprite: { key: 'goal', frame: getSpriteFrame('goal') },
  },
  '4': { name: 'slopeR', solid: true, slope: true, mask: tileMasks['4'], texture: 'block' },
  '5': { name: 'slopeL', solid: true, slope: true, mask: tileMasks['5'], texture: 'block' },
  '6': { name: 'lava', solid: true, mask: tileMasks['6'], texture: 'lava' },
};

// Level JSON files to be loaded at runtime.
export const levels = [
  'levels/level1.json',
  'levels/level2.json',
];

export function isSolid(t){
  return !!tiles[t]?.solid;
}
export function isSlope(t){
  return t === '4' || t === '5';
}
export function maskFor(t){
  return tileMasks[t];
}
