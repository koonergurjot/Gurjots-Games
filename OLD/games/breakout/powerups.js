export class PowerUpEngine {
  constructor() {
    this.active = [];
  }

  activate(type, duration, apply, remove) {
    apply();
    this.active.push({ type, remaining: duration, remove });
  }

  update(dt) {
    for (const p of this.active) {
      p.remaining -= dt;
    }
    const expired = this.active.filter(p => p.remaining <= 0);
    for (const p of expired) {
      p.remove();
    }
    this.active = this.active.filter(p => p.remaining > 0);
  }

  reset() {
    for (const p of this.active) {
      p.remove();
    }
    this.active = [];
  }
}
export default PowerUpEngine;
