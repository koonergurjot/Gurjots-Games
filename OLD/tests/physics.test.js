import { describe, it, expect } from 'vitest';
import { World, Body } from '../games/box-core/physics.js';

describe('Physics 2D collision', () => {
  it('resolves vertical collision with restitution', () => {
    const world = new World({ gravity: [0, -10] });
    const ground = new Body({ position: [0, -0.5], size: [10, 1], isStatic: true, restitution: 0.5 });
    const box = new Body({ position: [0, 1], size: [1, 1], velocity: [0, -5], restitution: 0.5 });
    world.addBody(ground);
    world.addBody(box);
    world.step(0.1);
    expect(box.position[1]).toBeCloseTo(0.5, 5);
    expect(box.velocity[1]).toBeGreaterThan(0);
  });
});

describe('Physics 3D collision', () => {
  it('resolves horizontal collision with restitution', () => {
    const world = new World({ gravity: [0, 0, 0] });
    const wall = new Body({ position: [0, 0, 0], size: [2, 2, 2], isStatic: true, restitution: 0.5 });
    const box = new Body({ position: [-3, 0, 0], size: [2, 2, 2], velocity: [5, 0, 0], restitution: 0.5 });
    world.addBody(wall);
    world.addBody(box);
    world.step(0.4);
    expect(box.position[0]).toBeCloseTo(-2, 5);
    expect(box.velocity[0]).toBeLessThan(0);
  });
});
