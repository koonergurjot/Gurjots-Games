// Minimal top-down shooter (canvas id='game')
import { pushEvent } from '/games/common/diag-adapter.js';
import { getCachedAudio, getCachedImage, loadAudio, loadImage, loadStrip } from '../../shared/assets.js';
import './diagnostics-adapter.js';

export function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) return console.error('[shooter] missing #game canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.width || 960;
  canvas.height = canvas.height || 540;
  const W = canvas.width, H = canvas.height;
  if (ctx && 'imageSmoothingEnabled' in ctx) {
    ctx.imageSmoothingEnabled = false;
  }
  let postedReady = false;

  const COLLISION_LAYERS = {
    PLAYER: 1 << 0,
    PLAYER_PROJECTILE: 1 << 1,
    ENEMY: 1 << 2,
    ENEMY_PROJECTILE: 1 << 3,
    LOOT: 1 << 4,
  };

  const DATA_PATH = './data/game-data.json';

  const defaultGameData = {
    armorTypes: {
      light: { kinetic: 1, energy: 1.1 },
      heavy: { kinetic: 0.75, energy: 1.25 },
      shielded: { kinetic: 0.6, energy: 1.4 },
    },
    lootTable: [
      { id: 'heal-small', chance: 0.2, effect: { type: 'heal', amount: 1 } },
      { id: 'weapon-upgrade', chance: 0.1, effect: { type: 'weapon', weapon: 'arc' } },
    ],
    weapons: {
      blaster: {
        fireCooldown: 0.22,
        damage: 2,
        damageType: 'kinetic',
        critChance: 0.1,
        critMultiplier: 1.8,
        iFrames: 0.1,
        projectile: {
          type: 'projectile',
          speed: 600,
          radius: 4,
          lifetime: 1.4,
          collisionMask: COLLISION_LAYERS.ENEMY,
        },
        patterns: [
          { count: 1, spread: 0 },
        ],
      },
      arc: {
        fireCooldown: 0.5,
        damage: 4,
        damageType: 'energy',
        critChance: 0.18,
        critMultiplier: 2,
        iFrames: 0.15,
        projectile: {
          type: 'ray',
          width: 48,
          range: W * 0.9,
          collisionMask: COLLISION_LAYERS.ENEMY,
        },
        patterns: [
          { count: 1, spread: 12 },
        ],
      },
      spread: {
        fireCooldown: 0.4,
        damage: 1.5,
        damageType: 'kinetic',
        critChance: 0.08,
        critMultiplier: 1.6,
        iFrames: 0.05,
        projectile: {
          type: 'projectile',
          speed: 520,
          radius: 4,
          lifetime: 1.1,
          collisionMask: COLLISION_LAYERS.ENEMY,
        },
        patterns: [
          { count: 3, spread: 24 },
        ],
      },
      bossBeam: {
        fireCooldown: 3,
        damage: 2,
        damageType: 'energy',
        critChance: 0,
        critMultiplier: 1,
        projectile: {
          type: 'ray',
          width: 64,
          range: W,
          collisionMask: COLLISION_LAYERS.PLAYER,
        },
        patterns: [
          { count: 1, spread: 0 },
        ],
      },
      bossSpray: {
        fireCooldown: 0.65,
        damage: 1,
        damageType: 'kinetic',
        critChance: 0,
        critMultiplier: 1,
        projectile: {
          type: 'projectile',
          speed: 360,
          radius: 6,
          lifetime: 3,
          collisionMask: COLLISION_LAYERS.PLAYER,
        },
        patterns: [
          { count: 6, spread: 60 },
        ],
      },
    },
    enemyTypes: {
      grunt: {
        hp: 6,
        armorType: 'light',
        speed: 150,
        radius: 14,
        spriteIndex: 0,
        contactDamage: 1,
        lootTableId: null,
        collisionMask: COLLISION_LAYERS.PLAYER | COLLISION_LAYERS.PLAYER_PROJECTILE,
      },
      bruiser: {
        hp: 12,
        armorType: 'heavy',
        speed: 90,
        radius: 18,
        spriteIndex: 1,
        contactDamage: 2,
        lootTableId: null,
        collisionMask: COLLISION_LAYERS.PLAYER | COLLISION_LAYERS.PLAYER_PROJECTILE,
      },
      overseer: {
        hp: 120,
        armorType: 'shielded',
        speed: 50,
        radius: 38,
        spriteIndex: 1,
        boss: true,
        contactDamage: 3,
        timeline: [
          { duration: 8, pattern: 'portalVolley', weapon: 'bossSpray', speedMultiplier: 1 },
          { duration: 6, pattern: 'beamSweep', weapon: 'bossBeam', speedMultiplier: 0.5 },
          { duration: 10, pattern: 'rage', weapon: 'bossSpray', speedMultiplier: 1.5 },
        ],
        lootTableId: 'boss',
        collisionMask: COLLISION_LAYERS.PLAYER | COLLISION_LAYERS.PLAYER_PROJECTILE,
      },
    },
    lootTables: {
      boss: [
        { id: 'heal-large', chance: 0.8, effect: { type: 'heal', amount: 3 } },
        { id: 'unlock-arc', chance: 0.5, effect: { type: 'weapon', weapon: 'arc' } },
      ],
    },
    waves: [
      {
        time: 0,
        spawns: [
          { type: 'grunt', count: 6, interval: 0.4, pattern: 'line', offsetY: 0.2 },
        ],
      },
      {
        time: 12,
        spawns: [
          { type: 'grunt', count: 5, interval: 0.3, pattern: 'wave', offsetY: 0.6 },
          { type: 'bruiser', count: 2, interval: 1.5, pattern: 'line', offsetY: 0.4 },
        ],
      },
      {
        time: 40,
        boss: { type: 'overseer' },
      },
    ],
  };

  let gameData = JSON.parse(JSON.stringify(defaultGameData));

  const player = {
    x: W*0.2,
    y: H*0.5,
    r: 12,
    vx: 0,
    vy: 0,
    speed: 300,
    hp: 6,
    maxHp: 6,
    weaponTimer: 0,
    invuln: 0,
    weaponId: 'blaster',
    layer: COLLISION_LAYERS.PLAYER,
    mask: COLLISION_LAYERS.ENEMY | COLLISION_LAYERS.ENEMY_PROJECTILE | COLLISION_LAYERS.LOOT,
  };
  const projectiles = [];
  const projectilePool = [];
  const enemies = [];
  const portalEffects = [];
  const explosions = [];
  const damageNumbers = [];
  const chromaticBursts = [];
  const lootDrops = [];
  const activeWaves = [];
  const rayEffects = [];

  let elapsedTime = 0;
  let nextWaveIndex = 0;
  let dataLoaded = true;
  let dataLoadError = null;
  let bossActive = null;

  const screenShake = {
    intensity: 0,
    duration: 0,
    decay: 1.8,
  };
  let score = 0;
  let shooterAPI = null;
  let currentState = 'ready';
  let lastPostedScore = null;
  let lastPostedHp = null;
  let lastPostedState = null;
  const scoreElement = document.getElementById('score');
  const scoreDisplay = document.getElementById('scoreDisplay');

  const SLUG = 'shooter';
  const ASSET_PATHS = {
    bullet: '../../assets/sprites/bullet.png',
    enemies: [
      '../../assets/sprites/enemy1.png',
      '../../assets/sprites/enemy2.png',
    ],
    explosion: '../../assets/effects/explosion.png',
    portal: '../../assets/effects/portal.png',
    shoot: '../../assets/audio/laser.wav',
    gameover: '../../assets/audio/gameover.wav',
  };

  const sprites = {
    bullet: getCachedImage(ASSET_PATHS.bullet),
    enemies: ASSET_PATHS.enemies.map(path => getCachedImage(path)),
    explosion: getCachedImage(ASSET_PATHS.explosion),
    portal: getCachedImage(ASSET_PATHS.portal),
  };

  const PARALLAX_LAYERS = [
    { key: 'layer1', src: '/assets/backgrounds/parallax/space_layer1.png', speed: 40, alpha: 0.85 },
    { key: 'layer2', src: '/assets/backgrounds/parallax/space_layer2.png', speed: 80, alpha: 1 },
  ];
  const parallaxLayers = PARALLAX_LAYERS.map(config => ({
    key: config.key,
    src: config.src,
    speed: Number.isFinite(config.speed) ? config.speed : 0,
    alpha: typeof config.alpha === 'number' ? Math.max(0, Math.min(1, config.alpha)) : 1,
    offset: 0,
    image: getCachedImage(config.src) || null,
    width: 0,
    height: 0,
  }));
  const parallaxRequests = new Set();
  let lastParallaxTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const explosionSprite = {
    frameSize: 0,
    framesPerRow: 8,
    totalFrames: 0,
  };

  const portalSprite = {
    frameWidth: 0,
    frameHeight: 0,
    totalFrames: 4,
  };

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeGameData(base, patch) {
    if (!patch || typeof patch !== 'object') return base;
    const output = Array.isArray(base) ? [...base] : { ...base };
    for (const key of Object.keys(patch)) {
      const baseValue = base ? base[key] : undefined;
      const patchValue = patch[key];
      if (Array.isArray(baseValue) && Array.isArray(patchValue)) {
        output[key] = patchValue.slice();
      } else if (typeof baseValue === 'object' && baseValue && typeof patchValue === 'object' && patchValue) {
        output[key] = mergeGameData(baseValue, patchValue);
      } else {
        output[key] = deepClone(patchValue);
      }
    }
    return output;
  }

  function loadGameData() {
    if (typeof fetch !== 'function') {
      dataLoaded = true;
      return Promise.resolve(gameData);
    }
    return fetch(DATA_PATH, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`Failed to load ${DATA_PATH}: ${response.status}`);
        return response.json();
      })
      .then(json => {
        if (json && typeof json === 'object') {
          gameData = mergeGameData(defaultGameData, json);
        }
        dataLoaded = true;
        return gameData;
      })
      .catch(error => {
        console.warn('[shooter] failed to load game data', error);
        dataLoaded = true;
        dataLoadError = error;
        return gameData;
      });
  }

  function isImageReady(image) {
    return !!image && (image.complete === undefined || image.complete) && (image.naturalWidth || image.width);
  }

  function ensureParallaxLayers() {
    for (const layer of parallaxLayers) {
      if (layer.image && isImageReady(layer.image)) continue;
      const requestKey = layer.src;
      if (parallaxRequests.has(requestKey)) continue;
      parallaxRequests.add(requestKey);
      loadImage(layer.src, { slug: SLUG }).then(img => {
        layer.image = img;
        layer.width = img.naturalWidth || img.width || layer.width || 0;
        layer.height = img.naturalHeight || img.height || layer.height || 0;
      }).catch(() => {}).finally(() => {
        parallaxRequests.delete(requestKey);
      });
    }
  }

  function getParallaxMetrics(layer) {
    if (!layer) return null;
    const img = layer.image;
    const baseW = img?.naturalWidth || img?.width || layer.width || 0;
    const baseH = img?.naturalHeight || img?.height || layer.height || 0;
    if (!baseW || !baseH) return null;
    const destHeight = H;
    const destWidth = destHeight * (baseW / baseH);
    if (!Number.isFinite(destWidth) || destWidth <= 0) return null;
    layer.width = baseW;
    layer.height = baseH;
    layer.renderWidth = destWidth;
    layer.renderHeight = destHeight;
    return { width: destWidth, height: destHeight };
  }

  function updateParallax(delta) {
    ensureParallaxLayers();
    if (!Number.isFinite(delta)) delta = 0;
    for (const layer of parallaxLayers) {
      const metrics = getParallaxMetrics(layer);
      if (!metrics) continue;
      const speed = Number.isFinite(layer.speed) ? layer.speed : 0;
      if (!speed) continue;
      let offset = (layer.offset || 0) + speed * delta;
      const span = metrics.width;
      if (span > 0) {
        offset %= span;
        if (offset < 0) offset += span;
      }
      layer.offset = offset;
    }
  }

  function drawParallaxBackground() {
    if (!ctx) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a101f';
    ctx.fillRect(0, 0, W, H);
    ensureParallaxLayers();
    for (const layer of parallaxLayers) {
      const metrics = getParallaxMetrics(layer);
      if (!metrics || !isImageReady(layer.image)) continue;
      let startX = -(layer.offset || 0);
      while (startX > 0) startX -= metrics.width;
      ctx.save();
      ctx.globalAlpha = layer.alpha ?? 1;
      for (let x = startX; x < W; x += metrics.width) {
        ctx.drawImage(layer.image, x, 0, metrics.width, metrics.height);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function resetParallax() {
    for (const layer of parallaxLayers) {
      if (layer) layer.offset = 0;
    }
    lastParallaxTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function prepareExplosionSprite() {
    const image = sprites.explosion;
    if (!isImageReady(image)) return;
    const framesPerRow = Math.max(1, explosionSprite.framesPerRow || 8);
    loadStrip(ASSET_PATHS.explosion, explosionSprite.frameSize, explosionSprite.frameSize, {
      slug: SLUG,
      image,
      framesPerRow,
    }).then(strip => {
      sprites.explosion = strip.image;
      explosionSprite.frameSize = strip.frameWidth;
      explosionSprite.framesPerRow = strip.framesPerRow;
      explosionSprite.totalFrames = Math.max(1, strip.frameCount);
    }).catch(() => {});
  }

  function preparePortalSprite() {
    const image = sprites.portal;
    if (!isImageReady(image)) return;
    const totalFrames = Math.max(1, portalSprite.totalFrames || 1);
    loadStrip(ASSET_PATHS.portal, portalSprite.frameWidth, portalSprite.frameHeight, {
      slug: SLUG,
      image,
      framesPerRow: totalFrames,
      totalFrames,
    }).then(strip => {
      sprites.portal = strip.image;
      portalSprite.frameWidth = strip.frameWidth;
      portalSprite.frameHeight = strip.frameHeight;
      portalSprite.totalFrames = Math.max(1, strip.frameCount);
    }).catch(() => {});
  }

  function getWeapon(id) {
    const weapons = gameData?.weapons || {};
    const fallback = defaultGameData.weapons[id];
    const result = weapons && weapons[id];
    return result ? result : fallback || defaultGameData.weapons.blaster;
  }

  function getEnemyType(id) {
    const enemies = gameData?.enemyTypes || {};
    return enemies[id] || defaultGameData.enemyTypes[id] || defaultGameData.enemyTypes.grunt;
  }

  function getArmorMultiplier(armorType, damageType) {
    const armorTable = gameData?.armorTypes || {};
    const armorEntry = armorTable[armorType] || defaultGameData.armorTypes[armorType] || {};
    const multiplier = armorEntry[damageType];
    if (typeof multiplier === 'number') return multiplier;
    return 1;
  }

  function getLootTable(id) {
    if (!id) return gameData.lootTable || defaultGameData.lootTable || [];
    const tables = gameData?.lootTables || {};
    return tables[id] || defaultGameData.lootTables?.[id] || [];
  }

  function acquireProjectile() {
    return projectilePool.pop() || {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: 4,
      lifetime: 1,
      elapsed: 0,
      damage: 1,
      damageType: 'kinetic',
      critChance: 0,
      critMultiplier: 1,
      from: 'player',
      layer: COLLISION_LAYERS.PLAYER_PROJECTILE,
      mask: COLLISION_LAYERS.ENEMY,
      iFrames: 0,
    };
  }

  function releaseProjectile(projectile) {
    if (!projectile) return;
    projectile.active = false;
    projectile.elapsed = 0;
    projectilePool.push(projectile);
  }

  function createSoundPlayer(src, volume = 0.6) {
    let base = getCachedAudio(src);
    if (!base) {
      loadAudio(src, { slug: SLUG }).then(audio => { base = audio; }).catch(() => {});
    }
    return () => {
      const audio = base || getCachedAudio(src);
      if (!audio) return;
      try {
        const instance = audio.cloneNode(true);
        instance.volume = volume;
        instance.play().catch(() => {});
      } catch (_) {}
    };
  }

  const playShootSound = createSoundPlayer(ASSET_PATHS.shoot, 0.5);
  const playGameOverSound = createSoundPlayer(ASSET_PATHS.gameover, 0.6);

  ensureParallaxLayers();

  loadImage(ASSET_PATHS.bullet, { slug: SLUG }).then(img => {
    sprites.bullet = img;
  }).catch(() => {});

  ASSET_PATHS.enemies.forEach((path, index) => {
    loadImage(path, { slug: SLUG }).then(img => {
      sprites.enemies[index] = img;
    }).catch(() => {});
  });

  if (sprites.explosion) prepareExplosionSprite();
  loadImage(ASSET_PATHS.explosion, { slug: SLUG }).then(img => {
    sprites.explosion = img;
    prepareExplosionSprite();
  }).catch(() => {});

  if (sprites.portal) preparePortalSprite();
  loadImage(ASSET_PATHS.portal, { slug: SLUG }).then(img => {
    sprites.portal = img;
    preparePortalSprite();
  }).catch(() => {});

  const keys = new Set();
  addEventListener('keydown', e => keys.add(e.key));
  addEventListener('keyup', e => keys.delete(e.key));

  function spawnExplosion(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    explosions.push({ x, y, frameIndex: 0, frameDelay: 0 });
  }

  function spawnDamageNumber(x, y, amount, { crit = false, color } = {}) {
    if (!Number.isFinite(amount)) return;
    damageNumbers.push({
      x,
      y,
      value: amount,
      life: 0,
      duration: 0.9,
      crit,
      color: color || (crit ? '#facc15' : '#f8fafc'),
    });
  }

  function updateDamageNumbers(delta) {
    for (let i = damageNumbers.length - 1; i >= 0; i--) {
      const number = damageNumbers[i];
      number.life += delta;
      number.y -= delta * 35;
      if (number.life >= number.duration) {
        damageNumbers.splice(i, 1);
      }
    }
  }

  function drawDamageNumbers() {
    if (!damageNumbers.length) return;
    ctx.save();
    ctx.font = 'bold 16px system-ui';
    ctx.textAlign = 'center';
    for (const number of damageNumbers) {
      const alpha = Math.max(0, 1 - number.life / number.duration);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = number.color;
      ctx.fillText(`${Math.round(number.value)}`, number.x, number.y);
      if (number.crit) {
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 2;
        ctx.strokeText(`${Math.round(number.value)}`, number.x, number.y);
      }
    }
    ctx.restore();
  }

  function spawnLootText(x, y, text, color = '#a5b4fc') {
    if (!text) return;
    lootDrops.push({ x, y, text, life: 0, duration: 1.4, color });
  }

  function updateLootTexts(delta) {
    for (let i = lootDrops.length - 1; i >= 0; i--) {
      const loot = lootDrops[i];
      loot.life += delta;
      loot.y -= delta * 18;
      if (loot.life >= loot.duration) {
        lootDrops.splice(i, 1);
      }
    }
  }

  function drawLootTexts() {
    if (!lootDrops.length) return;
    ctx.save();
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    for (const loot of lootDrops) {
      const alpha = Math.max(0, 1 - loot.life / loot.duration);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = loot.color || '#a5b4fc';
      ctx.fillText(loot.text, loot.x, loot.y);
    }
    ctx.restore();
  }

  function spawnRayEffect({ x, y, angle, range, width, color }) {
    rayEffects.push({ x, y, angle, range, width, color, life: 0, duration: 0.15 });
  }

  function updateRayEffects(delta) {
    for (let i = rayEffects.length - 1; i >= 0; i--) {
      const effect = rayEffects[i];
      effect.life += delta;
      if (effect.life >= effect.duration) {
        rayEffects.splice(i, 1);
      }
    }
  }

  function drawRayEffects() {
    if (!rayEffects.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const effect of rayEffects) {
      const alpha = Math.max(0, 1 - effect.life / effect.duration);
      const width = effect.width || 24;
      const range = effect.range || W;
      const dx = Math.cos(effect.angle || 0);
      const dy = Math.sin(effect.angle || 0);
      const ex = effect.x + dx * range;
      const ey = effect.y + dy * range;
      const gradient = ctx.createLinearGradient(effect.x, effect.y, ex, ey);
      const color = effect.color || '#93c5fd';
      gradient.addColorStop(0, `${color}33`);
      gradient.addColorStop(0.5, `${color}dd`);
      gradient.addColorStop(1, `${color}33`);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = gradient;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(effect.x, effect.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.restore();
  }

  function updateExplosions() {
    if (!explosions.length) return;
    const totalFrames = Math.max(1, explosionSprite.totalFrames || 1);
    for (let i = explosions.length - 1; i >= 0; i--) {
      const explosion = explosions[i];
      explosion.frameDelay = (explosion.frameDelay || 0) + 1;
      if (explosion.frameDelay >= 3) {
        explosion.frameDelay = 0;
        explosion.frameIndex = (explosion.frameIndex || 0) + 1;
        if (explosion.frameIndex >= totalFrames) {
          explosions.splice(i, 1);
          continue;
        }
      }
    }
  }

  function applyLootEffect(effect) {
    if (!effect || typeof effect !== 'object') return null;
    if (effect.type === 'heal') {
      const amount = Number(effect.amount) || 0;
      if (amount <= 0) return null;
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + amount);
      const gained = Math.round(player.hp - before);
      if (gained > 0) {
        spawnDamageNumber(player.x, player.y - 20, gained, { color: '#4ade80' });
        return `Recovered ${gained} HP`;
      }
      return null;
    }
    if (effect.type === 'weapon') {
      const weapon = effect.weapon;
      if (weapon && getWeapon(weapon)) {
        player.weaponId = weapon;
        player.weaponTimer = 0;
        return `Equipped ${weapon}`;
      }
      return null;
    }
    return null;
  }

  function rollLootDrops(enemy) {
    if (!enemy) return;
    const type = enemy.typeDef || getEnemyType(enemy.typeId);
    const table = getLootTable(type.lootTableId);
    for (const entry of table) {
      const chance = Number(entry.chance);
      if (!Number.isFinite(chance)) continue;
      if (Math.random() <= Math.max(0, Math.min(1, chance))) {
        const effect = applyLootEffect(entry.effect);
        if (effect) {
          spawnLootText(enemy.x, enemy.y, effect);
        }
      }
    }
  }

  function handleEnemyDeath(enemy) {
    if (!enemy || enemy.dead) return;
    enemy.dead = true;
    spawnExplosion(enemy.x, enemy.y);
    rollLootDrops(enemy);
    const type = enemy.typeDef || getEnemyType(enemy.typeId);
    const value = type?.boss ? 150 : Math.max(10, Math.round((type?.hp || 5) * 2));
    score += value;
    if (type?.boss) {
      bossActive = null;
    }
  }

  function resolveDamage(target, amount, damageType, source, { critChance = 0, critMultiplier = 1.5, iFrames = 0, hitX, hitY } = {}) {
    if (!target || amount <= 0) return 0;
    if ((target.invuln || 0) > 0) return 0;
    const armorType = target.armorType || target.typeDef?.armorType || (target === player ? 'light' : 'light');
    const multiplier = getArmorMultiplier(armorType, damageType);
    let damage = amount * multiplier;
    const crit = critChance > 0 && Math.random() < critChance;
    if (crit) damage *= critMultiplier || 2;
    damage = Math.max(0, damage);
    if (target === player) {
      player.hp = Math.max(0, player.hp - damage);
      player.invuln = Math.max(player.invuln, iFrames || 0.6);
      if (damage > 0) {
        spawnDamageNumber(hitX ?? player.x, hitY ?? player.y, damage, { crit, color: '#f87171' });
      }
    } else {
      target.hp -= damage;
      target.invuln = Math.max(target.invuln || 0, iFrames || 0);
      if (damage > 0) {
        spawnDamageNumber(hitX ?? target.x, hitY ?? target.y, damage, { crit });
      }
      if (target.typeDef?.boss) {
        triggerScreenShake(12 + damage * 0.2, 0.55);
        spawnChromaticBurst(hitX ?? target.x, hitY ?? target.y, 1 + damage / 50);
      }
      if (target.hp <= 0) {
        resolveEnemyRemoval(target);
      }
    }
    return damage;
  }

  function resolveEnemyRemoval(enemy) {
    handleEnemyDeath(enemy);
  }

  function performRaycast(origin, angle, range, width, mask, source, weaponDef) {
    const hits = [];
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const maxRange = Number.isFinite(range) ? Math.max(0, range) : W;
    const halfWidth = Math.max(1, width || 16) * 0.5;
    const considerEnemies = (mask & COLLISION_LAYERS.ENEMY) !== 0;
    const considerPlayer = (mask & COLLISION_LAYERS.PLAYER) !== 0;
    if (considerEnemies) {
      for (const enemy of enemies) {
        if (!enemy.active || enemy.dead) continue;
        const offsetX = enemy.x - origin.x;
        const offsetY = enemy.y - origin.y;
        const proj = offsetX * dx + offsetY * dy;
        if (proj < 0 || proj > maxRange) continue;
        const perp = Math.abs(offsetX * dy - offsetY * dx);
        if (perp > (enemy.r || 16) + halfWidth) continue;
        hits.push({ target: enemy, distance: proj, hitX: origin.x + dx * proj, hitY: origin.y + dy * proj });
      }
    }
    if (considerPlayer) {
      const offsetX = player.x - origin.x;
      const offsetY = player.y - origin.y;
      const proj = offsetX * dx + offsetY * dy;
      if (proj >= 0 && proj <= maxRange) {
        const perp = Math.abs(offsetX * dy - offsetY * dx);
        if (perp <= player.r + halfWidth) {
          hits.push({ target: player, distance: proj, hitX: origin.x + dx * proj, hitY: origin.y + dy * proj });
        }
      }
    }
    hits.sort((a, b) => a.distance - b.distance);
    let anyHit = false;
    for (const hit of hits) {
      const target = hit.target;
      if (target === player && player.hp <= 0) continue;
      const options = {
        critChance: weaponDef?.critChance || 0,
        critMultiplier: weaponDef?.critMultiplier || 1.5,
        iFrames: weaponDef?.iFrames || 0,
        hitX: hit.hitX,
        hitY: hit.hitY,
      };
      const dealt = resolveDamage(target, weaponDef?.damage || 1, weaponDef?.damageType || 'kinetic', source, options);
      if (dealt > 0) anyHit = true;
    }
    return anyHit;
  }

  function fireWeapon(actor, weaponDef, source, { angle, spreadScale = 1 } = {}) {
    if (!weaponDef) return false;
    const projectileDef = weaponDef.projectile || {};
    const baseAngle = typeof angle === 'number'
      ? angle
      : (source === 'enemy' ? Math.atan2(player.y - actor.y, player.x - actor.x) : 0);
    let fired = false;
    const deg2rad = Math.PI / 180;
    for (const pattern of weaponDef.patterns || [{ count: 1, spread: 0 }]) {
      const count = Math.max(1, Math.floor(pattern.count || 1));
      const spread = Number(pattern.spread || 0) * spreadScale;
      for (let i = 0; i < count; i++) {
        const offset = count > 1 ? (i / (count - 1) - 0.5) : 0;
        const shotAngle = baseAngle + offset * spread * deg2rad;
        if (projectileDef.type === 'ray') {
          const origin = { x: actor.x, y: actor.y };
          const hit = performRaycast(origin, shotAngle, projectileDef.range || W, projectileDef.width || 32, projectileDef.collisionMask || (source === 'enemy' ? COLLISION_LAYERS.PLAYER : COLLISION_LAYERS.ENEMY), source, weaponDef);
          spawnRayEffect({
            x: actor.x,
            y: actor.y,
            angle: shotAngle,
            range: projectileDef.range || W,
            width: projectileDef.width || 28,
            color: source === 'enemy' ? '#f472b6' : '#60a5fa',
          });
          if (hit) {
            spawnChromaticBurst(actor.x + Math.cos(shotAngle) * 40, actor.y + Math.sin(shotAngle) * 40, 0.6);
          }
          fired = true;
        } else {
          const projectile = acquireProjectile();
          projectile.active = true;
          projectile.from = source;
          projectile.elapsed = 0;
          projectile.x = actor.x + Math.cos(shotAngle) * (actor.r + projectileDef.radius || 6);
          projectile.y = actor.y + Math.sin(shotAngle) * (actor.r + projectileDef.radius || 6);
          projectile.vx = Math.cos(shotAngle) * (projectileDef.speed || 400);
          projectile.vy = Math.sin(shotAngle) * (projectileDef.speed || 0);
          projectile.r = projectileDef.radius || 4;
          projectile.lifetime = projectileDef.lifetime || 1.2;
          projectile.damage = weaponDef.damage || 1;
          projectile.damageType = weaponDef.damageType || 'kinetic';
          projectile.critChance = weaponDef.critChance || 0;
          projectile.critMultiplier = weaponDef.critMultiplier || 1.5;
          projectile.iFrames = weaponDef.iFrames || 0;
          projectile.mask = projectileDef.collisionMask || (source === 'enemy' ? COLLISION_LAYERS.PLAYER : COLLISION_LAYERS.ENEMY);
          projectile.layer = source === 'enemy' ? COLLISION_LAYERS.ENEMY_PROJECTILE : COLLISION_LAYERS.PLAYER_PROJECTILE;
          projectile.owner = actor;
          projectiles.push(projectile);
          fired = true;
        }
      }
    }
    return fired;
  }

  function spawnEnemy(typeId, overrides = {}) {
    const type = getEnemyType(typeId);
    const enemy = {
      typeId,
      typeDef: type,
      x: overrides.x ?? (W + 40),
      y: overrides.y ?? (40 + Math.random() * (H - 80)),
      vx: overrides.vx ?? -(type.speed || 100),
      vy: overrides.vy ?? 0,
      speed: type.speed || 100,
      r: overrides.r ?? (type.radius || 18),
      hp: type.hp || 6,
      armorType: type.armorType || 'light',
      active: false,
      invuln: 0,
      spriteIndex: type.spriteIndex ?? 0,
      layer: COLLISION_LAYERS.ENEMY,
      mask: type.collisionMask || (COLLISION_LAYERS.PLAYER | COLLISION_LAYERS.PLAYER_PROJECTILE),
      path: overrides.path || 'line',
      pathPhase: overrides.pathPhase || 0,
      weaponTimer: 0,
      timeline: deepClone(type.timeline || []),
      phaseIndex: 0,
      phaseTimer: 0,
      aimAngle: 0,
      sweepAngle: -0.2,
      sweepDirection: 1,
    };
    enemy.y = Math.max(enemy.r, Math.min(H - enemy.r, enemy.y));
    enemies.push(enemy);
    portalEffects.push({ x: enemy.x, y: enemy.y, frameIndex: 0, frameDelay: 0, enemy });
    if (type.boss) {
      bossActive = enemy;
    }
    return enemy;
  }

  function updateBoss(enemy, delta) {
    const timeline = enemy.timeline || [];
    if (!timeline.length) return;
    enemy.phaseTimer = (enemy.phaseTimer || 0) + delta;
    let phase = timeline[enemy.phaseIndex] || timeline[0];
    if (enemy.phaseTimer >= (phase?.duration || 6)) {
      enemy.phaseIndex = (enemy.phaseIndex + 1) % timeline.length;
      enemy.phaseTimer = 0;
      phase = timeline[enemy.phaseIndex];
    }
    const speedMultiplier = phase?.speedMultiplier || 1;
    const desiredY = phase?.pattern === 'rage'
      ? player.y
      : (H * 0.5 + Math.sin(elapsedTime * 0.6) * 90);
    const directionY = Math.sign(desiredY - enemy.y);
    enemy.y += directionY * enemy.speed * speedMultiplier * delta * 0.6;
    enemy.y = Math.max(enemy.r, Math.min(H - enemy.r, enemy.y));
    if (phase?.pattern === 'beamSweep') {
      enemy.sweepAngle = (enemy.sweepAngle ?? -0.3) + (enemy.sweepDirection ?? 1) * delta * 0.6;
      if (enemy.sweepAngle > 0.45) enemy.sweepDirection = -1;
      if (enemy.sweepAngle < -0.45) enemy.sweepDirection = 1;
    }
    enemy.weaponTimer = Math.max(0, (enemy.weaponTimer || 0) - delta);
    const weapon = getWeapon(phase?.weapon);
    if (enemy.weaponTimer <= 0 && weapon) {
      let angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
      if (phase?.pattern === 'beamSweep') angle = enemy.sweepAngle ?? angle;
      if (phase?.pattern === 'portalVolley') angle += (Math.random() - 0.5) * 0.18;
      if (phase?.pattern === 'rage') angle += (Math.random() - 0.5) * 0.3;
      if (fireWeapon(enemy, weapon, 'enemy', { angle })) {
        enemy.weaponTimer = weapon.fireCooldown || 1.2;
      }
    }
  }

  function updateEnemy(enemy, delta) {
    if (enemy.dead) return;
    enemy.invuln = Math.max(0, (enemy.invuln || 0) - delta);
    if (!enemy.active) return;
    if (enemy.typeDef?.boss) {
      updateBoss(enemy, delta);
      return;
    }
    enemy.pathPhase = (enemy.pathPhase || 0) + delta;
    const movementSpeed = enemy.speed || Math.abs(enemy.vx) || 120;
    enemy.x += (enemy.vx || -movementSpeed) * delta;
    if (enemy.path === 'wave') {
      enemy.y += Math.sin(enemy.pathPhase * 3) * 90 * delta;
    } else {
      enemy.y += (enemy.vy || 0) * delta;
    }
    enemy.y = Math.max(enemy.r, Math.min(H - enemy.r, enemy.y));
    if (enemy.x < -enemy.r - 80) {
      enemy.dead = true;
    }
  }

  function updateEnemies(delta) {
    for (const enemy of enemies) {
      updateEnemy(enemy, delta);
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      if (enemy.dead) {
        enemies.splice(i, 1);
      }
    }
  }

  function handleEnemyPlayerCollisions() {
    if (player.hp <= 0) return;
    for (const enemy of enemies) {
      if (!enemy.active || enemy.dead) continue;
      const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
      if (distance <= (enemy.r || 16) + player.r) {
        if ((player.invuln || 0) > 0) continue;
        const damage = enemy.typeDef?.contactDamage ?? 1;
        resolveDamage(player, damage, 'kinetic', 'enemy', {
          critChance: 0,
          critMultiplier: 1,
          iFrames: 0.6,
          hitX: player.x,
          hitY: player.y,
        });
        if (!enemy.typeDef?.boss) {
          enemy.dead = true;
          spawnExplosion(enemy.x, enemy.y);
        } else {
          triggerScreenShake(10, 0.45);
        }
      }
    }
  }

  function updateProjectiles(delta) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const projectile = projectiles[i];
      if (!projectile.active) {
        projectiles.splice(i, 1);
        releaseProjectile(projectile);
        continue;
      }
      projectile.elapsed += delta;
      projectile.x += projectile.vx * delta;
      projectile.y += projectile.vy * delta;
      if (projectile.elapsed >= projectile.lifetime || projectile.x < -100 || projectile.x > W + 100 || projectile.y < -100 || projectile.y > H + 100) {
        projectiles.splice(i, 1);
        releaseProjectile(projectile);
        continue;
      }
      const targets = [];
      if (projectile.mask & COLLISION_LAYERS.ENEMY) {
        for (const enemy of enemies) {
          if (!enemy.active || enemy.dead) continue;
          targets.push(enemy);
        }
      }
      if (projectile.mask & COLLISION_LAYERS.PLAYER) {
        targets.push(player);
      }
      let hitSomething = false;
      for (const target of targets) {
        if (target === player && player.hp <= 0) continue;
        const radius = (target.r || 10) + (projectile.r || 3);
        if (Math.hypot((target.x || 0) - projectile.x, (target.y || 0) - projectile.y) <= radius) {
          resolveDamage(target, projectile.damage, projectile.damageType, projectile.from, {
            critChance: projectile.critChance,
            critMultiplier: projectile.critMultiplier,
            iFrames: projectile.iFrames,
            hitX: projectile.x,
            hitY: projectile.y,
          });
          hitSomething = true;
          break;
        }
      }
      if (hitSomething) {
        projectiles.splice(i, 1);
        releaseProjectile(projectile);
      }
    }
  }

  function activateWave(wave) {
    if (!wave) return;
    const instance = {
      original: wave,
      spawns: (wave.spawns || []).map(spawn => ({
        config: { ...spawn },
        timer: 0,
        spawned: 0,
      })),
      boss: wave.boss ? { ...wave.boss, spawned: false } : null,
    };
    activeWaves.push(instance);
  }

  function updateWaves(delta) {
    const waves = gameData?.waves || [];
    elapsedTime += delta;
    while (nextWaveIndex < waves.length && elapsedTime >= (waves[nextWaveIndex].time || 0)) {
      activateWave(waves[nextWaveIndex]);
      nextWaveIndex++;
    }
    for (let i = activeWaves.length - 1; i >= 0; i--) {
      const wave = activeWaves[i];
      let finished = true;
      for (const spawn of wave.spawns) {
        const config = spawn.config;
        const count = Math.max(1, Math.floor(config.count || 1));
        if (spawn.spawned >= count) continue;
        finished = false;
        spawn.timer -= delta;
        if (spawn.timer <= 0) {
          const hasOffset = Number.isFinite(config.offsetY);
          const yOffset = hasOffset ? config.offsetY * H : Math.random() * (H - 80) + 40;
          const enemy = spawnEnemy(config.type || 'grunt', {
            y: yOffset,
            path: config.pattern,
          });
          spawn.spawned++;
          spawn.timer = config.interval || 0.5;
        }
      }
      if (wave.boss && !wave.boss.spawned && !bossActive) {
        spawnEnemy(wave.boss.type || 'overseer', { x: W - 120, y: H / 2 });
        wave.boss.spawned = true;
      }
      if (!wave.boss && wave.spawns.every(spawn => spawn.spawned >= Math.max(1, Math.floor(spawn.config.count || 1)))) {
        if (!enemies.some(enemy => !enemy.dead)) {
          finished = true;
        } else {
          finished = false;
        }
      }
      if (wave.boss) {
        if (wave.boss.spawned) {
          finished = !bossActive;
        } else {
          finished = false;
        }
      }
      if (finished) {
        activeWaves.splice(i, 1);
      }
    }
  }

  function triggerScreenShake(intensity = 6, duration = 0.4) {
    screenShake.intensity = Math.max(screenShake.intensity, intensity);
    screenShake.duration = Math.max(screenShake.duration, duration);
  }

  function updateScreenShake(delta) {
    if (screenShake.duration > 0) {
      screenShake.duration = Math.max(0, screenShake.duration - delta);
      const decay = 1 + screenShake.decay * delta;
      screenShake.intensity = Math.max(0, screenShake.intensity / decay);
    } else {
      screenShake.intensity = 0;
    }
  }

  function applyScreenShake() {
    if (!screenShake.duration || screenShake.intensity <= 0) return;
    const shake = screenShake.intensity;
    const offsetX = (Math.random() - 0.5) * shake;
    const offsetY = (Math.random() - 0.5) * shake;
    ctx.translate(offsetX, offsetY);
  }

  function update(delta){
    if (!Number.isFinite(delta)) delta = 0;
    delta = Math.max(0, delta);
    if (!dataLoaded) return;
    player.invuln = Math.max(0, (player.invuln || 0) - delta);

    player.vx = (keys.has('ArrowRight')||keys.has('d')||keys.has('D') ? 1 : 0) - (keys.has('ArrowLeft')||keys.has('a')||keys.has('A') ? 1 : 0);
    player.vy = (keys.has('ArrowDown')||keys.has('s')||keys.has('S') ? 1 : 0) - (keys.has('ArrowUp')||keys.has('w')||keys.has('W') ? 1 : 0);
    const len = Math.hypot(player.vx, player.vy) || 1;
    const moveDistance = player.speed * delta;
    player.x = Math.max(player.r, Math.min(W - player.r, player.x + (player.vx/len) * moveDistance));
    player.y = Math.max(player.r, Math.min(H - player.r, player.y + (player.vy/len) * moveDistance));

    const weaponDef = getWeapon(player.weaponId);
    player.weaponTimer = Math.max(0, (player.weaponTimer || 0) - delta);
    if ((keys.has(' ') || keys.has('Enter')) && player.weaponTimer <= 0){
      if (fireWeapon(player, weaponDef, 'player')) {
        player.weaponTimer = weaponDef.fireCooldown || 0.2;
        playShootSound();
      }
    }

    updateWaves(delta);
    updateProjectiles(delta);
    updatePortalEffects();
    updateEnemies(delta);
    handleEnemyPlayerCollisions();
    updateExplosions();
    updateDamageNumbers(delta);
    updateLootTexts(delta);
    updateChromaticBursts(delta);
    updateRayEffects(delta);
    updateScreenShake(delta);

    publishDiagnostics('running');
  }

  function draw(){
    if(!postedReady){
      postedReady = true;
      try { window.parent?.postMessage({ type:'GAME_READY', slug:'shooter' }, '*'); } catch {}
    }
    ctx.clearRect(0,0,W,H);
    if (ctx && 'imageSmoothingEnabled' in ctx) {
      ctx.imageSmoothingEnabled = false;
    }
    drawParallaxBackground();

    ctx.save();
    applyScreenShake();

    drawRayEffects();

    const bulletSprite = sprites.bullet;
    if (isImageReady(bulletSprite)) {
      const bw = bulletSprite.naturalWidth || bulletSprite.width;
      const bh = bulletSprite.naturalHeight || bulletSprite.height;
      for (const projectile of projectiles) {
        if (!projectile.active) continue;
        const flip = projectile.from === 'enemy' ? -1 : 1;
        ctx.save();
        ctx.translate(projectile.x, projectile.y);
        ctx.scale(flip, 1);
        ctx.drawImage(bulletSprite, -bw / 2, -bh / 2, bw, bh);
        ctx.restore();
      }
    } else {
      for (const projectile of projectiles) {
        if (!projectile.active) continue;
        ctx.fillStyle = projectile.from === 'enemy' ? '#f472b6' : '#93c5fd';
        ctx.beginPath();
        ctx.arc(projectile.x, projectile.y, projectile.r || 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawPortalEffects();

    const enemySprites = sprites.enemies || [];
    const enemySpritesReady = enemySprites.some(sprite => isImageReady(sprite));
    for (const enemy of enemies) {
      if (!enemy.active || enemy.dead) continue;
      const sprite = enemySpritesReady ? (enemySprites[enemy.spriteIndex || 0] || null) : null;
      if (sprite && isImageReady(sprite)) {
        const ew = sprite.naturalWidth || sprite.width;
        const eh = sprite.naturalHeight || sprite.height;
        ctx.drawImage(sprite, enemy.x - ew / 2, enemy.y - eh / 2, ew, eh);
      } else {
        ctx.fillStyle = enemy.typeDef?.boss ? '#f97316' : '#f87171';
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (enemy.typeDef?.boss) {
        ctx.save();
        ctx.globalAlpha = 0.2 + Math.abs(Math.sin(elapsedTime * 3)) * 0.3;
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.r + 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    const playerAlpha = player.invuln > 0 ? 0.55 + Math.sin(elapsedTime * 40) * 0.25 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0.2, Math.min(1, playerAlpha));
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawExplosions();
    drawChromaticBursts();
    drawDamageNumbers();
    drawLootTexts();

    ctx.restore();

    ctx.fillStyle = '#fff'; ctx.font = '16px system-ui';
    ctx.fillText(`Score: ${Math.round(score)}`, 16, 26);
    ctx.fillText(`HP: ${Math.max(0, Math.ceil(player.hp))}/${player.maxHp}`, 16, 48);
    ctx.fillText('Move: WASD/Arrows • Shoot: Space/Enter', 16, 70);
    if (bossActive && bossActive.typeDef) {
      const hpRatio = Math.max(0, Math.min(1, bossActive.hp / (bossActive.typeDef.hp || 1)));
      const barWidth = 320;
      const barX = (W - barWidth) / 2;
      const barY = 40;
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(barX, barY, barWidth, 14);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(barX, barY, barWidth * hpRatio, 14);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.strokeRect(barX, barY, barWidth, 14);
      ctx.font = '14px system-ui';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('BOSS', W / 2, barY - 6);
    }

    if (scoreElement) {
      scoreElement.textContent = String(Math.round(score));
      scoreElement.dataset.gameScore = String(Math.round(score));
    }
    if (scoreDisplay) {
      scoreDisplay.textContent = String(Math.round(score));
    }
  }

  function drawExplosions() {
    if (!explosions.length) return;
    const sprite = sprites.explosion;
    const frameSize = explosionSprite.frameSize || 0;
    const framesPerRow = Math.max(1, explosionSprite.framesPerRow || 1);
    const totalFrames = Math.max(1, explosionSprite.totalFrames || 1);
    if (isImageReady(sprite) && frameSize > 0) {
      for (const explosion of explosions) {
        const index = Math.min(totalFrames - 1, explosion.frameIndex || 0);
        const sx = (index % framesPerRow) * frameSize;
        const sy = Math.floor(index / framesPerRow) * frameSize;
        const size = frameSize;
        ctx.drawImage(sprite, sx, sy, frameSize, frameSize, explosion.x - size / 2, explosion.y - size / 2, size, size);
      }
    } else {
      const prevFill = ctx.fillStyle;
      ctx.fillStyle = 'rgba(248,113,113,0.6)';
      for (const explosion of explosions) {
        const radius = Math.max(6, player.r * 1.2);
        ctx.beginPath();
        ctx.arc(explosion.x, explosion.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = prevFill;
    }
  }

  function updatePortalEffects() {
    if (!portalEffects.length) return;
    const totalFrames = Math.max(1, portalSprite.totalFrames || 1);
    for (let i = portalEffects.length - 1; i >= 0; i--) {
      const effect = portalEffects[i];
      effect.frameDelay = (effect.frameDelay || 0) + 1;
      if (effect.frameDelay >= 4) {
        effect.frameDelay = 0;
        effect.frameIndex = (effect.frameIndex || 0) + 1;
        if (effect.frameIndex >= totalFrames) {
          if (effect.enemy) effect.enemy.active = true;
          portalEffects.splice(i, 1);
        }
      }
    }
    if (!portalEffects.length) {
      for (const enemy of enemies) {
        if (!enemy.active) enemy.active = true;
      }
    }
  }

  function drawPortalEffects() {
    if (!portalEffects.length) return;
    const sprite = sprites.portal;
    const frameWidth = portalSprite.frameWidth || 0;
    const frameHeight = portalSprite.frameHeight || 0;
    const totalFrames = Math.max(1, portalSprite.totalFrames || 1);
    if (isImageReady(sprite) && frameWidth > 0 && frameHeight > 0) {
      for (const effect of portalEffects) {
        const index = Math.min(totalFrames - 1, effect.frameIndex || 0);
        const sx = index * frameWidth;
        const sy = 0;
        ctx.drawImage(sprite, sx, sy, frameWidth, frameHeight, effect.x - frameWidth / 2, effect.y - frameHeight / 2, frameWidth, frameHeight);
      }
    } else {
      const prevFill = ctx.fillStyle;
      ctx.fillStyle = 'rgba(59,130,246,0.65)';
      for (const effect of portalEffects) {
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, Math.max(12, player.r * 1.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = prevFill;
    }
  }

  function spawnChromaticBurst(x, y, power = 1) {
    chromaticBursts.push({ x, y, life: 0, duration: 0.6, power });
  }

  function updateChromaticBursts(delta) {
    for (let i = chromaticBursts.length - 1; i >= 0; i--) {
      const burst = chromaticBursts[i];
      burst.life += delta;
      if (burst.life >= burst.duration) {
        chromaticBursts.splice(i, 1);
      }
    }
  }

  function drawChromaticBursts() {
    if (!chromaticBursts.length) return;
    for (const burst of chromaticBursts) {
      const t = Math.max(0, 1 - burst.life / burst.duration);
      const radius = 30 + t * 90 * burst.power;
      const alpha = 0.35 * t;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(96,165,250,1)';
      ctx.beginPath();
      ctx.arc(burst.x - 4, burst.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(248,113,113,1)';
      ctx.beginPath();
      ctx.arc(burst.x + 4, burst.y, radius * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  let raf = 0;
  let shellPaused = false;
  let pausedByShell = false;

  function frame(timestamp){
    if(shellPaused){ raf = 0; return; }
    const now = typeof timestamp === 'number'
      ? timestamp
      : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let delta = (now - lastParallaxTime) / 1000;
    if (!Number.isFinite(delta)) delta = 0;
    delta = Math.max(0, Math.min(0.1, delta));
    lastParallaxTime = now;
    updateParallax(delta);
    update(delta);
    draw();
    if (player.hp>0) {
      raf=requestAnimationFrame(frame);
    } else {
      gameOver();
      shellPaused = false;
      pausedByShell = false;
      raf = 0;
    }
  }

  function startLoop(){
    if(!raf && player.hp>0){
      lastParallaxTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      raf=requestAnimationFrame(frame);
    }
  }

  function stopLoop(){ if(raf){ cancelAnimationFrame(raf); raf=0; } }

  function pauseForShell(){
    if(shellPaused) return;
    if(player.hp<=0){ shellPaused=false; pausedByShell=false; return; }
    shellPaused=true;
    pausedByShell=true;
    stopLoop();
    publishDiagnostics('paused', { forceState: true });
  }

  function resumeFromShell(){
    if(!shellPaused || document.hidden) return;
    shellPaused=false;
    if(pausedByShell && player.hp>0){ pausedByShell=false; startLoop(); }
    publishDiagnostics('running', { forceState: true });
  }

  function restart(){
    stopLoop();
    player.x = W*0.2;
    player.y = H*0.5;
    player.vx = 0;
    player.vy = 0;
    player.hp = player.maxHp;
    player.weaponTimer = 0;
    player.weaponId = 'blaster';
    player.invuln = 0;
    projectiles.length = 0;
    enemies.length = 0;
    explosions.length = 0;
    portalEffects.length = 0;
    damageNumbers.length = 0;
    lootDrops.length = 0;
    chromaticBursts.length = 0;
    rayEffects.length = 0;
    activeWaves.length = 0;
    elapsedTime = 0;
    nextWaveIndex = 0;
    bossActive = null;
    resetParallax();
    score = 0;
    shellPaused = false;
    pausedByShell = false;
    currentState = 'ready';
    loadGameData();
    publishDiagnostics('running', { forceScore: true, forceState: true });
    draw();
    startLoop();
  }

  const onShellPause=()=>pauseForShell();
  const onShellResume=()=>resumeFromShell();
  const onVisibility=()=>{ if(document.hidden) pauseForShell(); else resumeFromShell(); };
  const onShellMessage=(event)=>{
    const data=event && typeof event.data==='object' ? event.data : null;
    const type=data?.type;
    if(type==='GAME_PAUSE' || type==='GG_PAUSE') pauseForShell();
    if(type==='GAME_RESUME' || type==='GG_RESUME') resumeFromShell();
  };

  window.addEventListener('ggshell:pause', onShellPause);
  window.addEventListener('ggshell:resume', onShellResume);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('message', onShellMessage, { passive:true });

  function gameOver(){
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#fff'; ctx.font='bold 48px system-ui'; ctx.textAlign='center';
    ctx.fillText('Game Over', W/2, H/2 - 10);
    ctx.font='24px system-ui';
    ctx.fillText(`Score: ${Math.round(score)}`, W/2, H/2 + 26);
    playGameOverSound();
    publishDiagnostics('gameover', { forceScore: true, forceState: true });
  }
  function syncShooterState(){
    if(!shooterAPI) return;
    shooterAPI.player = player;
    shooterAPI.enemies = enemies;
    shooterAPI.projectiles = projectiles;
    shooterAPI.score = score;
    shooterAPI.hp = player.hp;
    shooterAPI.state = currentState;
  }

  function publishDiagnostics(stateLabel, { forceScore = false, forceState = false } = {}){
    if(stateLabel) currentState = stateLabel;
    syncShooterState();
    const shouldPushScore = forceScore || score !== lastPostedScore || player.hp !== lastPostedHp;
    if(shouldPushScore){
      pushEvent('score', { score, hp: player.hp, state: currentState });
      lastPostedScore = score;
      lastPostedHp = player.hp;
    }
    const shouldPushState = forceState || currentState !== lastPostedState;
    if(shouldPushState){
      pushEvent('state', { status: currentState, score, hp: player.hp });
      lastPostedState = currentState;
    }
  }

  const existing = typeof window !== 'undefined' && window.Shooter && typeof window.Shooter === 'object'
    ? window.Shooter
    : null;
  const base = existing && typeof existing === 'object' ? existing : {};
  const readyQueue = Array.isArray(base.onReady) ? base.onReady : [];
  shooterAPI = Object.assign(base, {
    startLoop,
    pauseForShell,
    resumeFromShell,
    restart,
    player,
    enemies,
    projectiles,
    onReady: readyQueue,
    score,
    hp: player.hp,
    state: currentState,
  });
  if (!Array.isArray(base.onReady)) {
    base.onReady = readyQueue;
  }
  if (typeof window !== 'undefined') {
    window.Shooter = shooterAPI;
  }
  syncShooterState();
  if (readyQueue.length) {
    const callbacks = readyQueue.slice();
    readyQueue.length = 0;
    for (const callback of callbacks) {
      if (typeof callback === 'function') {
        try { callback(shooterAPI); }
        catch (error) { console.error('[shooter] onReady callback failed', error); }
      }
    }
  }

  resetParallax();
  loadGameData();
  startLoop();
  addEventListener('beforeunload', ()=>stopLoop());
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
