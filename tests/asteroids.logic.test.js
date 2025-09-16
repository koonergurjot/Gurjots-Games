import { describe, expect, it } from 'vitest';
import {
  createState,
  stepState,
  forceAsteroids,
  addBullet,
  directShip
} from '../games/asteroids/logic.js';

const noopInput = { rotate: 0, thrust: false, fire: false };

function createTestState(overrides = {}) {
  const rng = () => 0.5;
  const state = createState({ width: 400, height: 300, rng, ...overrides });
  state.asteroids = [];
  state.bullets = [];
  return state;
}

describe('asteroids logic', () => {
  it('destroys asteroids when hit by a bullet', () => {
    const state = createTestState();
    forceAsteroids(state, [{
      x: 200,
      y: 150,
      vx: 0,
      vy: 0,
      size: 1,
      radius: 18,
      spin: 0,
      angle: 0,
      shape: [1, 1, 1, 1]
    }]);
    addBullet(state, { x: 200, y: 150, vx: 0, vy: 0, life: 0.5 });

    stepState(state, noopInput, 0.05);

    expect(state.asteroids.length).toBe(0);
    expect(state.score).toBeGreaterThan(0);
  });

  it('spawns a new wave when all asteroids are cleared', () => {
    const state = createTestState();
    stepState(state, noopInput, 0.1);

    // Remove all asteroids and advance time to trigger next wave
    state.asteroids = [];
    stepState(state, noopInput, 0.1);
    expect(state.level).toBe(2);
    expect(state.pendingLevel).toBe(true);

    stepState(state, noopInput, 2);
    expect(state.pendingLevel).toBe(false);
    expect(state.asteroids.length).toBeGreaterThan(0);
  });

  it('reduces lives and grants invincibility after a collision', () => {
    const state = createTestState();
    forceAsteroids(state, [{
      x: state.ship.x,
      y: state.ship.y,
      vx: 0,
      vy: 0,
      size: 1,
      radius: 18,
      spin: 0,
      angle: 0,
      shape: [1, 1, 1, 1]
    }]);
    directShip(state, { invincible: 0 });
    const livesBefore = state.lives;

    stepState(state, noopInput, 0.016);

    expect(state.lives).toBe(livesBefore - 1);
    expect(state.ship.invincible).toBeGreaterThan(0);
    expect(state.justLostLife).toBe(true);
  });

  it('sets game over when lives are exhausted', () => {
    const state = createTestState();
    state.lives = 1;
    forceAsteroids(state, [{
      x: state.ship.x,
      y: state.ship.y,
      vx: 0,
      vy: 0,
      size: 1,
      radius: 18,
      spin: 0,
      angle: 0,
      shape: [1, 1, 1, 1]
    }]);
    directShip(state, { invincible: 0 });

    stepState(state, noopInput, 0.05);

    expect(state.gameOver).toBe(true);
    expect(state.lives).toBeLessThanOrEqual(0);
  });
});
