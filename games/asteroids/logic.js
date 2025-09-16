const SCORE_BY_SIZE = { 3: 20, 2: 50, 1: 100 };
const BASE_ROCK_RADIUS = 18;
const ROTATION_SPEED = 3.2; // radians per second
const THRUST_ACCEL = 240;
const DRAG = 0.9; // velocity multiplier per second
const SHIP_MAX_SPEED = 360;
const BULLET_SPEED = 520;
const BULLET_LIFE = 1.2; // seconds
const BULLET_COOLDOWN = 0.22; // seconds between shots

const DEFAULT_STATE = {
  width: 960,
  height: 600,
  rng: Math.random
};

function wrap(value, max) {
  if (value < 0) return value + max;
  if (value >= max) return value - max;
  return value;
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function magnitude(x, y) {
  return Math.hypot(x, y);
}

function distanceSquared(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function createShip(width, height) {
  return {
    x: width / 2,
    y: height / 2,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    radius: 16,
    invincible: 2.5,
    cooldown: 0,
    flame: 0,
    thrusting: false
  };
}

function createAsteroid(state, size = 3) {
  const { width, height, rng } = state;
  const edge = rng();
  let x;
  let y;
  if (edge < 0.25) {
    x = 0;
    y = rng() * height;
  } else if (edge < 0.5) {
    x = width;
    y = rng() * height;
  } else if (edge < 0.75) {
    x = rng() * width;
    y = 0;
  } else {
    x = rng() * width;
    y = height;
  }

  const angle = rng() * Math.PI * 2;
  const speed = 40 + rng() * 60 + state.level * 6;
  const segments = 10 + Math.floor(rng() * 6);
  const shape = Array.from({ length: segments }, () => 0.7 + rng() * 0.45);
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size,
    radius: size * BASE_ROCK_RADIUS,
    spin: rng() * 1.2 - 0.6,
    angle: rng() * Math.PI * 2,
    shape
  };
}

function splitAsteroid(state, asteroid) {
  if (asteroid.size <= 1) return;
  const { rng } = state;
  for (let i = 0; i < 2; i++) {
    const angle = rng() * Math.PI * 2;
    const speed = 60 + rng() * 80 + state.level * 10;
    const segments = 8 + Math.floor(rng() * 5);
    const shape = Array.from({ length: segments }, () => 0.75 + rng() * 0.35);
    state.asteroids.push({
      x: asteroid.x,
      y: asteroid.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: asteroid.size - 1,
      radius: (asteroid.size - 1) * BASE_ROCK_RADIUS,
      spin: rng() * 1.5 - 0.75,
      angle: rng() * Math.PI * 2,
      shape
    });
  }
}

function spawnAsteroids(state, count) {
  const total = count ?? clamp(2 + state.level, 4, 12);
  for (let i = 0; i < total; i++) {
    state.asteroids.push(createAsteroid(state, 3));
  }
}

export function createState(options = {}) {
  const { width, height, rng, best = 0 } = { ...DEFAULT_STATE, ...options };
  const state = {
    width,
    height,
    rng,
    level: 1,
    score: 0,
    best,
    lives: 3,
    ship: createShip(width, height),
    bullets: [],
    asteroids: [],
    particles: [],
    pendingLevel: false,
    levelTimer: 0,
    gameOver: false,
    justLostLife: false,
    message: '',
    messageTimer: 0
  };
  spawnAsteroids(state);
  return state;
}

function fireBullet(state) {
  const { ship } = state;
  if (ship.cooldown > 0) return;
  const cap = clamp(4 + Math.floor(state.level / 2), 4, 10);
  if (state.bullets.length >= cap) return;
  const dirX = Math.cos(ship.angle);
  const dirY = Math.sin(ship.angle);
  state.bullets.push({
    x: ship.x + dirX * ship.radius,
    y: ship.y + dirY * ship.radius,
    vx: ship.vx + dirX * BULLET_SPEED,
    vy: ship.vy + dirY * BULLET_SPEED,
    life: BULLET_LIFE
  });
  ship.cooldown = BULLET_COOLDOWN;
}

function handleShipMovement(state, input, dt) {
  const { ship } = state;
  ship.thrusting = false;
  if (input.rotate) {
    ship.angle += input.rotate * ROTATION_SPEED * dt;
  }

  if (input.thrust) {
    const ax = Math.cos(ship.angle) * THRUST_ACCEL;
    const ay = Math.sin(ship.angle) * THRUST_ACCEL;
    ship.vx += ax * dt;
    ship.vy += ay * dt;
    ship.thrusting = true;
    ship.flame = Math.min(1, ship.flame + dt * 4);
  } else {
    ship.flame = Math.max(0, ship.flame - dt * 6);
  }

  const dragFactor = Math.pow(DRAG, dt);
  ship.vx *= dragFactor;
  ship.vy *= dragFactor;

  const speed = magnitude(ship.vx, ship.vy);
  if (speed > SHIP_MAX_SPEED) {
    const scale = SHIP_MAX_SPEED / speed;
    ship.vx *= scale;
    ship.vy *= scale;
  }

  ship.x = wrap(ship.x + ship.vx * dt, state.width);
  ship.y = wrap(ship.y + ship.vy * dt, state.height);
}

function resolveCollisions(state) {
  const { ship } = state;
  if (ship.invincible <= 0 && !state.gameOver) {
    for (const rock of state.asteroids) {
      const dist = distanceSquared(ship.x, ship.y, rock.x, rock.y);
      const maxDist = (ship.radius + rock.radius) ** 2;
      if (dist < maxDist) {
        state.justLostLife = true;
        state.lives -= 1;
        ship.invincible = 3;
        ship.x = state.width / 2;
        ship.y = state.height / 2;
        ship.vx = 0;
        ship.vy = 0;
        ship.angle = -Math.PI / 2;
        ship.cooldown = BULLET_COOLDOWN;
        if (state.lives <= 0) {
          state.gameOver = true;
          state.message = 'Game Over';
          state.messageTimer = 2.5;
        }
        break;
      }
    }
  }

  const remainingAsteroids = [];
  for (const rock of state.asteroids) {
    let destroyed = false;
    for (const bullet of state.bullets) {
      if (bullet.life <= 0) continue;
      const dist = distanceSquared(rock.x, rock.y, bullet.x, bullet.y);
      if (dist < (rock.radius + 4) ** 2) {
        bullet.life = 0;
        destroyed = true;
        state.score += SCORE_BY_SIZE[rock.size] ?? 10;
        splitAsteroid(state, rock);
        break;
      }
    }
    if (!destroyed) remainingAsteroids.push(rock);
  }
  state.asteroids = remainingAsteroids;
}

export function stepState(state, input, dt) {
  if (state.gameOver) {
    state.messageTimer = Math.max(0, state.messageTimer - dt);
    return state;
  }

  state.justLostLife = false;
  const { ship } = state;
  ship.cooldown = Math.max(0, ship.cooldown - dt);
  ship.invincible = Math.max(0, ship.invincible - dt);

  handleShipMovement(state, input, dt);
  if (input.fire) fireBullet(state);

  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
  }
  state.bullets = state.bullets.filter(b => b.life > 0);

  for (const rock of state.asteroids) {
    rock.x = wrap(rock.x + rock.vx * dt, state.width);
    rock.y = wrap(rock.y + rock.vy * dt, state.height);
    rock.angle += rock.spin * dt;
  }

  resolveCollisions(state);
  state.best = Math.max(state.best, state.score);

  if (!state.pendingLevel && state.asteroids.length === 0) {
    state.pendingLevel = true;
    state.levelTimer = 1.4;
    state.level += 1;
    state.message = `Level ${state.level}`;
    state.messageTimer = 1.2;
  }

  if (state.pendingLevel) {
    state.levelTimer -= dt;
    if (state.levelTimer <= 0) {
      state.pendingLevel = false;
      spawnAsteroids(state);
    }
  }

  state.messageTimer = Math.max(0, state.messageTimer - dt);

  return state;
}

export function directShip(state, overrides) {
  Object.assign(state.ship, overrides);
}

export function forceAsteroids(state, asteroids) {
  state.asteroids = asteroids.map(rock => ({ ...rock, shape: rock.shape ? [...rock.shape] : undefined }));
}

export function addBullet(state, bullet) {
  state.bullets.push({ ...bullet });
}

export { BASE_ROCK_RADIUS, SCORE_BY_SIZE };
