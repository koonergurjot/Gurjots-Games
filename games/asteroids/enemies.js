export const patternTables = {
  zigzag: [
    { vy: 1.5, time: 60 },
    { vy: -1.5, time: 60 }
  ],
  spiral: { interval: 0.2, speed: 3, step: Math.PI / 6 },
  targeted: { interval: 1.5, speed: 5 }
};

export class Saucer {
  constructor(x, y, dir = 1, pattern = patternTables.zigzag) {
    this.type = 'saucer';
    this.x = x;
    this.y = y;
    this.vx = dir * 2.2; // per frame units
    this.vy = 0;
    this.r = 12;
    this.hp = 2;
    this.fire = 0;
    this.pattern = pattern;
    this.pIndex = 0;
    this.pTime = pattern[0].time;
  }

  update(dt, ship, bullets) {
    const mul = dt * 60; // convert seconds to frame units
    this.pTime -= mul;
    if (this.pTime <= 0) {
      this.pIndex = (this.pIndex + 1) % this.pattern.length;
      this.pTime += this.pattern[this.pIndex].time;
    }
    this.vy = this.pattern[this.pIndex].vy;

    this.x += this.vx * mul;
    this.y += this.vy * mul;

    this.fire -= dt;
    if (this.fire <= 0) {
      this.fire = 1.2 + Math.random() * 0.8;
      const dx = ship.x - this.x;
      const dy = ship.y - this.y;
      const a = Math.atan2(dy, dx);
      const sp = 4.5;
      bullets.push({ x: this.x, y: this.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 180, enemy: true });
    }
  }
}

export class Boss {
  constructor(x, y, dir = 1) {
    this.type = 'boss';
    this.x = x;
    this.y = y;
    this.vx = dir * 3; // per frame units
    this.vy = 0;
    this.r = 20;
    this.hp = 8;
    this.spiralAngle = 0;
    this.spiralTimer = patternTables.spiral.interval;
    this.targetTimer = patternTables.targeted.interval;
  }

  update(dt, ship, bullets) {
    const mul = dt * 60;
    this.x += this.vx * mul;
    this.y += this.vy * mul;

    // spiral shots
    this.spiralTimer -= dt;
    if (this.spiralTimer <= 0) {
      this.spiralTimer += patternTables.spiral.interval;
      const sp = patternTables.spiral.speed;
      bullets.push({ x: this.x, y: this.y, vx: Math.cos(this.spiralAngle) * sp, vy: Math.sin(this.spiralAngle) * sp, life: 200, enemy: true });
      this.spiralAngle += patternTables.spiral.step;
    }

    // targeted shots
    this.targetTimer -= dt;
    if (this.targetTimer <= 0) {
      this.targetTimer += patternTables.targeted.interval;
      const dx = ship.x - this.x;
      const dy = ship.y - this.y;
      const a = Math.atan2(dy, dx);
      const sp = patternTables.targeted.speed;
      bullets.push({ x: this.x, y: this.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 200, enemy: true });
    }
  }
}

export default { Saucer, Boss, patternTables };
