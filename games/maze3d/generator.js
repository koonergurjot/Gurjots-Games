// Maze generation utilities for 3D maze game.
// Supports recursive backtracker and Prim's algorithm.

export function seedRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function generateBacktracker(width, height, rand) {
  const cols = width * 2 + 1;
  const rows = height * 2 + 1;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(1));

  function carve(x, y) {
    grid[y][x] = 0;
    const dirs = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2]
    ];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && grid[ny][nx] === 1) {
        grid[y + dy / 2][x + dx / 2] = 0;
        carve(nx, ny);
      }
    }
  }

  carve(1, 1);
  grid[rows - 2][cols - 2] = 0;
  return grid;
}

function generatePrim(width, height, rand) {
  const cols = width * 2 + 1;
  const rows = height * 2 + 1;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(1));
  const walls = [];

  function addWalls(x, y) {
    if (x >= 2) walls.push([x - 1, y, x - 2, y]);
    if (x < cols - 2) walls.push([x + 1, y, x + 2, y]);
    if (y >= 2) walls.push([x, y - 1, x, y - 2]);
    if (y < rows - 2) walls.push([x, y + 1, x, y + 2]);
  }

  const startX = 1 + 2 * Math.floor(rand() * width);
  const startY = 1 + 2 * Math.floor(rand() * height);
  grid[startY][startX] = 0;
  addWalls(startX, startY);

  while (walls.length) {
    const idx = Math.floor(rand() * walls.length);
    const [wx, wy, ox, oy] = walls.splice(idx, 1)[0];
    if (grid[oy][ox] === 1) {
      grid[wy][wx] = 0;
      grid[oy][ox] = 0;
      addWalls(ox, oy);
    }
  }

  grid[rows - 2][cols - 2] = 0;
  return grid;
}

export function generateMaze(width, height, { algorithm = 'backtracker', seed } = {}) {
  const rand = seed !== undefined ? seedRandom(seed) : Math.random;
  if (algorithm === 'prim') return generatePrim(width, height, rand);
  return generateBacktracker(width, height, rand);
}

