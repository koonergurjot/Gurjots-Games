export class Body {
  constructor({ position, size, velocity, mass = 1, restitution = 0, isStatic = false } = {}) {
    if (!position || !size) throw new Error('position and size required');
    this.position = position.slice();
    this.size = size.slice();
    const dim = this.position.length;
    this.velocity = velocity ? velocity.slice() : new Array(dim).fill(0);
    this.mass = mass;
    this.restitution = restitution;
    this.isStatic = isStatic;
    this.onGround = false;
  }
}

export class World {
  constructor({ gravity } = {}) {
    this.gravity = gravity || [0, -9.8];
    this.dim = this.gravity.length;
    this.bodies = [];
  }

  addBody(body) {
    this.bodies.push(body);
    return body;
  }

  step(dt) {
    // Integrate motion
    for (const b of this.bodies) {
      b.onGround = false;
      if (b.isStatic) continue;
      for (let i = 0; i < this.dim; i++) {
        b.velocity[i] += (this.gravity[i] || 0) * dt;
        b.position[i] += b.velocity[i] * dt;
      }
    }

    // Collision detection and resolution
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        this.#resolve(this.bodies[i], this.bodies[j]);
      }
    }
  }

  #resolve(a, b) {
    const dim = this.dim;
    let overlap = Infinity;
    let axis = -1;
    let axisSign = 0;
    for (let i = 0; i < dim; i++) {
      const dist = a.position[i] - b.position[i];
      const pen = (a.size[i] / 2 + b.size[i] / 2) - Math.abs(dist);
      if (pen <= 0) return; // No collision
      if (pen < overlap) {
        overlap = pen;
        axis = i;
        axisSign = Math.sign(dist) || 1;
      }
    }

    const invMassA = a.isStatic ? 0 : 1 / a.mass;
    const invMassB = b.isStatic ? 0 : 1 / b.mass;
    const invMassSum = invMassA + invMassB;
    if (invMassSum === 0) return; // both static

    const moveA = invMassA / invMassSum * overlap;
    const moveB = invMassB / invMassSum * overlap;
    if (!a.isStatic) a.position[axis] += moveA * axisSign;
    if (!b.isStatic) b.position[axis] -= moveB * axisSign;

    const va = a.velocity[axis];
    const vb = b.velocity[axis];
    const rel = va - vb;
    const restitution = Math.min(a.restitution, b.restitution);
    const impulse = -(1 + restitution) * rel / invMassSum;
    if (!a.isStatic) a.velocity[axis] += impulse * invMassA;
    if (!b.isStatic) b.velocity[axis] -= impulse * invMassB;

    if (axis === 1) {
      if (axisSign > 0) {
        b.onGround = true;
      } else {
        a.onGround = true;
      }
    }
  }
}
