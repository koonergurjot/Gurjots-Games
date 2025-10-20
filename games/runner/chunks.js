const clamp = (value, min, max) => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
};

const TIERS = ['easy', 'medium', 'hard'];

function addBlock(game, baseX, offset, width, height) {
  const ground = typeof game.groundY === 'function' ? game.groundY() : 260;
  const top = ground - height;
  const obstacle = game.acquireObstacle({
    x: baseX + offset,
    y: top,
    w: width,
    h: height,
    type: 'block',
  });
  game.obstacles.push(obstacle);
  return obstacle;
}

function addBar(game, baseX, offset, width, height, clearance) {
  const ground = typeof game.groundY === 'function' ? game.groundY() : 260;
  const bottom = ground - clearance;
  const top = clamp(bottom - height, 48, ground - height - 6);
  const obstacle = game.acquireObstacle({
    x: baseX + offset,
    y: top,
    w: width,
    h: height,
    type: 'bar',
  });
  game.obstacles.push(obstacle);
  return obstacle;
}

function resolveRand(game) {
  if (game && typeof game.randRange === 'function') {
    return (min, max) => game.randRange(min, max);
  }
  return (min, max) => min + (max - min) * Math.random();
}

function addCoin(game, baseX, offset, y, options = {}) {
  const ground = typeof game.groundY === 'function' ? game.groundY() : 260;
  const rand = resolveRand(game);
  const coin = game.acquireCoin();
  const clampedY = clamp(y, 40, ground - 24);
  coin.x = baseX + offset;
  coin.baseY = clampedY;
  coin.y = clampedY;
  coin.radius = 12;
  const amplitude = Number.isFinite(options.oscAmp) ? options.oscAmp : 0;
  coin.oscAmp = amplitude;
  coin.oscSpeed = amplitude > 0
    ? (Number.isFinite(options.oscSpeed) ? options.oscSpeed : rand(0.08, 0.14))
    : 0;
  coin.phase = amplitude > 0
    ? (Number.isFinite(options.phase) ? options.phase : rand(0, Math.PI * 2))
    : 0;
  coin.collected = false;
  coin.fade = 1;
  game.coins.push(coin);
  return coin;
}

function addCoinRow(game, baseX, offset, count, spacing, y, options = {}) {
  const stepY = Number.isFinite(options.stepY) ? options.stepY : 0;
  const oscillate = options.oscillate === true;
  const oscAmp = oscillate ? (Number.isFinite(options.amplitude) ? options.amplitude : 10) : 0;
  const oscSpeed = options.oscillate === true && Number.isFinite(options.speed)
    ? options.speed
    : undefined;
  for (let i = 0; i < count; i++) {
    addCoin(game, baseX, offset + spacing * i, y + stepY * i, {
      oscAmp,
      oscSpeed,
    });
  }
}

export const chunkLibrary = [
  {
    id: 'easy-single-block',
    tier: 'easy',
    weight: 3,
    length: 180,
    build(game, baseX) {
      const ground = game.groundY();
      addBlock(game, baseX, 0, 48, 60);
      addCoinRow(game, baseX, 24, 4, 30, ground - 120, { oscillate: true, amplitude: 8 });
    },
  },
  {
    id: 'easy-double-steps',
    tier: 'easy',
    weight: 2.5,
    length: 220,
    build(game, baseX) {
      const ground = game.groundY();
      addBlock(game, baseX, 0, 42, 58);
      addBlock(game, baseX, 120, 38, 74);
      addCoin(game, baseX, 46, ground - 138);
      addCoin(game, baseX, 82, ground - 150);
      addCoin(game, baseX, 150, ground - 126);
      addCoin(game, baseX, 186, ground - 118);
    },
  },
  {
    id: 'easy-low-bar',
    tier: 'easy',
    weight: 2.2,
    length: 200,
    build(game, baseX) {
      const ground = game.groundY();
      addBar(game, baseX, 20, 150, 18, 52);
      addCoinRow(game, baseX, 20, 5, 32, ground - 150);
    },
  },
  {
    id: 'medium-stairs',
    tier: 'medium',
    weight: 2.4,
    length: 240,
    build(game, baseX) {
      const ground = game.groundY();
      addBlock(game, baseX, 0, 36, 64);
      addBlock(game, baseX, 88, 34, 86);
      addBlock(game, baseX, 168, 32, 74);
      addCoinRow(game, baseX, 16, 3, 42, ground - 150, { stepY: -10 });
      addCoinRow(game, baseX, 150, 3, 32, ground - 132, { oscillate: true, amplitude: 6 });
    },
  },
  {
    id: 'medium-bar-block',
    tier: 'medium',
    weight: 2.1,
    length: 260,
    build(game, baseX) {
      const ground = game.groundY();
      addBlock(game, baseX, 0, 44, 70);
      addBar(game, baseX, 110, 120, 18, 68);
      addBlock(game, baseX, 230, 36, 64);
      addCoinRow(game, baseX, 40, 4, 30, ground - 142);
      addCoinRow(game, baseX, 220, 3, 34, ground - 134, { oscillate: true, amplitude: 10 });
    },
  },
  {
    id: 'medium-ledge-run',
    tier: 'medium',
    weight: 1.8,
    length: 260,
    build(game, baseX) {
      const ground = game.groundY();
      addBlock(game, baseX, 0, 40, 92);
      addBlock(game, baseX, 96, 34, 60);
      addBar(game, baseX, 168, 150, 18, 48);
      addCoin(game, baseX, 38, ground - 154);
      addCoin(game, baseX, 76, ground - 166);
      addCoinRow(game, baseX, 168, 4, 36, ground - 146, { oscillate: true, amplitude: 8 });
    },
  },
  {
    id: 'hard-gauntlet',
    tier: 'hard',
    weight: 1.6,
    length: 300,
    build(game, baseX) {
      const ground = game.groundY();
      addBlock(game, baseX, 0, 40, 96);
      addBar(game, baseX, 90, 120, 18, 58);
      addBlock(game, baseX, 200, 46, 118);
      addCoinRow(game, baseX, 24, 3, 34, ground - 160, { oscillate: true, amplitude: 10 });
      addCoinRow(game, baseX, 210, 3, 30, ground - 134, { stepY: -6 });
    },
  },
  {
    id: 'hard-double-bar',
    tier: 'hard',
    weight: 1.4,
    length: 280,
    build(game, baseX) {
      const ground = game.groundY();
      addBar(game, baseX, 40, 120, 16, 64);
      addBar(game, baseX, 190, 160, 18, 46);
      addCoinRow(game, baseX, 20, 3, 34, ground - 150);
      addCoinRow(game, baseX, 180, 4, 30, ground - 138, { oscillate: true, amplitude: 12 });
    },
  },
  {
    id: 'hard-towers',
    tier: 'hard',
    weight: 1.2,
    length: 320,
    build(game, baseX) {
      const ground = game.groundY();
      addBlock(game, baseX, 0, 38, 110);
      addBlock(game, baseX, 90, 36, 130);
      addBlock(game, baseX, 190, 34, 96);
      addCoinRow(game, baseX, 10, 3, 36, ground - 168, { stepY: -12 });
      addCoinRow(game, baseX, 188, 4, 32, ground - 142, { oscillate: true, amplitude: 9 });
    },
  },
];

export function getTierWeights(progress = 0) {
  const p = clamp(progress, 0, 1.35);
  const weights = {
    easy: clamp(1.1 - p * 0.6, 0.15, 1.1),
    medium: p <= 0.18 ? 0 : clamp((p - 0.18) * 1.4, 0, 1.05),
    hard: p <= 0.58 ? 0 : clamp((p - 0.58) * 1.6, 0, 0.95),
  };
  const total = TIERS.reduce((sum, tier) => sum + (weights[tier] || 0), 0) || 1;
  for (const tier of TIERS) {
    weights[tier] = (weights[tier] || 0) / total;
  }
  return weights;
}

export function selectChunk(progress = 0, rng = Math.random) {
  const random = typeof rng === 'function' ? rng : Math.random;
  const tierWeights = getTierWeights(progress);
  const candidates = [];
  let total = 0;
  for (const chunk of chunkLibrary) {
    const tierWeight = tierWeights[chunk.tier] ?? 0;
    const weight = (chunk.weight ?? 1) * tierWeight;
    if (weight <= 0) continue;
    candidates.push({ chunk, weight });
    total += weight;
  }
  if (!candidates.length) {
    return chunkLibrary[0];
  }
  const roll = random() * total;
  let acc = 0;
  for (const entry of candidates) {
    acc += entry.weight;
    if (roll <= acc) {
      return entry.chunk;
    }
  }
  return candidates[candidates.length - 1].chunk;
}
