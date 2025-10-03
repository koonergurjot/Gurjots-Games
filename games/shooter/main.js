// Minimal top-down shooter (canvas id='game')
import { pushEvent } from '/games/common/diag-adapter.js';
import { getCachedAudio, getCachedImage, loadAudio, loadImage } from '../../shared/assets.js';
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

  const player = { x: W*0.2, y: H*0.5, r: 12, vx: 0, vy: 0, speed: 5, hp: 3, cd: 0 };
  const bullets = [];
  const enemies = [];
  const portalEffects = [];
  const explosions = [];
  let t = 0, score = 0;
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
    const framesPerRow = explosionSprite.framesPerRow || 8;
    const size = Math.floor((image.naturalWidth || image.width || 0) / framesPerRow) || 0;
    if (!size) return;
    const rows = Math.max(1, Math.floor((image.naturalHeight || image.height || 0) / size));
    explosionSprite.frameSize = size;
    explosionSprite.framesPerRow = framesPerRow;
    explosionSprite.totalFrames = Math.max(1, framesPerRow * rows);
  }

  function preparePortalSprite() {
    const image = sprites.portal;
    if (!isImageReady(image)) return;
    const totalFrames = Math.max(1, portalSprite.totalFrames || 1);
    const width = Math.floor((image.naturalWidth || image.width || 0) / totalFrames) || 0;
    const height = image.naturalHeight || image.height || 0;
    if (!width || !height) return;
    portalSprite.frameWidth = width;
    portalSprite.frameHeight = height;
    portalSprite.totalFrames = totalFrames;
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

  function update(){
    // movement
    player.vx = (keys.has('ArrowRight')||keys.has('d')||keys.has('D') ? 1 : 0) - (keys.has('ArrowLeft')||keys.has('a')||keys.has('A') ? 1 : 0);
    player.vy = (keys.has('ArrowDown')||keys.has('s')||keys.has('S') ? 1 : 0) - (keys.has('ArrowUp')||keys.has('w')||keys.has('W') ? 1 : 0);
    const len = Math.hypot(player.vx, player.vy) || 1;
    player.x = Math.max(0, Math.min(W, player.x + (player.vx/len)*player.speed));
    player.y = Math.max(0, Math.min(H, player.y + (player.vy/len)*player.speed));

    // shooting
    player.cd = Math.max(0, player.cd-1);
    if ((keys.has(' ') || keys.has('Enter')) && player.cd === 0){
      bullets.push({ x: player.x+player.r+2, y: player.y, vx: 10, r: 3 });
      player.cd = 8;
      playShootSound();
    }

    // spawn enemies
    if (t % 45 === 0){
      const y = 20 + Math.random()*(H-40);
      const spriteIndex = Math.floor(Math.random() * ASSET_PATHS.enemies.length) || 0;
      const enemy = { x: W+20, y, vx: - (2 + Math.random()*2), r: 10, spriteIndex, active: false };
      enemies.push(enemy);
      portalEffects.push({ x: enemy.x, y: enemy.y, frameIndex: 0, frameDelay: 0, enemy });
    }

    // move bullets & enemies
    for (const b of bullets){ b.x += b.vx; }
    for (const e of enemies){ if (e.active) { e.x += e.vx; } }

    // collisions & culling
    for (let i=enemies.length-1;i>=0;i--){
      const e = enemies[i];
      if (!e.active) continue;
      if (e.x < -30) { enemies.splice(i,1); continue; }
      // hit player?
      if (Math.hypot(e.x-player.x, e.y-player.y) < e.r + player.r){
        enemies.splice(i,1);
        spawnExplosion(e.x, e.y);
        player.hp--;
      }
      // bullets hit
      for (let j=bullets.length-1;j>=0;j--){
        const b = bullets[j];
        if (Math.hypot(e.x-b.x, e.y-b.y) < e.r + b.r){
          enemies.splice(i,1); bullets.splice(j,1);
          spawnExplosion(e.x, e.y);
          score++;
          break;
        }
      }
    }
    for (let i=bullets.length-1;i>=0;i--){
      if (bullets[i].x > W+30) bullets.splice(i,1);
    }

    t++;

    updatePortalEffects();
    updateExplosions();

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
    // player
    ctx.fillStyle = '#4ade80';
    ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI*2); ctx.fill();
    // bullets
    const bulletSprite = sprites.bullet;
    if (isImageReady(bulletSprite)) {
      const bw = bulletSprite.naturalWidth || bulletSprite.width;
      const bh = bulletSprite.naturalHeight || bulletSprite.height;
      for (const b of bullets) {
        ctx.drawImage(bulletSprite, b.x - bw / 2, b.y - bh / 2, bw, bh);
      }
    } else {
      ctx.fillStyle = '#93c5fd';
      for (const b of bullets){ ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill(); }
    }
    drawPortalEffects();
    // enemies
    const enemySprites = sprites.enemies || [];
    if (enemySprites.some(sprite => isImageReady(sprite))) {
      for (const e of enemies){
        if (!e.active) continue;
        const sprite = enemySprites[e.spriteIndex] || null;
        if (sprite && isImageReady(sprite)) {
          const ew = sprite.naturalWidth || sprite.width;
          const eh = sprite.naturalHeight || sprite.height;
          ctx.drawImage(sprite, e.x - ew / 2, e.y - eh / 2, ew, eh);
        } else {
          ctx.fillStyle = '#f87171';
          ctx.beginPath();
          ctx.arc(e.x,e.y,e.r,0,Math.PI*2);
          ctx.fill();
        }
      }
    } else {
      ctx.fillStyle = '#f87171';
      for (const e of enemies){
        if (!e.active) continue;
        ctx.beginPath(); ctx.arc(e.x,e.y,e.r,0,Math.PI*2); ctx.fill();
      }
    }

    drawExplosions();
    // HUD
    ctx.fillStyle = '#fff'; ctx.font = '16px system-ui';
    ctx.fillText(`Score: ${score}`, 16, 26);
    ctx.fillText(`HP: ${player.hp}`, 16, 48);
    ctx.fillText('Move: WASD/Arrows • Shoot: Space/Enter', 16, 70);

    if (scoreElement) {
      scoreElement.textContent = String(score);
      scoreElement.dataset.gameScore = String(score);
    }
    if (scoreDisplay) {
      scoreDisplay.textContent = String(score);
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
    update();
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
    player.hp = 3;
    player.cd = 0;
    bullets.length = 0;
    enemies.length = 0;
    explosions.length = 0;
    portalEffects.length = 0;
    t = 0;
    resetParallax();
    score = 0;
    shellPaused = false;
    pausedByShell = false;
    currentState = 'ready';
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
    ctx.fillText(`Score: ${score}`, W/2, H/2 + 26);
    playGameOverSound();
    publishDiagnostics('gameover', { forceScore: true, forceState: true });
  }
  function syncShooterState(){
    if(!shooterAPI) return;
    shooterAPI.player = player;
    shooterAPI.enemies = enemies;
    shooterAPI.bullets = bullets;
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
    bullets,
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
