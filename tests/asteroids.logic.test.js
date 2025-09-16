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
  const state = createState({ width: 420, height: 320, rng, ...overrides });
  state.asteroids = [];
  state.bullets = [];
  state.pendingWave = false;
  state.waveTimer = 0;
  state.score = 0;
  return state;
}

describe('asteroids logic', () => {
  it('removes asteroids when struck by a bullet', () => {
    const state = createTestState();
    forceAsteroids(state, [
      {
        x: 200,
        y: 160,
        vx: 0,
        vy: 0,
        size: 1,
        radius: 16,
        points: [1, 1, 1, 1]
      }
    ]);
    addBullet(state, { x: 200, y: 160, vx: 0, vy: 0, life: 0.5 });

    stepState(state, noopInput, 0.05);

    expect(state.asteroids.length).toBe(0);
    expect(state.score).toBeGreaterThan(0);
  });

  it('queues and spawns the next level when asteroids are cleared', () => {
    const state = createTestState();

    stepState(state, noopInput, 0.05);
    expect(state.level).toBe(2);
    expect(state.pendingWave).toBe(true);

    stepState(state, noopInput, 2);
    expect(state.pendingWave).toBe(false);
    expect(state.asteroids.length).toBeGreaterThan(0);
  });

  it('reduces lives and grants invincibility on collision', () => {
    const state = createTestState();
    forceAsteroids(state, [
      {
        x: state.ship.x,
        y: state.ship.y,
        vx: 0,
        vy: 0,
        size: 1,
        radius: 18,
        points: [1, 1, 1, 1]
      }
    ]);
    directShip(state, { invincible: 0 });
    const livesBefore = state.lives;

    stepState(state, noopInput, 0.016);

    expect(state.lives).toBe(livesBefore - 1);
    expect(state.ship.invincible).toBeGreaterThan(0);
    expect(state.justLostLife).toBe(true);
  });

  it('marks game over when all lives are lost', () => {
    const state = createTestState();
    state.lives = 1;
    forceAsteroids(state, [
      {
        x: state.ship.x,
        y: state.ship.y,
        vx: 0,
        vy: 0,
        size: 1,
        radius: 18,
        points: [1, 1, 1, 1]
      }
    ]);
    directShip(state, { invincible: 0 });

    stepState(state, noopInput, 0.05);

    expect(state.gameOver).toBe(true);
    expect(state.message).toMatch(/game over/i);
  });
});
