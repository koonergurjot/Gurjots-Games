const LEVEL_FILES = [
  new URL('./levels/launch-deck.json', import.meta.url),
  new URL('./levels/reactor-ring.json', import.meta.url),
  new URL('./levels/foundry-belt.json', import.meta.url),
];

function toObjectEntries(value) {
  return value && typeof value === 'object' ? Object.entries(value) : [];
}

function normaliseMaterialEntry([key, config]) {
  const safeKey = String(key || '').trim();
  if (!safeKey) return null;
  const hp = Number(config?.hp ?? 1);
  const variant = Number(config?.variant ?? 0);
  const score = Number(config?.score ?? 10);
  const powerMultiplier = Number(config?.powerMultiplier ?? 1);
  const dropWeights = config?.weights && typeof config.weights === 'object'
    ? Object.fromEntries(Object.entries(config.weights).map(([id, weight]) => [id, Number(weight) || 0]))
    : null;
  return {
    key: safeKey,
    hp: Number.isFinite(hp) && hp > 0 ? Math.round(hp) : 1,
    variant: Number.isFinite(variant) ? variant : 0,
    score: Number.isFinite(score) ? score : 10,
    powerMultiplier: Number.isFinite(powerMultiplier) && powerMultiplier > 0 ? powerMultiplier : 1,
    weights: dropWeights,
  };
}

function normaliseRows(rows, source) {
  if (!Array.isArray(rows)) {
    console.warn(`[breakout] Level rows missing or invalid in ${source}.`);
    return [];
  }
  const normalised = [];
  let maxCols = 0;
  for (const row of rows) {
    const value = typeof row === 'string' ? row : Array.isArray(row) ? row.join('') : '';
    const trimmed = value.replace(/\s+$/g, '');
    normalised.push(trimmed);
    maxCols = Math.max(maxCols, trimmed.length);
  }
  return { rows: normalised, cols: maxCols };
}

function normaliseLevel(raw, url) {
  const source = url instanceof URL ? url.pathname : String(url);
  const name = String(raw?.name || 'Level');
  const speedRamp = Number(raw?.speedRamp ?? 0.15);
  const dropChance = Number(raw?.dropTable?.chance ?? 0.2);
  const dropWeights = raw?.dropTable?.weights && typeof raw.dropTable.weights === 'object'
    ? Object.fromEntries(Object.entries(raw.dropTable.weights).map(([id, weight]) => [id, Number(weight) || 0]))
    : null;
  const materials = new Map();
  for (const entry of toObjectEntries(raw?.materials)) {
    const material = normaliseMaterialEntry(entry);
    if (material) materials.set(material.key, material);
  }
  const { rows, cols } = normaliseRows(raw?.rows, source);
  return Object.freeze({
    id: source,
    name,
    speedRamp: Number.isFinite(speedRamp) ? speedRamp : 0.15,
    dropTable: {
      chance: Number.isFinite(dropChance) && dropChance >= 0 ? dropChance : 0.2,
      weights: dropWeights,
    },
    materials,
    rows,
    cols,
  });
}

async function loadLevel(url) {
  const response = await fetch(url, { cache: 'force-cache' }).catch(() => null);
  if (!response || !response.ok) {
    throw new Error(`Breakout: unable to load level manifest ${url}`);
  }
  const json = await response.json();
  return normaliseLevel(json, url);
}

async function loadAllLevels() {
  const results = [];
  for (const file of LEVEL_FILES) {
    try {
      const level = await loadLevel(file);
      if (level.rows.length && level.cols > 0) {
        results.push(level);
      }
    } catch (error) {
      console.error(error);
    }
  }
  return results;
}

export const LEVELS = await loadAllLevels();

export function getLevel(index = 0) {
  if (!LEVELS.length) return null;
  const safeIndex = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
  return LEVELS[safeIndex];
}

export default LEVELS;
