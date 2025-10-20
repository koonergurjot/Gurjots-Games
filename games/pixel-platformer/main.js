const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const TILE_SIZE = 16;
const GRAVITY = 0.35;
const JUMP_VELOCITY = -6.2;
const MOVE_SPEED = 1.6;
const MAX_FALL = 12;

let pixelScale = 1;
let viewWidth = canvas.width;
let viewHeight = canvas.height;

const input = {
  left: false,
  right: false,
  jump: false,
  jumpPressed: false
};

const camera = { x: 0, y: 0 };

const levelRows = [
  '................................................................................',
  '................................................................................',
  '................................................................................',
  '.........................====...................................................',
  '..............................................===...............................',
  '.........................................................==.....................',
  '..............................==................................................',
  '...............==...............................................................',
  '.....===......................................................===...............',
  '................................................................................',
  '===========================-----------------------------========================',
  '--------------------------------------------------------------------------------'
];

const worldWidth = levelRows[0].length * TILE_SIZE;
const worldHeight = levelRows.length * TILE_SIZE;

const player = {
  x: 96,
  y: 64,
  width: 12,
  height: 14,
  vx: 0,
  vy: 0,
  onGround: false,
  facing: 1,
  animation: 'player_idle',
  animTime: 0,
  frameIndex: 0,
  currentFrame: null
};

let atlas;
let parallax;
let lastTime = performance.now();

setupInput();
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

Promise.all([
  loadAtlas('/assets/pixel-platformer/atlas.json'),
  loadJSON('/assets/pixel-platformer/parallax.json')
]).then(([loadedAtlas, parallaxConfig]) => {
  atlas = loadedAtlas;
  parallax = parallaxConfig;
  requestAnimationFrame(loop);
}).catch((err) => {
  console.error('Failed to bootstrap pixel platformer:', err);
});

function loop(now) {
  const elapsed = Math.min(32, now - lastTime);
  lastTime = now;

  update(elapsed / 16.6667, elapsed);
  render();

  input.jumpPressed = false;
  requestAnimationFrame(loop);
}

function setupInput() {
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      input.left = true;
    }
    if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      input.right = true;
    }
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
      input.jump = true;
      input.jumpPressed = true;
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      input.left = false;
    }
    if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      input.right = false;
    }
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
      input.jump = false;
    }
  });
}

function update(dt, elapsedMs) {
  if (!atlas) return;

  const moveDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  player.vx = MOVE_SPEED * moveDir;
  if (moveDir !== 0) {
    player.facing = moveDir;
  }

  if (input.jumpPressed && player.onGround) {
    player.vy = JUMP_VELOCITY;
    player.onGround = false;
  }

  player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);

  moveHorizontally(player.vx * dt);
  moveVertically(player.vy * dt);

  updateAnimation(moveDir, elapsedMs);
  updateCamera();
}

function moveHorizontally(amount) {
  player.x += amount;
  const bounds = getPlayerBounds();

  if (amount > 0) {
    const rightTile = Math.floor((bounds.right) / TILE_SIZE);
    const topTile = Math.floor(bounds.top / TILE_SIZE);
    const bottomTile = Math.floor((bounds.bottom - 1) / TILE_SIZE);
    for (let ty = topTile; ty <= bottomTile; ty += 1) {
      if (isSolid(rightTile, ty)) {
        player.x = rightTile * TILE_SIZE - player.width;
        break;
      }
    }
  } else if (amount < 0) {
    const leftTile = Math.floor(bounds.left / TILE_SIZE);
    const topTile = Math.floor(bounds.top / TILE_SIZE);
    const bottomTile = Math.floor((bounds.bottom - 1) / TILE_SIZE);
    for (let ty = topTile; ty <= bottomTile; ty += 1) {
      if (isSolid(leftTile, ty)) {
        player.x = (leftTile + 1) * TILE_SIZE;
        break;
      }
    }
  }
}

function moveVertically(amount) {
  player.y += amount;
  const bounds = getPlayerBounds();
  player.onGround = false;

  if (amount > 0) {
    const bottomTile = Math.floor((bounds.bottom) / TILE_SIZE);
    const leftTile = Math.floor(bounds.left / TILE_SIZE);
    const rightTile = Math.floor((bounds.right - 1) / TILE_SIZE);
    for (let tx = leftTile; tx <= rightTile; tx += 1) {
      if (isSolid(tx, bottomTile)) {
        player.y = bottomTile * TILE_SIZE - player.height;
        player.vy = 0;
        player.onGround = true;
        return;
      }
    }
  } else if (amount < 0) {
    const topTile = Math.floor(bounds.top / TILE_SIZE);
    const leftTile = Math.floor(bounds.left / TILE_SIZE);
    const rightTile = Math.floor((bounds.right - 1) / TILE_SIZE);
    for (let tx = leftTile; tx <= rightTile; tx += 1) {
      if (isSolid(tx, topTile)) {
        player.y = (topTile + 1) * TILE_SIZE;
        player.vy = 0;
        return;
      }
    }
  }
}

function getPlayerBounds() {
  return {
    left: player.x,
    right: player.x + player.width,
    top: player.y,
    bottom: player.y + player.height
  };
}

function isSolid(tx, ty) {
  if (ty < 0) return false;
  if (ty >= levelRows.length) return true;
  const row = levelRows[ty];
  if (!row) return true;
  if (tx < 0) return true;
  if (tx >= row.length) return true;
  const cell = row.charAt(tx);
  return cell === '=' || cell === '-' || cell === '#';
}

function updateAnimation(moveDir, elapsedMs) {
  let nextAnim = 'player_idle';
  if (!player.onGround) {
    nextAnim = 'player_jump';
  } else if (Math.abs(moveDir) > 0) {
    nextAnim = 'player_run';
  }

  if (player.animation !== nextAnim) {
    player.animation = nextAnim;
    player.animTime = 0;
    player.frameIndex = 0;
  }

  const anim = atlas.animations[player.animation];
  const frameName = anim.frames[player.frameIndex];
  const frame = atlas.frames[frameName];
  player.animTime += elapsedMs;

  if (player.animTime >= frame.duration) {
    player.animTime = 0;
    if (player.frameIndex + 1 < anim.frames.length) {
      player.frameIndex += 1;
    } else if (anim.loop) {
      player.frameIndex = 0;
    }
  }

  player.currentFrame = frame;
}

function updateCamera() {
  const viewW = viewWidth;
  const viewH = viewHeight;
  const halfW = viewW / 2;
  const halfH = viewH / 2;
  let targetX = player.x + player.width / 2 - halfW;
  let targetY = player.y + player.height / 2 - halfH;

  const maxX = Math.max(0, worldWidth - viewW);
  const maxY = Math.max(0, worldHeight - viewH);
  targetX = Math.max(0, Math.min(maxX, targetX));
  targetY = Math.max(0, Math.min(maxY, targetY));

  if (worldWidth <= viewW) {
    targetX = Math.round((worldWidth - viewW) / 2);
  }
  if (worldHeight <= viewH) {
    targetY = Math.round((worldHeight - viewH) / 2);
  }

  camera.x = Math.round(targetX);
  camera.y = Math.round(targetY);
}

function render() {
  if (!atlas || !parallax) return;

  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, viewWidth, viewHeight);

  const sky = parallax.skyColor || '#04070f';
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, viewWidth, viewHeight);

  drawParallax();
  drawTiles();
  drawPlayer();
}

function drawParallax() {
  const layers = parallax.layers || [];
  for (const layer of layers) {
    const image = layer._image;
    if (!image) continue;
    const depth = layer.depth ?? 0;
    const repeatX = layer.repeatX !== false;
    const parallaxX = Math.round(camera.x * depth);
    const offsetX = ((parallaxX % image.width) + image.width) % image.width;
    const offsetY = Math.round(camera.y * depth);
    const baseY = Math.round(layer.offsetY || 0);

    let startX = -offsetX;
    if (startX > 0 && repeatX) {
      startX -= image.width;
    }

    for (let x = startX; x < viewWidth; x += image.width) {
      const drawX = repeatX ? Math.round(x) : Math.round(-offsetX);
      const drawY = Math.round(baseY - offsetY);
      ctx.drawImage(image, drawX, drawY);
      if (!repeatX) {
        break;
      }
    }
  }
}

function drawTiles() {
  for (let ty = 0; ty < levelRows.length; ty += 1) {
    const row = levelRows[ty];
    for (let tx = 0; tx < row.length; tx += 1) {
      const cell = row.charAt(tx);
      if (cell === '.' ) continue;
      let frameName = 'tile_grass_fill';
      if (cell === '=') frameName = 'tile_grass_top';
      if (cell === '-') frameName = 'tile_grass_fill';
      if (cell === '#') frameName = 'tile_grass_corner';
      const frame = atlas.frames[frameName];
      if (!frame) continue;

      const worldX = tx * TILE_SIZE;
      const worldY = ty * TILE_SIZE;
      const screenX = Math.round(worldX - camera.x);
      const screenY = Math.round(worldY - camera.y);

      if (screenX + frame.w < 0 || screenX > viewWidth || screenY + frame.h < 0 || screenY > viewHeight) {
        continue;
      }

      ctx.drawImage(frame._image, frame.x, frame.y, frame.w, frame.h, screenX, screenY, frame.w, frame.h);
    }
  }
}

function drawPlayer() {
  const frame = player.currentFrame;
  if (!frame) return;
  const drawX = Math.round(player.x - camera.x);
  const drawY = Math.round(player.y - camera.y);
  ctx.save();
  ctx.translate(drawX + frame.w / 2, drawY);
  ctx.scale(player.facing < 0 ? -1 : 1, 1);
  ctx.drawImage(frame._image, frame.x, frame.y, frame.w, frame.h, -frame.w / 2, 0, frame.w, frame.h);
  ctx.restore();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  pixelScale = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const newWidth = Math.max(1, Math.round(rect.width));
  const newHeight = Math.max(1, Math.round(rect.height));
  canvas.width = newWidth * pixelScale;
  canvas.height = newHeight * pixelScale;
  viewWidth = newWidth;
  viewHeight = newHeight;
  ctx.imageSmoothingEnabled = false;
}

async function loadAtlas(url) {
  const data = await loadJSON(url);
  const imageCache = new Map();
  const frames = {};
  const frameEntries = Object.entries(data.frames || {});

  for (const [name, frame] of frameEntries) {
    const image = await loadImageCached(frame.image, imageCache);
    frames[name] = {
      ...frame,
      _image: image
    };
  }

  return {
    meta: data.meta || {},
    frames,
    animations: data.animations || {}
  };
}

async function loadJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  const json = await response.json();
  if (json.layers) {
    await Promise.all(json.layers.map((layer) => loadImageForLayer(layer)));
  }
  return json;
}

async function loadImageForLayer(layer) {
  if (!layer || !layer.image) return;
  layer._image = await loadImage(layer.image);
}

async function loadImageCached(src, cache) {
  if (cache.has(src)) {
    return cache.get(src);
  }
  const image = await loadImage(src);
  cache.set(src, image);
  return image;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image ${src}`));
  });
}
