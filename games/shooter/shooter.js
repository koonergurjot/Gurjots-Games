export const DEFAULT_BOSS_RUSH_STAGES = [
  { type: 'overseer', name: 'Gatekeeper', hpMultiplier: 0.9, speedMultiplier: 1, weaponCooldownScale: 1.05 },
  { type: 'overseer', name: 'Warden', hpMultiplier: 1.05, speedMultiplier: 1.05, weaponCooldownScale: 1 },
  { type: 'overseer', name: 'Sentinel', hpMultiplier: 1.2, speedMultiplier: 1.1, weaponCooldownScale: 0.95 },
  { type: 'overseer', name: 'Archon', hpMultiplier: 1.35, speedMultiplier: 1.15, weaponCooldownScale: 0.9 },
  { type: 'overseer', name: 'Overseer Prime', hpMultiplier: 1.55, speedMultiplier: 1.2, weaponCooldownScale: 0.85 },
];

function clampNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

export class BossRushMode {
  constructor(bosses = DEFAULT_BOSS_RUSH_STAGES, options = {}) {
    this.bosses = Array.isArray(bosses) ? bosses.map((boss) => ({ ...boss })) : [];
    const intermission = clampNumber(options.intermissionDuration, 3);
    this.intermissionDuration = Math.max(0, intermission);
    const initialDelay = clampNumber(options.initialDelay, 0);
    this.initialDelay = Math.max(0, initialDelay);
    this.reset();
  }

  reset() {
    this.currentIndex = -1;
    this.timer = 0;
    this.state = this.initialDelay > 0 ? 'intermission' : 'ready';
    this.intermissionRemaining = this.initialDelay > 0 ? this.initialDelay : 0;
    this.currentWave = null;
    this.completed = false;
    this.perfectWaves = 0;
  }

  start() {
    this.reset();
  }

  tick(deltaSeconds = 0) {
    const delta = clampNumber(deltaSeconds, 0);
    if (delta <= 0) return;
    if (this.completed) {
      return;
    }
    this.timer += delta;
    if (this.state === 'intermission' && this.intermissionRemaining > 0) {
      this.intermissionRemaining = Math.max(0, this.intermissionRemaining - delta);
      if (this.intermissionRemaining === 0 && !this.completed) {
        this.state = 'ready';
      }
    }
  }

  shouldSpawnBoss() {
    if (this.completed) return false;
    if (this.state !== 'ready') return false;
    if (this.currentIndex >= this.bosses.length - 1) {
      return this.currentIndex < this.bosses.length - 1;
    }
    return true;
  }

  startNextStage() {
    if (!this.shouldSpawnBoss()) return null;
    this.currentIndex += 1;
    const stage = this.bosses[this.currentIndex];
    if (!stage) {
      this.completed = true;
      this.state = 'complete';
      return null;
    }
    this.state = 'fight';
    this.currentWave = { noDamage: true, startedAt: this.timer };
    return {
      index: this.currentIndex,
      total: this.bosses.length,
      stage,
    };
  }

  recordPlayerDamage() {
    if (!this.currentWave) return;
    this.currentWave.noDamage = false;
  }

  completeStage() {
    if (this.state !== 'fight' || !this.currentWave) {
      return { completed: false, runComplete: this.completed, perfect: false };
    }
    const stage = this.bosses[this.currentIndex];
    const perfect = !!this.currentWave.noDamage;
    if (perfect) this.perfectWaves += 1;
    this.currentWave = null;
    let runComplete = false;
    if (this.currentIndex >= this.bosses.length - 1) {
      this.completed = true;
      this.state = 'complete';
      this.intermissionRemaining = 0;
      runComplete = true;
    } else {
      this.state = 'intermission';
      this.intermissionRemaining = this.intermissionDuration;
      if (this.intermissionRemaining <= 0) {
        this.state = 'ready';
      }
    }
    return {
      completed: true,
      runComplete,
      perfect,
      stageIndex: this.currentIndex,
      totalStages: this.bosses.length,
      stage,
    };
  }

  isComplete() {
    return this.completed;
  }

  getTimer() {
    return this.timer;
  }

  getPerfectWaveCount() {
    return this.perfectWaves;
  }

  getTotalStages() {
    return this.bosses.length;
  }

  getCurrentStageInfo() {
    const stage = this.currentIndex >= 0 ? this.bosses[this.currentIndex] : null;
    return {
      index: this.currentIndex,
      total: this.bosses.length,
      stage,
      state: this.state,
      intermissionRemaining: this.state === 'intermission' ? this.intermissionRemaining : 0,
    };
  }

  getIntermissionRemaining() {
    if (this.state !== 'intermission') return 0;
    return this.intermissionRemaining;
  }
}
