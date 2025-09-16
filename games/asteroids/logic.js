const TAU = Math.PI * 2;
const ROTATION_SPEED = 3.2;
const THRUST_ACCEL = 230;
const DRAG = 0.6;
const MAX_SPEED = 360;
const BULLET_SPEED = 520;
const BULLET_LIFETIME = 1.15;
const BULLET_COOLDOWN = 0.22;
const ASTEROID_RADII = { 3: 36, 2: 24, 1: 16 };
const ASTEROID_SCORES = { 3: 20, 2: 50, 1: 100 };

const DEFAULT_STATE = {
  width: 960,
  height: 600,
  rng: Math.random,
  best: 0
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function wrap(value, max) {
  const limit = max <= 0 ? 1 : max;
  let result = value;
  while (result < 0) result += limit;
  while (result >= limit) result -= limit;
  return result;
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
    invincible: 2,
    reload: 0,
    flame: 0,
    thrusting: false
  };
}

function createAsteroid(state, size = 3, origin) {
  const { rng, width, height } = state;
  let x;
  let y;
  if (origin && typeof origin.x === 'number' && typeof origin.y === 'number') {
    x = origin.x;
    y = origin.y;
  } else {
    let attempts = 0;
    do {
      x = rng() * width;
      y = rng() * height;
      attempts++;
    } while (
      attempts < 8 &&
      Math.hypot(x - state.ship.x, y - state.ship.y) < Math.max(160, state.ship.radius * 6)
    );
  }

  const heading = rng() * TAU;
  const baseSpeed = 40 + (3 - size) * 22 + state.level * 6;
  const speed = baseSpeed + rng() * 40;
  const vx = Math.cos(heading) * speed;
  const vy = Math.sin(heading) * speed;
  const spin = (rng() - 0.5) * 1.2;
  const angle = rng() * TAU;
  const segments = 9 + Math.floor(rng() * 6);
  const points = Array.from({ length: segments }, () => 0.65 + rng() * 0.6);

  return {
    x,
    y,
    vx,
    vy,
    angle,
    spin,
    size,
    radius: ASTEROID_RADII[size] ?? 24,
    points
  };
}

function spawnAsteroids(state, count) {
  const total = count ?? Math.min(3 + state.level, 10);
  for (let i = 0; i < total; i++) {
    state.asteroids.push(createAsteroid(state, 3));
  }
}

function splitAsteroid(state, asteroid) {
  if (asteroid.size <= 1) return [];
  const fragments = [];
  for (let i = 0; i < 2; i++) {
    const fragment = createAsteroid(state, asteroid.size - 1, {
      x: asteroid.x,
      y: asteroid.y
    });
    fragment.vx += asteroid.vx * 0.3;
    fragment.vy += asteroid.vy * 0.3;
    fragments.push(fragment);
  }
  return fragments;
}

export function createState(options = {}) {
  const config = { ...DEFAULT_STATE, ...options };
  const ship = createShip(config.width, config.height);
  const state = {
    width: config.width,
    height: config.height,
    rng: config.rng,
    level: 1,
    score: 0,
    best: config.best ?? 0,
    lives: 3,
    ship,
    bullets: [],
    asteroids: [],
    pendingWave: false,
    waveTimer: 0,
    message: 'Level 1',
    messageTimer: 1.2,
    gameOver: false,
    justLostLife: false
  };
  spawnAsteroids(state);
  return state;
}

function fireBullet(state) {
  const { ship } = state;
  if (ship.reload > 0) return;
  const cap = Math.min(4 + state.level, 9);
  if (state.bullets.length >= cap) return;
  const dirX = Math.cos(ship.angle);
  const dirY = Math.sin(ship.angle);
  state.bullets.push({
    x: ship.x + dirX * ship.radius,
    y: ship.y + dirY * ship.radius,
    vx: ship.vx + dirX * BULLET_SPEED,
    vy: ship.vy + dirY * BULLET_SPEED,
    life: BULLET_LIFETIME
  });
  ship.reload = BULLET_COOLDOWN;
}

function updateShip(state, input, dt) {
  const { ship } = state;
  ship.thrusting = !!input.thrust;
  ship.angle += clamp(input.rotate ?? 0, -1, 1) * ROTATION_SPEED * dt;

  if (ship.thrusting) {
    const ax = Math.cos(ship.angle) * THRUST_ACCEL;
    const ay = Math.sin(ship.angle) * THRUST_ACCEL;
    ship.vx += ax * dt;
    ship.vy += ay * dt;
    ship.flame = Math.min(1, ship.flame + dt * 5);
  } else {
    ship.flame = Math.max(0, ship.flame - dt * 4.5);
  }

  const drag = Math.max(0, 1 - DRAG * dt);
  ship.vx *= drag;
  ship.vy *= drag;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > MAX_SPEED) {
    const scale = MAX_SPEED / speed;
    ship.vx *= scale;
    ship.vy *= scale;
  }

  ship.x = wrap(ship.x + ship.vx * dt, state.width);
  ship.y = wrap(ship.y + ship.vy * dt, state.height);
}

function updateBullets(state, dt) {
  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    if (
      bullet.x < -32 ||
      bullet.x > state.width + 32 ||
      bullet.y < -32 ||
      bullet.y > state.height + 32
    ) {
      bullet.life = 0;
    }
  }
  state.bullets = state.bullets.filter(bullet => bullet.life > 0 && !bullet.dead);
}

function updateAsteroids(state, dt) {
  for (const rock of state.asteroids) {
    rock.x = wrap(rock.x + rock.vx * dt, state.width);
    rock.y = wrap(rock.y + rock.vy * dt, state.height);
    rock.angle += rock.spin * dt;
  }
}

function handleShipCollisions(state) {
  const { ship } = state;
  if (ship.invincible > 0) return;
  for (const rock of state.asteroids) {
    const limit = ship.radius + rock.radius;
    if (distanceSquared(ship.x, ship.y, rock.x, rock.y) <= limit * limit) {
      state.justLostLife = true;
      state.lives -= 1;
      if (state.lives <= 0) {
        state.lives = 0;
        state.gameOver = true;
        state.pendingWave = false;
        state.waveTimer = 0;
        state.message = 'Game Over';
        state.messageTimer = 3;
      } else {
        ship.invincible = 2.5;
        ship.x = state.width / 2;
        ship.y = state.height / 2;
        ship.vx = 0;
        ship.vy = 0;
        ship.angle = -Math.PI / 2;
        ship.flame = 0;
        ship.thrusting = false;
        ship.reload = BULLET_COOLDOWN;
        state.message = 'Life lost';
        state.messageTimer = 1.2;
      }
      break;
    }
  }
}

function handleBulletHits(state) {
  const survivors = [];
  const spawned = [];
  for (const rock of state.asteroids) {
    let destroyed = false;
    for (const bullet of state.bullets) {
      if (bullet.life <= 0 || bullet.dead) continue;
      const limit = rock.radius + 4;
      if (distanceSquared(rock.x, rock.y, bullet.x, bullet.y) <= limit * limit) {
        bullet.dead = true;
        destroyed = true;
        state.score += ASTEROID_SCORES[rock.size] ?? 10;
        spawned.push(...splitAsteroid(state, rock));
        break;
      }
    }
    if (!destroyed) survivors.push(rock);
  }
  state.asteroids = survivors.concat(spawned);
}

function startNextWave(state) {
  state.pendingWave = true;
  state.level += 1;
  state.waveTimer = 1.3;
  state.message = `Level ${state.level}`;
  state.messageTimer = 1.3;
}

function progressWave(state, dt) {
  if (!state.pendingWave) return;
  state.waveTimer -= dt;
  if (state.waveTimer <= 0) {
    state.pendingWave = false;
    state.waveTimer = 0;
    spawnAsteroids(state);
  }
}

export function stepState(state, input, dt) {
  if (state.gameOver) {
    state.messageTimer = Math.max(0, state.messageTimer - dt);
    state.best = Math.max(state.best, state.score);
    return state;
  }

  state.justLostLife = false;
  const { ship } = state;
  ship.reload = Math.max(0, ship.reload - dt);
  ship.invincible = Math.max(0, ship.invincible - dt);

  updateShip(state, input, dt);
  if (input.fire) fireBullet(state);

  updateBullets(state, dt);
  updateAsteroids(state, dt);

  handleShipCollisions(state);
  handleBulletHits(state);

  if (!state.pendingWave && state.asteroids.length === 0) {
    startNextWave(state);
  }
  progressWave(state, dt);

  state.best = Math.max(state.best, state.score);
  state.messageTimer = Math.max(0, state.messageTimer - dt);

  return state;
}

export function directShip(state, overrides) {
  Object.assign(state.ship, overrides);
}

function cloneAsteroid(rock) {
  const size = rock.size ?? 3;
  return {
    x: rock.x ?? 0,
    y: rock.y ?? 0,
    vx: rock.vx ?? 0,
    vy: rock.vy ?? 0,
    angle: rock.angle ?? 0,
    spin: rock.spin ?? 0,
    size,
    radius: rock.radius ?? ASTEROID_RADII[size] ?? 24,
    points: rock.points ? [...rock.points] : rock.shape ? [...rock.shape] : [1, 1, 1, 1]
  };
}

export function forceAsteroids(state, asteroids) {
  state.asteroids = asteroids.map(cloneAsteroid);
  state.pendingWave = false;
  state.waveTimer = 0;
}

export function addBullet(state, bullet) {
  state.bullets.push({
    x: bullet.x ?? state.ship.x,
    y: bullet.y ?? state.ship.y,
    vx: bullet.vx ?? 0,
    vy: bullet.vy ?? 0,
    life: bullet.life ?? BULLET_LIFETIME
  });
}

export { ASTEROID_RADII, ASTEROID_SCORES };
