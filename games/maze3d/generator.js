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

function neighbors(x, y) {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1]
  ];
}

function solveMaze(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const start = [1, 1];
  const goal = [cols - 2, rows - 2];
  const queue = [start];
  const visited = new Set([start.join(',')]);
  const prev = new Map();

  while (queue.length) {
    const [x, y] = queue.shift();
    if (x === goal[0] && y === goal[1]) break;
    for (const [nx, ny] of neighbors(x, y)) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (grid[ny][nx] !== 0) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      prev.set(key, [x, y]);
      queue.push([nx, ny]);
    }
  }

  const path = [];
  let current = goal;
  let guard = cols * rows;
  while (current && guard-- > 0) {
    path.push(current);
    if (current[0] === start[0] && current[1] === start[1]) break;
    const key = current.join(',');
    current = prev.get(key) || null;
  }

  path.reverse();
  if (!path.length || path[0][0] !== start[0] || path[0][1] !== start[1]) {
    return [];
  }
  return path;
}

export function generateMaze(width, height, { algorithm = 'backtracker', seed } = {}) {
  const rand = seed !== undefined ? seedRandom(seed) : Math.random;
  const normalized = algorithm === 'prim' ? 'prim' : 'backtracker';
  const grid = normalized === 'prim'
    ? generatePrim(width, height, rand)
    : generateBacktracker(width, height, rand);
  const solution = solveMaze(grid);
  return {
    grid,
    solution,
    metadata: {
      algorithm: normalized,
      seed: seed ?? null,
      width,
      height,
    }
  };
}

