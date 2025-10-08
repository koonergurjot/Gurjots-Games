import { TILE, tiles, levels as levelManifest } from './tiles.js';

const TILE_CODE_BY_ID = new Map(
  Array.from({ length: 16 }, (_, value) => [value, String(value)]),
);

function toTileCode(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '0';
  }
  const mapped = TILE_CODE_BY_ID.get(value);
  if (mapped != null) {
    return mapped;
  }
  if (value >= 0 && value <= 9) {
    return String(value);
  }
  return '0';
}

function normalizeGrid(rows, width, height) {
  const grid = [];
  for (let y = 0; y < height; y += 1) {
    const row = new Array(width).fill('0');
    const source = rows[y];
    if (Array.isArray(source)) {
      for (let x = 0; x < width; x += 1) {
        row[x] = toTileCode(source[x]);
      }
    }
    grid.push(row);
  }
  return grid;
}

function spriteSizeFor(tileCode) {
  const sprite = tiles[tileCode]?.sprite;
  const frame = sprite?.frame;
  if (!frame) {
    return { w: TILE, h: TILE };
  }
  return { w: frame.sw ?? TILE, h: frame.sh ?? TILE };
}

function tileToWorld(tileX, tileY, tileSize) {
  return { x: tileX * tileSize, y: tileY * tileSize };
}

function extractCoins(grid, tileSize, levelId) {
  const coins = [];
  const { w: spriteW, h: spriteH } = spriteSizeFor('2');
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== '2') continue;
      const world = tileToWorld(x, y, tileSize);
      coins.push({
        id: `${levelId}-coin-${x}-${y}`,
        x: world.x + (tileSize - spriteW) / 2,
        y: world.y + (tileSize - spriteH) / 2,
        w: spriteW,
        h: spriteH,
        sprite: tiles['2']?.sprite ?? null,
        collected: false,
        tileX: x,
        tileY: y,
      });
    }
  }
  return coins;
}

function extractGoal(grid, tileSize) {
  const { w: spriteW, h: spriteH } = spriteSizeFor('3');
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== '3') continue;
      const world = tileToWorld(x, y, tileSize);
      return {
        x: world.x + (tileSize - spriteW) / 2,
        y: world.y + tileSize - spriteH,
        w: spriteW,
        h: spriteH,
        sprite: tiles['3']?.sprite ?? null,
        tileX: x,
        tileY: y,
      };
    }
  }
  return null;
}

function extractEntities(objects = []) {
  const spawn = { x: TILE * 2, y: TILE * 6 };
  const enemies = [];
  for (const object of objects) {
    if (!object || typeof object !== 'object') continue;
    const type = (object.type || object.class || object.name || '').toLowerCase();
    if (!Number.isFinite(object.x) || !Number.isFinite(object.y)) continue;
    if (type.includes('player')) {
      spawn.x = object.x;
      spawn.y = object.y;
      continue;
    }
    if (type.includes('enemy')) {
      enemies.push({
        type: object.type || object.name || 'enemy',
        x: object.x,
        y: object.y,
        width: object.width || TILE * 0.8,
        height: object.height || TILE * 0.8,
        properties: object.properties || [],
      });
    }
  }
  return { spawn, enemies };
}

function parseTiledMap(json, source) {
  if (!json || typeof json !== 'object') {
    throw new Error('Level JSON is not an object');
  }
  const { width, height, tilewidth, tileheight } = json;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('Tiled map missing width/height');
  }
  if (tilewidth !== TILE || tileheight !== TILE) {
    throw new Error(`Tiled map tile size mismatch in ${source}`);
  }
  const layer = Array.isArray(json.layers)
    ? json.layers.find((entry) => entry && entry.type === 'tilelayer')
    : null;
  if (!layer) {
    throw new Error(`Tiled map missing tile layer in ${source}`);
  }
  const data = Array.isArray(layer.data)
    ? layer.data
    : typeof layer.data === 'string'
      ? layer.data
          .split(/[,\s]+/)
          .map((token) => Number.parseInt(token, 10))
          .filter((value) => Number.isFinite(value))
      : [];
  if (data.length !== width * height) {
    throw new Error(`Tiled map data size mismatch in ${source}`);
  }
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const start = y * width;
    rows.push(data.slice(start, start + width));
  }
  const grid = normalizeGrid(rows, width, height);
  const objectLayer = Array.isArray(json.layers)
    ? json.layers.find((entry) => entry && entry.type === 'objectgroup')
    : null;
  const entities = extractEntities(objectLayer?.objects);
  return {
    id: json.name || source,
    width,
    height,
    tileSize: tilewidth,
    grid,
    coins: extractCoins(grid, tilewidth, source),
    goal: extractGoal(grid, tilewidth),
    spawn: entities.spawn,
    enemies: entities.enemies,
  };
}

function parseEntityInstance(instance) {
  if (!instance || typeof instance !== 'object') return null;
  const identifier = (instance.__identifier || instance.identifier || '').toLowerCase();
  if (!Array.isArray(instance.px)) return null;
  const [x, y] = instance.px;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (identifier.includes('player')) {
    return { type: 'player', x, y };
  }
  if (identifier.includes('enemy')) {
    return {
      type: instance.__identifier || 'Enemy',
      behavior: (instance.fieldInstances || [])
        .find((field) => (field.__identifier || '').toLowerCase() === 'behavior')?.__value || null,
      x,
      y,
      width: instance.width || TILE * 0.8,
      height: instance.height || TILE * 0.8,
    };
  }
  return null;
}

function parseLDtkProject(json, source) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.levels)) {
    throw new Error('LDtk project missing levels array');
  }
  const level = json.levels[0];
  if (!level) {
    throw new Error('LDtk project does not contain a level');
  }
  const terrain = Array.isArray(level.layerInstances)
    ? level.layerInstances.find((layer) => layer && layer.__type === 'IntGrid')
    : null;
  if (!terrain || !Array.isArray(terrain.intGridCsv)) {
    throw new Error('LDtk project missing IntGrid layer');
  }
  const { cWid, cHei, gridSize } = terrain;
  if (!Number.isFinite(cWid) || !Number.isFinite(cHei)) {
    throw new Error('LDtk IntGrid layer missing dimensions');
  }
  if (gridSize !== TILE) {
    throw new Error(`LDtk grid size mismatch in ${source}`);
  }
  const rows = [];
  for (let y = 0; y < cHei; y += 1) {
    const start = y * cWid;
    rows.push(terrain.intGridCsv.slice(start, start + cWid));
  }
  const grid = normalizeGrid(rows, cWid, cHei);
  const entitiesLayer = Array.isArray(level.layerInstances)
    ? level.layerInstances.find((layer) => layer && layer.__type === 'Entities')
    : null;
  const spawn = { x: TILE * 2, y: TILE * 6 };
  const enemies = [];
  if (entitiesLayer && Array.isArray(entitiesLayer.entityInstances)) {
    for (const instance of entitiesLayer.entityInstances) {
      const parsed = parseEntityInstance(instance);
      if (!parsed) continue;
      if (parsed.type === 'player') {
        spawn.x = parsed.x;
        spawn.y = parsed.y;
      } else {
        enemies.push({
          type: parsed.type,
          behavior: parsed.behavior,
          x: parsed.x,
          y: parsed.y,
          width: parsed.width ?? TILE * 0.8,
          height: parsed.height ?? TILE * 0.8,
        });
      }
    }
  }
  return {
    id: level.identifier || source,
    width: cWid,
    height: cHei,
    tileSize: gridSize,
    grid,
    coins: extractCoins(grid, gridSize, source),
    goal: extractGoal(grid, gridSize),
    spawn,
    enemies,
  };
}

function detectFormat(json) {
  if (json && typeof json === 'object') {
    if (json.type === 'map' && Array.isArray(json.layers)) {
      return 'tiled';
    }
    if (Array.isArray(json.levels) && json.__header__?.app?.toLowerCase?.().includes('ldtk')) {
      return 'ldtk';
    }
  }
  return null;
}

export async function loadLevelByIndex(index = 0) {
  const levelIndex = ((index % levelManifest.length) + levelManifest.length) % levelManifest.length;
  const relativePath = levelManifest[levelIndex];
  const response = await fetch(relativePath);
  if (!response.ok) {
    throw new Error(`Failed to load level at ${relativePath}`);
  }
  const json = await response.json();
  const format = detectFormat(json);
  if (format === 'tiled') {
    return parseTiledMap(json, relativePath);
  }
  if (format === 'ldtk') {
    return parseLDtkProject(json, relativePath);
  }
  // Legacy fallback: interpret { tiles: [ ... ] }
  if (Array.isArray(json.tiles)) {
    const rows = json.tiles.map((line) => line.split('').map((char) => Number.parseInt(char, 10) || 0));
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    const grid = normalizeGrid(rows, width, height);
    return {
      id: relativePath,
      width,
      height,
      tileSize: TILE,
      grid,
      coins: extractCoins(grid, TILE, relativePath),
      goal: extractGoal(grid, TILE),
      spawn: { x: TILE * 2, y: TILE * 6 },
      enemies: [],
    };
  }
  throw new Error(`Unsupported level format for ${relativePath}`);
}

export function listLevels() {
  return levelManifest.slice();
}

