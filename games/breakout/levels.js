const RAW_LEVELS = [
  {
    id: 'launch-deck',
    name: 'Launch Deck',
    speedRamp: 0.12,
    dropChance: 0.22,
    dropWeights: { EXPAND: 1.1, STICKY: 1.1, MULTI: 1.05 },
    materials: {
      A: { variant: 0, score: 18, color: '#a78bfa' },
      B: { variant: 1, score: 22, color: '#f472b6' },
      S: { variant: 2, score: 30, hp: 2, color: '#38bdf8', powerMultiplier: 0.9, weights: { STICKY: 1.2 } },
    },
    rows: [
      '....AAAAAA....',
      '...ABBBAABB...',
      '..ABBBBSSBBA..',
      '..ABBSSSSBBA..',
      '..AAB.....BAA..',
    ],
  },
  {
    id: 'gold-barricade',
    name: 'Gold Barricade',
    speedRamp: 0.14,
    dropChance: 0.24,
    dropWeights: { LASER: 1.3, MULTI: 1.2, STICKY: 1.1 },
    materials: {
      A: { variant: 0, score: 22, color: '#818cf8' },
      B: { variant: 1, score: 26, color: '#f97316' },
      G: { variant: 3, score: 80, type: 'gold', color: '#facc15', powerMultiplier: 0.35, weights: { LASER: 2.2, MULTI: 1.4, STICKY: 1.2 } },
      S: { variant: 2, score: 34, hp: 2, color: '#38bdf8', weights: { LASER: 1.1 } },
    },
    rows: [
      '....BBBBBB....',
      '...BSSSSSB....',
      '..BGGGGGGGB...',
      '..BGAAAAAGB...',
      '...B....B.....',
    ],
  },
  {
    id: 'magnetron-run',
    name: 'Magnetron Run',
    speedRamp: 0.16,
    dropChance: 0.26,
    dropWeights: { MULTI: 1.3, STICKY: 1.2, SHRINK: 1.1 },
    materials: {
      C: { variant: 0, score: 28, color: '#f472b6' },
      D: { variant: 1, score: 30, color: '#38bdf8' },
      G: { variant: 3, score: 90, type: 'gold', color: '#facc15', powerMultiplier: 0.4, weights: { LASER: 2.0, MULTI: 1.5 } },
      S: { variant: 2, score: 36, hp: 2, color: '#22d3ee', weights: { STICKY: 1.1 } },
    },
    rows: [
      '..C..DDD..C...',
      '..CC.DDD.CC...',
      '..CDDGGDDC....',
      '...CDSSSDC....',
      '....CSDC......',
      '......C.......',
    ],
  },
  {
    id: 'shield-array',
    name: 'Shield Array',
    speedRamp: 0.18,
    dropChance: 0.28,
    dropWeights: { LASER: 1.4, SHRINK: 1.1, STICKY: 1.1 },
    materials: {
      A: { variant: 0, score: 26, color: '#a78bfa' },
      B: { variant: 1, score: 30, color: '#ec4899' },
      G: { variant: 3, score: 100, type: 'gold', color: '#facc15', powerMultiplier: 0.3, weights: { LASER: 2.3, MULTI: 1.4 } },
      S: { variant: 2, score: 40, hp: 3, color: '#38bdf8', powerMultiplier: 0.8, weights: { LASER: 1.2, STICKY: 1.1 } },
    },
    rows: [
      '..SSSSSSSSSS..',
      '..SAAAAAAAAS..',
      '..SGGGGGGGS...',
      '..SBBBBBBBS...',
      '...S....S.....',
      '....S..S......',
    ],
  },
  {
    id: 'singularity-core',
    name: 'Singularity Core',
    speedRamp: 0.2,
    dropChance: 0.3,
    dropWeights: { LASER: 1.5, MULTI: 1.4, SHRINK: 1.2 },
    materials: {
      C: { variant: 0, score: 34, color: '#f97316' },
      D: { variant: 1, score: 38, color: '#38bdf8' },
      G: { variant: 3, score: 120, type: 'gold', color: '#fde047', powerMultiplier: 0.25, weights: { LASER: 2.5, MULTI: 1.6 } },
      S: { variant: 2, score: 45, hp: 3, color: '#14f195', weights: { STICKY: 1.2 } },
    },
    rows: [
      '...GGSSSSGG...',
      '..CGGSSSSGGC..',
      '..CDDGSSGDDC..',
      '..CDDDGGDDDC..',
      '...CDDGGDDC...',
      '....CCDDCC....',
    ],
  },
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
  const typeValue = String(config?.type || '').trim().toLowerCase();
  const colorValue = typeof config?.color === 'string' ? config.color.trim() : null;
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
    type: typeValue === 'gold' ? 'gold' : 'normal',
    color: colorValue || null,
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

function normaliseLevel(raw, index) {
  if (!raw) return null;
  const name = String(raw.name || `Level ${index + 1}`);
  const speedRamp = Number(raw.speedRamp ?? 0.15);
  const dropChance = Number(raw.dropChance ?? raw.dropTable?.chance ?? 0.2);
  const dropWeightsRaw = raw.dropWeights || raw.dropTable?.weights;
  const dropWeights = dropWeightsRaw && typeof dropWeightsRaw === 'object'
    ? Object.fromEntries(Object.entries(dropWeightsRaw).map(([id, weight]) => [id, Number(weight) || 0]))
    : null;
  const materials = new Map();
  for (const entry of toObjectEntries(raw.materials)) {
    const material = normaliseMaterialEntry(entry);
    if (material) materials.set(material.key, material);
  }
  const { rows, cols } = normaliseRows(raw.rows, raw.id || name);
  return Object.freeze({
    id: String(raw.id || `level-${index + 1}`),
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

export const LEVELS = RAW_LEVELS.map(normaliseLevel).filter((level) => level && level.rows.length && level.cols > 0);

export function getLevel(index = 0) {
  if (!LEVELS.length) return null;
  const safeIndex = ((index % LEVELS.length) + LEVELS.length) % LEVELS.length;
  return LEVELS[safeIndex];
}

export default LEVELS;
