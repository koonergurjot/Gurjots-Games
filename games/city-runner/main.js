const WIDTH = 960;
const HEIGHT = 320;
const PLAYER_X = 180;
const JUMP_FORCE = 410;
const GRAVITY = 1400;
const OBSTACLE_INTERVAL = [1.1, 1.8];

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const lodToggle = document.getElementById('lodToggle');

let deviceScale = window.devicePixelRatio || 1;
let rafHandle = null;

const state = {
  running: false,
  elapsed: 0,
  speed: 320,
  distance: 0,
  spawnTimer: 1.2,
  score: 0,
  queuedJump: false,
  lod: 'high',
};

const player = {
  x: PLAYER_X,
  y: 0,
  vy: 0,
  width: 42,
  height: 54,
  onGround: true,
  hurtTimer: 0,
};

const obstacles = [];
let parallax = null;
let atlas = null;
const spriteMetrics = {
  player: { width: 42, height: 54 },
  obstacle: { width: 48, height: 40 },
};

function resizeCanvas() {
  deviceScale = window.devicePixelRatio || 1;
  const ratio = deviceScale;
  canvas.width = Math.floor(WIDTH * ratio);
  canvas.height = Math.floor(HEIGHT * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function onResize() {
  resizeCanvas();
  parallax?.notifyResize();
}

window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

function randInRange([min, max]) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function loadParallax(config) {
  const layers = [];
  for (const layerConfig of config.layers) {
    if (layerConfig.type === 'image') {
      const image = await loadImage(layerConfig.source);
      layers.push({
        type: 'image',
        image,
        parallax: layerConfig.parallax ?? 0.5,
        scale: layerConfig.scale ?? 1,
        bottom: layerConfig.bottom ?? 0,
        offset: 0,
        width: image.naturalWidth * (layerConfig.scale ?? 1),
        height: image.naturalHeight * (layerConfig.scale ?? 1),
      });
    } else if (layerConfig.type === 'gradient') {
      layers.push({
        type: 'gradient',
        colors: layerConfig.colors || ['#111', '#000'],
      });
    } else if (layerConfig.type === 'peaks') {
      layers.push({
        type: 'peaks',
        color: layerConfig.color || 'rgba(30, 41, 59, 0.8)',
        parallax: layerConfig.parallax ?? 0.8,
        height: layerConfig.height ?? 80,
        patternWidth: layerConfig.patternWidth ?? 140,
        peakHeight: layerConfig.peakHeight ?? 32,
        offset: 0,
      });
    }
  }

  return {
    baseSpeed: config.baseSpeed ?? 120,
    groundHeight: config.groundHeight ?? 64,
    layers,
    update(dt, worldSpeed) {
      const effectiveSpeed = worldSpeed ?? this.baseSpeed;
      for (const layer of this.layers) {
        if (layer.type === 'image' || layer.type === 'peaks') {
          const speed = effectiveSpeed * (layer.parallax ?? 0.4) * dt;
          layer.offset = (layer.offset + speed) % (layer.width || layer.patternWidth);
        }
      }
    },
    draw(context) {
      for (const layer of this.layers) {
        if (layer.type === 'gradient') {
          const gradient = context.createLinearGradient(0, 0, 0, HEIGHT);
          const colors = layer.colors;
          const step = 1 / Math.max(colors.length - 1, 1);
          colors.forEach((color, index) => {
            gradient.addColorStop(step * index, color);
          });
          context.fillStyle = gradient;
          context.fillRect(0, 0, WIDTH, HEIGHT);
        } else if (layer.type === 'image') {
          const drawHeight = layer.height;
          const drawWidth = layer.width;
          const baseY = HEIGHT - layer.bottom - drawHeight;
          let x = -layer.offset;
          while (x < WIDTH) {
            context.drawImage(layer.image, x, baseY, drawWidth, drawHeight);
            x += drawWidth;
          }
        } else if (layer.type === 'peaks') {
          const baseY = HEIGHT - (layer.height ?? 80);
          const offset = layer.offset % layer.patternWidth;
          const start = -offset - layer.patternWidth;
          context.fillStyle = layer.color;
          for (let x = start; x < WIDTH + layer.patternWidth; x += layer.patternWidth) {
            context.beginPath();
            context.moveTo(x, HEIGHT);
            context.lineTo(x + layer.patternWidth * 0.5, baseY - layer.peakHeight);
            context.lineTo(x + layer.patternWidth, HEIGHT);
            context.closePath();
            context.fill();
          }
          context.fillRect(0, baseY, WIDTH, HEIGHT - baseY);
        }
      }
    },
    notifyResize() {
      // nothing dynamic required because drawing uses CSS pixels
    },
  };
}

async function loadAtlas(config) {
  const sprites = {};
  const loadPromises = [];

  for (const [name, variants] of Object.entries(config.sprites || {})) {
    sprites[name] = {};
    for (const [lod, definition] of Object.entries(variants)) {
      if (definition?.src) {
        const promise = loadImage(definition.src).then((image) => {
          sprites[name][lod] = {
            ...definition,
            image,
            width: definition.size?.[0] ?? image.naturalWidth,
            height: definition.size?.[1] ?? image.naturalHeight,
          };
        });
        loadPromises.push(promise);
      } else {
        const width = definition.width ?? definition.size?.[0];
        const height = definition.height ?? definition.size?.[1];
        sprites[name][lod] = {
          ...definition,
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
        };
      }
    }
  }

  await Promise.all(loadPromises);

  return {
    lodLevels: config.lodLevels || ['high', 'low'],
    sprites,
    getSprite(name, lod) {
      const variants = this.sprites[name] || {};
      return variants[lod] || variants.high || Object.values(variants)[0] || null;
    },
  };
}

function getPlayerSprite() {
  return atlas?.getSprite('runner', state.lod);
}

function getObstacleSprite() {
  return atlas?.getSprite('obstacle', state.lod);
}

function drawRunner(x, y) {
  const sprite = getPlayerSprite();
  if (!sprite) {
    drawFallbackRect(x, y, spriteMetrics.player.width, spriteMetrics.player.height, '#f97316');
    return;
  }
  drawSprite(sprite, x, y);
}

function drawObstacle(obstacle) {
  const sprite = getObstacleSprite();
  if (!sprite) {
    drawFallbackRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, '#94a3b8');
    return;
  }
  drawSprite(sprite, obstacle.x, obstacle.y, obstacle.width, obstacle.height);
}

function drawSprite(sprite, x, y, overrideWidth, overrideHeight) {
  const anchor = sprite.anchor || [0.5, 1];
  const width = overrideWidth ?? sprite.width;
  const height = overrideHeight ?? sprite.height;

  if (sprite.image) {
    const scale = sprite.scale ?? 1;
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const drawX = x - drawWidth * anchor[0];
    const drawY = y - drawHeight * anchor[1];
    ctx.drawImage(sprite.image, drawX, drawY, drawWidth, drawHeight);
    return;
  }

  const drawX = x - width * anchor[0];
  const drawY = y - height * anchor[1];

  if (sprite.shape === 'rect') {
    drawRoundedRect(drawX, drawY, width, height, sprite.radius ?? 8, sprite.color || '#f97316');
  } else if (sprite.shape === 'triangle') {
    ctx.fillStyle = sprite.color || '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(drawX, drawY + height);
    ctx.lineTo(drawX + width / 2, drawY);
    ctx.lineTo(drawX + width, drawY + height);
    ctx.closePath();
    ctx.fill();
  }
}

function drawRoundedRect(x, y, width, height, radius, color) {
  ctx.fillStyle = color;
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function drawFallbackRect(x, y, width, height, color) {
  const drawX = x - width / 2;
  const drawY = y - height;
  drawRoundedRect(drawX, drawY, width, height, 10, color);
}

function spawnObstacle() {
  const sprite = getObstacleSprite();
  const scale = sprite?.scale ?? 1;
  const width = sprite ? (sprite.width ?? spriteMetrics.obstacle.width) * scale : spriteMetrics.obstacle.width;
  const height = sprite ? (sprite.height ?? spriteMetrics.obstacle.height) * scale : spriteMetrics.obstacle.height;
  obstacles.push({
    x: WIDTH + width,
    y: HEIGHT - parallax.groundHeight,
    width,
    height,
  });
}

function resetGame() {
  state.elapsed = 0;
  state.distance = 0;
  state.spawnTimer = randInRange(OBSTACLE_INTERVAL);
  state.score = 0;
  obstacles.length = 0;
  player.y = HEIGHT - parallax.groundHeight;
  player.vy = 0;
  player.onGround = true;
  player.hurtTimer = 0;
}

function setLod(next) {
  state.lod = next;
  lodToggle.textContent = next.charAt(0).toUpperCase() + next.slice(1);
  syncSpriteMetrics();
}

function syncSpriteMetrics() {
  const runnerSprite = getPlayerSprite();
  if (runnerSprite) {
    const scale = runnerSprite.scale ?? 1;
    spriteMetrics.player.width = (runnerSprite.width ?? spriteMetrics.player.width) * scale;
    spriteMetrics.player.height = (runnerSprite.height ?? spriteMetrics.player.height) * scale;
  } else {
    spriteMetrics.player.width = 42;
    spriteMetrics.player.height = 54;
  }
  player.width = spriteMetrics.player.width;
  player.height = spriteMetrics.player.height;

  const obstacleSprite = getObstacleSprite();
  if (obstacleSprite) {
    const scale = obstacleSprite.scale ?? 1;
    spriteMetrics.obstacle.width = (obstacleSprite.width ?? spriteMetrics.obstacle.width) * scale;
    spriteMetrics.obstacle.height = (obstacleSprite.height ?? spriteMetrics.obstacle.height) * scale;
  } else {
    spriteMetrics.obstacle.width = 48;
    spriteMetrics.obstacle.height = 40;
  }

  for (const obstacle of obstacles) {
    obstacle.width = spriteMetrics.obstacle.width;
    obstacle.height = spriteMetrics.obstacle.height;
  }
}

lodToggle.addEventListener('click', () => {
  if (!atlas) return;
  const currentIndex = atlas.lodLevels.indexOf(state.lod);
  const nextIndex = (currentIndex + 1) % atlas.lodLevels.length;
  setLod(atlas.lodLevels[nextIndex]);
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
    event.preventDefault();
    state.queuedJump = true;
  }
});

window.addEventListener('pointerdown', () => {
  state.queuedJump = true;
});

function update(dt) {
  state.elapsed += dt;
  state.distance += state.speed * dt;
  state.spawnTimer -= dt;

  if (state.queuedJump && player.onGround) {
    player.vy = -JUMP_FORCE;
    player.onGround = false;
    state.queuedJump = false;
  }
  state.queuedJump = false;

  player.vy += GRAVITY * dt;
  player.y += player.vy * dt;
  const groundY = HEIGHT - parallax.groundHeight;
  if (player.y > groundY) {
    player.y = groundY;
    player.vy = 0;
    player.onGround = true;
  }

  if (state.spawnTimer <= 0) {
    spawnObstacle();
    state.spawnTimer = randInRange(OBSTACLE_INTERVAL);
  }

  for (let i = obstacles.length - 1; i >= 0; i -= 1) {
    const obstacle = obstacles[i];
    obstacle.x -= state.speed * dt;
    if (obstacle.x + obstacle.width < -32) {
      obstacles.splice(i, 1);
      continue;
    }
    if (checkCollision(player, obstacle)) {
      player.hurtTimer = 0.3;
    }
  }

  if (player.hurtTimer > 0) {
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
  }

  const baseScore = Math.floor(state.distance / 10);
  state.score = player.hurtTimer > 0 ? Math.max(0, baseScore - 60) : baseScore;
  scoreEl.textContent = state.score.toString();

  parallax.update(dt, state.speed * 0.6);
}

function checkCollision(runner, obstacle) {
  const runnerLeft = runner.x - runner.width / 2;
  const runnerRight = runner.x + runner.width / 2;
  const runnerTop = runner.y - runner.height;
  const runnerBottom = runner.y;

  const obstacleLeft = obstacle.x - obstacle.width / 2;
  const obstacleRight = obstacle.x + obstacle.width / 2;
  const obstacleTop = obstacle.y - obstacle.height;
  const obstacleBottom = obstacle.y;

  return !(
    runnerRight < obstacleLeft ||
    runnerLeft > obstacleRight ||
    runnerBottom < obstacleTop ||
    runnerTop > obstacleBottom
  );
}

function draw(dt) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  parallax.draw(ctx);

  // ground highlight
  const groundY = HEIGHT - parallax.groundHeight;
  ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
  ctx.fillRect(0, groundY, WIDTH, parallax.groundHeight);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.fillRect(0, groundY - 4, WIDTH, 4);

  for (const obstacle of obstacles) {
    drawObstacle(obstacle);
  }

  if (player.hurtTimer > 0) {
    ctx.save();
    ctx.globalAlpha = 0.4 + Math.sin(state.elapsed * 60) * 0.2;
    drawRunner(player.x, player.y);
    ctx.restore();
  } else {
    drawRunner(player.x, player.y);
  }

  // speed trails for depth perception
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
  ctx.lineWidth = 2;
  const trailCount = 6;
  for (let i = 0; i < trailCount; i += 1) {
    const offset = ((state.elapsed * (1.2 + i * 0.1)) % 1) * WIDTH;
    const y = groundY - 14 - i * 8;
    ctx.beginPath();
    ctx.moveTo(WIDTH - offset, y);
    ctx.lineTo(WIDTH - offset - 80, y + 6);
    ctx.stroke();
  }
}

let lastTime = 0;
function loop(now) {
  if (!state.running) {
    return;
  }
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  const clampedDt = clamp(dt, 0, 0.1);
  update(clampedDt);
  draw(clampedDt);
  rafHandle = requestAnimationFrame(loop);
}

async function init() {
  resizeCanvas();
  const [layerConfig, atlasConfig] = await Promise.all([
    fetch('/assets/city-runner/layers.json').then((res) => res.json()),
    fetch('/assets/city-runner/atlas.json').then((res) => res.json()),
  ]);

  parallax = await loadParallax(layerConfig);
  atlas = await loadAtlas(atlasConfig);

  setLod(state.lod);
  resetGame();
  state.running = true;
  lastTime = performance.now();
  rafHandle = requestAnimationFrame(loop);
}

init().catch((error) => {
  console.error('Failed to start city runner', error);
});

window.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (rafHandle) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  } else if (!rafHandle) {
    lastTime = performance.now();
    rafHandle = requestAnimationFrame(loop);
  }
});
