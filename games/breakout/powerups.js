const MANIFEST_URL = new URL('./powerups.json', import.meta.url);

function normaliseDefinition(raw) {
  const id = String(raw?.id || '').trim();
  if (!id) return null;
  const base = {
    id,
    type: String(raw?.type || '').trim() || 'generic',
    duration: Number(raw?.duration ?? 0),
    widthMultiplier: Number(raw?.widthMultiplier ?? 1),
    maxWidth: Number(raw?.maxWidth ?? 0) || null,
    speedScale: Number(raw?.speedScale ?? 1),
    count: Number(raw?.count ?? 0),
    pulseInterval: Number(raw?.pulseInterval ?? 0.3),
    weight: Number(raw?.weight ?? 0),
    sprite: typeof raw?.sprite === 'string' ? raw.sprite : null,
  };
  return Object.freeze(base);
}

async function loadManifest() {
  const response = await fetch(MANIFEST_URL, { cache: 'force-cache' }).catch(() => null);
  if (!response || !response.ok) {
    throw new Error('Breakout: unable to load power-up manifest.');
  }
  const json = await response.json();
  const effects = Array.isArray(json?.effects) ? json.effects : [];
  const definitions = [];
  for (const entry of effects) {
    const def = normaliseDefinition(entry);
    if (def) definitions.push(def);
  }
  return definitions;
}

export const POWERUP_DEFINITIONS = await loadManifest();

const POWERUPS_BY_ID = new Map(POWERUP_DEFINITIONS.map((def) => [def.id, def]));

export function getPowerUpDefinition(id) {
  return POWERUPS_BY_ID.get(id) || null;
}

export function getPowerUpSprite(id) {
  const def = getPowerUpDefinition(id);
  return def?.sprite || null;
}

export function selectPowerUp({ multipliers = null, rng = Math.random } = {}) {
  const entries = [];
  for (const def of POWERUP_DEFINITIONS) {
    const baseWeight = Number(def.weight || 0);
    if (!(baseWeight > 0)) continue;
    const modifier = multipliers && Object.prototype.hasOwnProperty.call(multipliers, def.id)
      ? Number(multipliers[def.id]) || 0
      : 1;
    const weight = baseWeight * modifier;
    if (weight > 0) {
      entries.push({ def, weight });
    }
  }
  if (!entries.length) return null;
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(total > 0)) return null;
  const roll = (typeof rng === 'function' ? rng() : Math.random()) * total;
  let acc = 0;
  for (const entry of entries) {
    acc += entry.weight;
    if (roll <= acc) {
      return entry.def;
    }
  }
  return entries[entries.length - 1].def;
}

export class PowerUpEngine {
  constructor() {
    this.active = [];
  }

  activate(type, duration, apply, remove) {
    const existing = this.active.find((entry) => entry.type === type);
    if (existing) {
      existing.remaining = duration;
      return;
    }
    if (typeof apply === 'function') {
      apply();
    }
    this.active.push({ type, remaining: duration, remove });
  }

  update(dt) {
    if (!this.active.length) return;
    for (const p of this.active) {
      p.remaining -= dt;
    }
    const next = [];
    for (const entry of this.active) {
      if (entry.remaining > 0) {
        next.push(entry);
      } else if (typeof entry.remove === 'function') {
        try {
          entry.remove();
        } catch (err) {
          console.error('[breakout] Failed to remove power-up', entry.type, err);
        }
      }
    }
    this.active = next;
  }

  reset() {
    for (const entry of this.active) {
      if (typeof entry.remove === 'function') {
        try {
          entry.remove();
        } catch (err) {
          console.error('[breakout] Failed to reset power-up', entry.type, err);
        }
      }
    }
    this.active = [];
  }
}

export default PowerUpEngine;
