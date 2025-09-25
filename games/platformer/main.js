import * as net from './net.js';

const GRAVITY = 0.7;
const MOVE_SPEED = 4;
const JUMP_FORCE = 13;
const STATE_INTERVAL = 90; // ms

const KEY_LEFT = ['arrowleft', 'a'];
const KEY_RIGHT = ['arrowright', 'd'];
const KEY_JUMP = ['space', 'spacebar', 'arrowup', 'w'];

function normKey(key) {
  if (key === ' ') return 'space';
  return key.toLowerCase();
}

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function createPlatforms(width, groundY) {
  return [
    { x: 0, y: groundY, w: 260, h: 60 },
    { x: 340, y: groundY, w: width - 340, h: 60 },
    { x: 220, y: groundY - 140, w: 130, h: 16 },
    { x: 520, y: groundY - 210, w: 160, h: 16 },
    { x: 720, y: groundY - 90, w: 140, h: 16 },
    { x: 600, y: groundY - 40, w: 70, h: 12 }
  ];
}

function createCoins(groundY) {
  return [
    { id: 'coin-0', x: 250, y: groundY - 172, w: 18, h: 18, collected: false },
    { id: 'coin-1', x: 570, y: groundY - 232, w: 18, h: 18, collected: false },
    { id: 'coin-2', x: 640, y: groundY - 62, w: 18, h: 18, collected: false },
    { id: 'coin-3', x: 790, y: groundY - 122, w: 18, h: 18, collected: false }
  ];
}

function createGoal(groundY, width) {
  return { x: width - 90, y: groundY - 120, w: 50, h: 120 };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) {
    console.error('[platformer] missing #game canvas');
    return;
  }
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.width || 960;
  canvas.height = canvas.height || 540;
  const W = canvas.width;
  const H = canvas.height;
  const groundY = H - 60;
  let postedReady = false;

  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('over-title');
  const overlayInfo = document.getElementById('over-info');
  const restartBtn = document.getElementById('restartBtn');
  const shareBtn = document.getElementById('shareBtn');
  const startCoopBtn = document.getElementById('startCoop');
  const connStatus = document.getElementById('connStatus');
  const netHud = document.getElementById('netHud');
  const hud = document.querySelector('.hud');
  const defaultShareLabel = shareBtn?.textContent?.trim() ?? 'Share';
  const defaultCoopLabel = startCoopBtn?.textContent?.trim() ?? 'Start Co-op';

  if (hud && !hud.dataset.platformerAugmented) {
    hud.dataset.platformerAugmented = 'true';
    const extra = document.createElement('div');
    extra.style.marginTop = '6px';
    extra.style.fontSize = '12px';
    extra.style.color = '#9fb3d0';
    extra.textContent = 'Co-op works in another open tab of this site. Share uses your browser\'s share/clipboard permissions.';
    hud.appendChild(extra);
  }

  const platforms = createPlatforms(W, groundY);
  let coins = createCoins(groundY);
  const goal = createGoal(groundY, W);

  const localPlayer = {
    x: 100,
    y: groundY - 40,
    w: 28,
    h: 40,
    vx: 0,
    vy: 0,
    onGround: true,
    facing: 1,
    collected: 0,
  };

  const remotePlayer = {
    x: 100,
    y: groundY - 40,
    w: 28,
    h: 40,
    facing: 1,
    onGround: false,
    coins: 0,
    lastSeen: 0,
    active: false,
    gameOver: false,
  };

  let paused = false;
  let gameOver = false;
  let finalTime = null;
  let rafId = 0;
  let lastFrame = performance.now();
  let sendTimer = 0;
  let runStart = performance.now();
  let shareResetTimer = 0;
  let coopRetryTimer = 0;

  const keys = new Set();

  function resetState() {
    localPlayer.x = 100;
    localPlayer.y = groundY - localPlayer.h;
    localPlayer.vx = 0;
    localPlayer.vy = 0;
    localPlayer.onGround = true;
    localPlayer.facing = 1;
    localPlayer.collected = 0;
    coins = createCoins(groundY);
    gameOver = false;
    paused = false;
    finalTime = null;
    runStart = performance.now();
    keys.clear();
    hideOverlay();
    if (connStatus) connStatus.textContent = net.isConnected() ? connectionLabel() : 'Offline';
  }

  function showOverlay(title, info, { showShare = true } = {}) {
    if (!overlay) return;
    overlay.classList.add('show');
    if (overlayTitle) overlayTitle.textContent = title;
    if (overlayInfo) overlayInfo.textContent = info;
    if (shareBtn) shareBtn.style.display = showShare ? 'inline-block' : 'none';
  }

  function hideOverlay() {
    overlay?.classList.remove('show');
  }

  function secondsElapsed() {
    const end = finalTime ?? performance.now();
    return Math.max(0, (end - runStart) / 1000);
  }

  function triggerGameOver(title, info) {
    if (gameOver) return;
    gameOver = true;
    paused = true;
    finalTime = performance.now();
    showOverlay(title, info, { showShare: true });
    if (net.isConnected()) sendState();
  }

  function togglePause(forceState) {
    if (gameOver) return;
    const next = typeof forceState === 'boolean' ? forceState : !paused;
    if (next === paused) return;
    paused = next;
    if (paused) {
      showOverlay('Paused', 'Press P to resume or R to restart.', { showShare: false });
    } else {
      hideOverlay();
    }
    if (net.isConnected()) sendState();
  }

  function restartGame() {
    resetState();
    if (net.isConnected()) {
      net.sendAssist();
      sendState();
    }
  }

  function shareRun() {
    if (!shareBtn) return;
    const coinsInfo = `${localPlayer.collected}/${coins.length}`;
    const seconds = secondsElapsed().toFixed(1);
    const result = gameOver && overlayTitle?.textContent?.includes('Clear') ? 'cleared the stage' : 'took a spill';
    const text = `I ${result} in Retro Platformer with ${coinsInfo} coins in ${seconds}s! ${location.href}`;

    shareBtn.style.pointerEvents = 'none';
    shareBtn.setAttribute('aria-disabled', 'true');
    const resetShare = () => {
      shareBtn.style.pointerEvents = 'auto';
      shareBtn.removeAttribute('aria-disabled');
      shareBtn.textContent = defaultShareLabel;
    };

    const doResetLater = () => {
      clearTimeout(shareResetTimer);
      shareResetTimer = window.setTimeout(resetShare, 2500);
    };

    if (navigator.share) {
      navigator.share({ title: 'Retro Platformer', text, url: location.href })
        .then(() => {
          shareBtn.textContent = 'Shared!';
          doResetLater();
        })
        .catch(() => {
          shareBtn.textContent = 'Share cancelled';
          doResetLater();
        });
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          shareBtn.textContent = 'Link copied!';
          doResetLater();
        })
        .catch(() => {
          shareBtn.textContent = 'Copy failed';
          doResetLater();
        });
    } else {
      alert(text);
      shareBtn.textContent = 'Shared!';
      doResetLater();
    }
  }

  function connectionLabel() {
    return net.amHost() ? 'Co-op (Host)' : 'Co-op (Guest)';
  }

  function markCoin(id) {
    const coin = coins.find(c => c.id === id);
    if (coin && !coin.collected) {
      coin.collected = true;
      localPlayer.collected = coins.filter(c => c.collected).length;
    }
  }

  function setRemoteCoins(ids) {
    if (!Array.isArray(ids)) return;
    let changed = false;
    for (const coin of coins) {
      if (ids.includes(coin.id) && !coin.collected) {
        coin.collected = true;
        changed = true;
      }
    }
    if (changed) {
      localPlayer.collected = coins.filter(c => c.collected).length;
    }
  }

  function sendState() {
    if (!net.isConnected()) return;
    net.sendState({
      x: localPlayer.x,
      y: localPlayer.y,
      vx: localPlayer.vx,
      vy: localPlayer.vy,
      facing: localPlayer.facing,
      onGround: localPlayer.onGround,
      collected: coins.filter(c => c.collected).map(c => c.id),
      gameOver,
      paused,
      time: secondsElapsed(),
    });
  }

  function handleRemoteState(data) {
    if (!data) return;
    remotePlayer.x = typeof data.x === 'number' ? data.x : remotePlayer.x;
    remotePlayer.y = typeof data.y === 'number' ? data.y : remotePlayer.y;
    remotePlayer.facing = data.facing === -1 ? -1 : 1;
    remotePlayer.onGround = !!data.onGround;
    remotePlayer.vx = data.vx || 0;
    remotePlayer.vy = data.vy || 0;
    remotePlayer.coins = Array.isArray(data.collected) ? data.collected.length : remotePlayer.coins;
    remotePlayer.gameOver = !!data.gameOver;
    remotePlayer.lastSeen = performance.now();
    remotePlayer.active = true;
    setRemoteCoins(data.collected);
  }

  function handleRemoteCollect(data) {
    if (!data) return;
    markCoin(data.id);
  }

  function handleAssist() {
    if (gameOver) {
      restartGame();
    } else if (paused) {
      togglePause(false);
    }
  }

  function initNet() {
    if (!startCoopBtn || !connStatus) return;

    startCoopBtn.addEventListener('click', () => {
      if (net.isConnected()) return;
      startCoopBtn.textContent = 'Pairing…';
      startCoopBtn.style.pointerEvents = 'none';
      startCoopBtn.style.opacity = '0.7';
      startCoopBtn.setAttribute('aria-disabled', 'true');
      connStatus.textContent = 'Pairing…';
      net.connect();
      clearTimeout(coopRetryTimer);
      coopRetryTimer = window.setTimeout(() => {
        if (!net.isConnected()) {
          startCoopBtn.textContent = defaultCoopLabel;
          startCoopBtn.style.pointerEvents = 'auto';
          startCoopBtn.style.opacity = '1';
          startCoopBtn.removeAttribute('aria-disabled');
          connStatus.textContent = 'Offline';
        }
      }, 4000);
    });

    net.on('connect', () => {
      clearTimeout(coopRetryTimer);
      connStatus.textContent = connectionLabel();
      startCoopBtn.textContent = 'Connected';
      startCoopBtn.style.pointerEvents = 'none';
      startCoopBtn.style.opacity = '0.7';
      startCoopBtn.setAttribute('aria-disabled', 'true');
      remotePlayer.active = false;
      sendState();
    });

    net.on('state', data => handleRemoteState(data));
    net.on('collect', data => handleRemoteCollect(data));
    net.on('assist', () => handleAssist());

    connStatus.textContent = 'Offline';
  }

  function handleKeyDown(event) {
    const key = normKey(event.key);
    if (!key) return;

    if (key === 'p') {
      event.preventDefault();
      togglePause();
      return;
    }
    if (key === 'r') {
      event.preventDefault();
      restartGame();
      return;
    }

    keys.add(key);
    if (KEY_JUMP.includes(key) && localPlayer.onGround && !paused && !gameOver) {
      event.preventDefault();
      localPlayer.vy = -JUMP_FORCE;
      localPlayer.onGround = false;
    }
  }

  function handleKeyUp(event) {
    keys.delete(normKey(event.key));
  }

  function updatePhysics(dt) {
    localPlayer.vx = 0;
    if (!paused && !gameOver) {
      if (KEY_LEFT.some(k => keys.has(k))) {
        localPlayer.vx = -MOVE_SPEED;
        localPlayer.facing = -1;
      }
      if (KEY_RIGHT.some(k => keys.has(k))) {
        localPlayer.vx = MOVE_SPEED;
        localPlayer.facing = 1;
      }
      if (!localPlayer.onGround) {
        localPlayer.vy += GRAVITY * dt;
      }
    }

    if (paused || gameOver) {
      return;
    }

    localPlayer.x += localPlayer.vx * dt;
    localPlayer.y += localPlayer.vy * dt;

    localPlayer.onGround = false;
    for (const platform of platforms) {
      if (!aabb(localPlayer, platform)) continue;
      const prevY = localPlayer.y - localPlayer.vy * dt;
      if (prevY + localPlayer.h <= platform.y && localPlayer.vy > 0) {
        localPlayer.y = platform.y - localPlayer.h;
        localPlayer.vy = 0;
        localPlayer.onGround = true;
      } else if (prevY >= platform.y + platform.h && localPlayer.vy < 0) {
        localPlayer.y = platform.y + platform.h;
        localPlayer.vy = 0;
      } else {
        if (localPlayer.vx > 0) localPlayer.x = platform.x - localPlayer.w;
        if (localPlayer.vx < 0) localPlayer.x = platform.x + platform.w;
      }
    }

    localPlayer.x = clamp(localPlayer.x, -40, W - localPlayer.w + 40);

    if (localPlayer.y > H + 120) {
      triggerGameOver('Game Over', `You fell after collecting ${localPlayer.collected}/${coins.length} coins in ${secondsElapsed().toFixed(1)}s.`);
    }

    if (localPlayer.onGround) {
      localPlayer.vy = 0;
    }

    for (const coin of coins) {
      if (!coin.collected && aabb(localPlayer, coin)) {
        coin.collected = true;
        localPlayer.collected += 1;
        if (net.isConnected()) {
          net.sendCollect({ id: coin.id });
        }
      }
    }

    if (localPlayer.collected >= coins.length && aabb(localPlayer, goal)) {
      triggerGameOver('Level Clear!', `Collected ${localPlayer.collected}/${coins.length} coins in ${secondsElapsed().toFixed(1)}s.`);
    }
  }

  function drawScene() {
    if(!postedReady){
      postedReady = true;
      try { window.parent?.postMessage({ type:'GAME_READY', slug:'platformer' }, '*'); } catch {}
    }
    ctx.clearRect(0, 0, W, H);
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, '#0d1a2b');
    gradient.addColorStop(1, '#0b1020');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#223757';
    ctx.fillRect(0, groundY + 30, W, H - groundY - 30);

    ctx.fillStyle = '#385a88';
    for (const platform of platforms) {
      ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
    }

    ctx.fillStyle = '#ffe066';
    for (const coin of coins) {
      if (coin.collected) continue;
      const cx = coin.x + coin.w / 2;
      const cy = coin.y + coin.h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, coin.w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d4a514';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = '#98c1ff';
    ctx.fillRect(goal.x, goal.y, goal.w, goal.h);
    ctx.fillStyle = '#0e1422';
    ctx.fillRect(goal.x + 8, goal.y + 12, goal.w - 16, goal.h - 20);

    if (remotePlayer.active && performance.now() - remotePlayer.lastSeen < 1200) {
      ctx.fillStyle = '#ff9f1c';
      ctx.fillRect(remotePlayer.x, remotePlayer.y, remotePlayer.w, remotePlayer.h);
      ctx.fillStyle = '#ffd37a';
      ctx.font = '12px system-ui';
      ctx.fillText('Partner', remotePlayer.x - 6, remotePlayer.y - 8);
    }

    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(localPlayer.x, localPlayer.y, localPlayer.w, localPlayer.h);

    ctx.fillStyle = '#f5f7ff';
    ctx.font = '14px system-ui';
    const coinsText = `Coins: ${localPlayer.collected}/${coins.length}`;
    ctx.fillText(coinsText, 16, 24);
    const timeText = `Time: ${secondsElapsed().toFixed(1)}s`;
    ctx.fillText(timeText, 16, 44);

    if (net.isConnected()) {
      ctx.fillStyle = '#aad9ff';
      ctx.font = '13px system-ui';
      const partnerCoins = `Partner coins: ${remotePlayer.coins ?? 0}`;
      ctx.fillText(partnerCoins, 16, 64);
      if (remotePlayer.gameOver) {
        ctx.fillStyle = '#f4a261';
        ctx.font = '12px system-ui';
        ctx.fillText('Partner is waiting on the overlay.', 16, 82);
      }
    } else {
      ctx.fillStyle = '#7a8dad';
      ctx.font = '12px system-ui';
      ctx.fillText('Click "Start Co-op" in the HUD to link another tab.', 16, 64);
    }

    if (!gameOver && localPlayer.collected < coins.length && aabb(localPlayer, goal)) {
      ctx.fillStyle = '#ffd166';
      ctx.font = '14px system-ui';
      ctx.fillText('Collect the remaining coins!', goal.x - 60, goal.y - 12);
    }
  }

  function frame(now) {
    const dtMs = Math.min(Math.max(now - lastFrame, 1), 1000 / 20);
    lastFrame = now;
    const dt = dtMs / (1000 / 60); // scale to 60fps units

    updatePhysics(dt);

    if (!paused && !gameOver) {
      sendTimer += dtMs;
      if (sendTimer >= STATE_INTERVAL) {
        sendTimer = 0;
        sendState();
      }
    }

    drawScene();
    rafId = requestAnimationFrame(frame);
  }

  function cleanup() {
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    clearTimeout(shareResetTimer);
    clearTimeout(coopRetryTimer);
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  restartBtn?.addEventListener('click', restartGame);
  shareBtn?.addEventListener('click', shareRun);
  if (netHud) initNet();

  resetState();
  lastFrame = performance.now();
  rafId = requestAnimationFrame(frame);
  window.addEventListener('beforeunload', cleanup, { once: true });
}
