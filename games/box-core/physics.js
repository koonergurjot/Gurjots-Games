export class Body {
  constructor({
    position,
    size,
    velocity,
    mass = 1,
    restitution = 0,
    friction = 0.2,
    damping = 0.01,
    isStatic = false,
  } = {}) {
    if (!position || !size) throw new Error('position and size required');
    this.position = position.slice();
    this.size = size.slice();
    const dim = this.position.length;
    this.velocity = velocity ? velocity.slice() : new Array(dim).fill(0);
    this.mass = mass;
    this.restitution = restitution;
    this.friction = friction;
    this.damping = damping;
    this.isStatic = isStatic;
    this.onGround = false;
  }
}

export class World {
  constructor({ gravity, broadphaseCellSize = 5 } = {}) {
    this.gravity = gravity || [0, -9.8];
    this.dim = this.gravity.length;
    this.bodies = [];
    this.broadphaseCellSize = Math.max(broadphaseCellSize || 0, Number.EPSILON);
    this.contactListeners = new Set();
  }

  addBody(body) {
    this.bodies.push(body);
    return body;
  }

  onContact(listener) {
    if (typeof listener !== 'function') return () => {};
    this.contactListeners.add(listener);
    return () => this.contactListeners.delete(listener);
  }

  #emitContact(contact) {
    if (!this.contactListeners.size) return;
    for (const listener of this.contactListeners) {
      try {
        listener(contact);
      } catch (error) {
        console.error('Contact listener failed', error);
      }
    }
  }

  #forEachCell(minIndices, maxIndices, callback, depth = 0, prefix = []) {
    if (depth === minIndices.length) {
      callback([...prefix]);
      return;
    }
    for (let i = minIndices[depth]; i <= maxIndices[depth]; i++) {
      prefix[depth] = i;
      this.#forEachCell(minIndices, maxIndices, callback, depth + 1, prefix);
    }
  }

  step(dt) {
    // Integrate motion
    for (const b of this.bodies) {
      b.onGround = false;
      if (b.isStatic) continue;
      for (let i = 0; i < this.dim; i++) {
        b.velocity[i] += (this.gravity[i] || 0) * dt;
        const dampingFactor = Math.max(0, 1 - (b.damping || 0) * dt);
        b.velocity[i] *= dampingFactor;
        b.position[i] += b.velocity[i] * dt;
      }
    }

    // Broad-phase collision detection via spatial hashing grid
    const cellSize = this.broadphaseCellSize;
    const buckets = new Map();

    const addToBucket = (key, index) => {
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(index);
      } else {
        buckets.set(key, [index]);
      }
    };

    for (let index = 0; index < this.bodies.length; index++) {
      const body = this.bodies[index];
      const halfSizes = body.size.map((s) => s / 2);
      const minIndices = halfSizes.map((half, axis) =>
        Math.floor((body.position[axis] - half) / cellSize),
      );
      const maxIndices = halfSizes.map((half, axis) =>
        Math.floor((body.position[axis] + half) / cellSize),
      );

      this.#forEachCell(minIndices, maxIndices, (coords) => {
        addToBucket(coords.join(','), index);
      });
    }

    const processedPairs = new Set();
    for (const bucket of buckets.values()) {
      for (let i = 0; i < bucket.length; i++) {
        const bodyIndexA = bucket[i];
        for (let j = i + 1; j < bucket.length; j++) {
          const bodyIndexB = bucket[j];
          const key = bodyIndexA < bodyIndexB
            ? `${bodyIndexA}:${bodyIndexB}`
            : `${bodyIndexB}:${bodyIndexA}`;
          if (processedPairs.has(key)) continue;
          processedPairs.add(key);
          this.#resolve(this.bodies[bodyIndexA], this.bodies[bodyIndexB]);
        }
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

    const friction = Math.min(a.friction ?? 0, b.friction ?? 0);
    if (friction > 0) {
      for (let i = 0; i < dim; i++) {
        if (i === axis) continue;
        const relVel = a.velocity[i] - b.velocity[i];
        const frictionImpulse = relVel * friction / invMassSum;
        if (!a.isStatic) a.velocity[i] -= frictionImpulse * invMassA;
        if (!b.isStatic) b.velocity[i] += frictionImpulse * invMassB;
      }
    }

    if (axis === 1) {
      if (axisSign > 0) {
        b.onGround = true;
      } else {
        a.onGround = true;
      }
    }

    const normal = new Array(dim).fill(0);
    normal[axis] = axisSign;
    this.#emitContact({
      bodyA: a,
      bodyB: b,
      normal,
      overlap,
      axis,
      axisSign,
      relativeVelocity: rel,
    });
  }
}
