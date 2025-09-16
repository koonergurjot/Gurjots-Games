const BEST_KEY = 'shooter.best';
const PLAYER_ID = (() => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
})();
const PLAYER_NAME = `Pilot ${PLAYER_ID.slice(-4).toUpperCase()}`;
const NET_LOADER = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? import('./net.js').then(mod => mod.default).catch(() => null)
  : Promise.resolve(null);

const POWER_TYPES = ['rapid', 'spread', 'shield', 'turret', 'wall'];

export function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) {
    console.error('[shooter] missing #game canvas');
    return;
  }
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.width || 960;
  canvas.height = canvas.height || 540;
  const W = canvas.width;
  const H = canvas.height;

  const ui = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    power: document.getElementById('power'),
    shield: document.getElementById('shield'),
    overlay: document.getElementById('overlay'),
    overTitle: document.getElementById('over-title'),
    overInfo: document.getElementById('over-info'),
    restartBtn: document.getElementById('restartBtn'),
    shareBtn: document.getElementById('shareBtn'),
    roomInput: document.getElementById('roomName'),
    joinRoomBtn: document.getElementById('joinRoom'),
    leaveRoomBtn: document.getElementById('leaveRoom'),
    voiceBtn: document.getElementById('voiceToggle'),
    chat: document.querySelector('[data-chat]'),
    chatLog: document.querySelector('[data-chat-log]'),
    chatInput: document.querySelector('[data-chat-input]')
  };

  const storedBest = Number(localStorage.getItem(BEST_KEY) || '0') || 0;
  const state = {
    running: false,
    paused: false,
    over: false,
    tick: 0,
    score: 0,
    best: storedBest,
    power: null,
    shield: 0,
    turretCharges: 0,
    wallCharges: 0,
    room: null,
    voice: false,
    lastShareMessage: '',
    net: null
  };

  const player = {
    id: PLAYER_ID,
    name: PLAYER_NAME,
    x: W * 0.2,
    y: H * 0.5,
    r: 12,
    vx: 0,
    vy: 0,
    speed: 5,
    hp: 3,
    maxHp: 3,
    cd: 0,
    baseCooldown: 8,
    shield: 0
  };

  const keys = new Set();
  const bullets = [];
  const enemies = [];
  const powerUps = [];
  const defenses = [];
  const otherPlayers = new Map();
  let chatChannel = null;

  updateScore(0);
  updateBest(storedBest);
  updatePowerDisplay();
  updateShieldDisplay();

  if (ui.chatInput) {
    ui.chatInput.disabled = true;
    ui.chatInput.placeholder = 'Join a room to chat';
  }

  NET_LOADER.then(net => {
    state.net = net;
    if (!net) return;
    net.on('player', data => {
      if (!data || data.room !== state.room || data.id === player.id) return;
      otherPlayers.set(data.id, {
        ...data,
        lastSeen: performance.now()
      });
    });
  });

  if (ui.restartBtn) ui.restartBtn.addEventListener('click', () => restartGame());
  if (ui.shareBtn) ui.shareBtn.addEventListener('click', handleShare);
  if (ui.joinRoomBtn) ui.joinRoomBtn.addEventListener('click', () => joinRoom());
  if (ui.leaveRoomBtn) ui.leaveRoomBtn.addEventListener('click', () => leaveRoom());
  if (ui.roomInput) {
    ui.roomInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        joinRoom();
      }
    });
  }
  if (ui.voiceBtn) {
    ui.voiceBtn.addEventListener('click', () => {
      state.voice = !state.voice;
      ui.voiceBtn.textContent = state.voice ? 'Voice On' : 'Voice Off';
      ui.voiceBtn.dataset.active = state.voice ? 'on' : 'off';
    });
    ui.voiceBtn.textContent = 'Voice Off';
  }

  if (ui.chatInput && ui.chatLog) {
    ui.chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = ui.chatInput.value.trim();
        if (!text) return;
        sendChat(text);
        ui.chatInput.value = '';
      }
    });
  }

  addEventListener('keydown', onKeyDown, { passive: false });
  addEventListener('keyup', onKeyUp, { passive: false });
  addEventListener('blur', () => {
    keys.clear();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !state.paused && !state.over) {
      togglePause(true);
    }
  });

  let raf = 0;
  function gameLoop() {
    if (!state.running) return;
    if (!state.paused && !state.over) update();
    draw();
    raf = requestAnimationFrame(gameLoop);
  }

  function start() {
    if (state.running) {
      state.paused = false;
      state.over = false;
      hideOverlay();
      return;
    }
    state.running = true;
    state.paused = false;
    state.over = false;
    hideOverlay();
    gameLoop();
  }

  function restartGame() {
    state.score = 0;
    state.power = null;
    state.shield = 0;
    state.turretCharges = 0;
    state.wallCharges = 0;
    state.tick = 0;
    player.x = W * 0.2;
    player.y = H * 0.5;
    player.vx = 0;
    player.vy = 0;
    player.hp = player.maxHp;
    player.cd = 0;
    player.shield = 0;
    bullets.length = 0;
    enemies.length = 0;
    powerUps.length = 0;
    defenses.length = 0;
    updateScore(0);
    updatePowerDisplay();
    updateShieldDisplay();
    hideOverlay();
    state.paused = false;
    state.over = false;
  }

  function endGame() {
    if (state.over) return;
    state.over = true;
    state.paused = true;
    const message = `Score: ${state.score}\nBest: ${state.best}`;
    showOverlay('Mission Failed', message);
    state.lastShareMessage = `I scored ${state.score} in Space Shooter!`;
  }

  function togglePause(forcePause) {
    if (!state.running) return;
    if (state.over) return;
    const shouldPause = forcePause !== undefined ? forcePause : !state.paused;
    state.paused = shouldPause;
    if (shouldPause) {
      showOverlay('Paused', 'Press P to resume or R to restart');
    } else {
      hideOverlay();
    }
  }

  function onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
      return;
    }
    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      togglePause();
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      restartGame();
      return;
    }
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      deployDefense('turret');
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      deployDefense('wall');
      return;
    }
    keys.add(e.key);
  }

  function onKeyUp(e) {
    keys.delete(e.key);
  }

  function update() {
    state.tick++;
    player.vx = 0;
    player.vy = 0;
    if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) player.vx += 1;
    if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) player.vx -= 1;
    if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) player.vy += 1;
    if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) player.vy -= 1;

    const len = Math.hypot(player.vx, player.vy) || 1;
    player.x = Math.max(player.r, Math.min(W - player.r, player.x + (player.vx / len) * player.speed));
    player.y = Math.max(player.r, Math.min(H - player.r, player.y + (player.vy / len) * player.speed));

    const firePressed = keys.has(' ') || keys.has('Spacebar') || keys.has('Enter');
    player.cd = Math.max(0, player.cd - 1);
    const currentCooldown = state.power && state.power.type === 'rapid' ? 4 : player.baseCooldown;
    if (firePressed && player.cd === 0) {
      shootPlayerBullets();
      player.cd = currentCooldown;
    }

    spawnEnemies();
    updateBullets();
    updateEnemies();
    updatePowerUps();
    updateDefenses();
    updatePowerTimer();
    updateRemotePlayers();

    if (player.hp <= 0) {
      endGame();
    }

    if (state.net && state.room && state.tick % 12 === 0) {
      state.net.syncPlayer({
        room: state.room,
        id: player.id,
        name: player.name,
        x: player.x,
        y: player.y,
        hp: player.hp,
        shield: player.shield,
        score: state.score,
        timestamp: Date.now()
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0e1119';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    for (let i = 0; i < H; i += 40) {
      ctx.beginPath();
      ctx.moveTo(0, i + (state.tick % 40));
      ctx.lineTo(W, i + (state.tick % 40));
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = '#38bdf8';
    for (const other of otherPlayers.values()) {
      if (typeof other.x !== 'number' || typeof other.y !== 'number') continue;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(other.x, other.y, player.r * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(other.name || `Ally ${other.id.slice(-3)}`, other.x, other.y - (player.r + 12));
    }

    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fill();

    if (player.shield > 0) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#93c5fd';
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#f87171';
    for (const e of enemies) {
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const d of defenses) {
      if (d.type === 'turret') {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(d.x, d.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fde68a';
        ctx.fillRect(d.x + 8, d.y - 3, 12, 6);
      } else if (d.type === 'wall') {
        ctx.fillStyle = '#a78bfa';
        ctx.fillRect(d.x - d.w / 2, d.y - d.h / 2, d.w, d.h);
      }
    }

    for (const p of powerUps) {
      ctx.fillStyle = powerColor(p.type);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#fff';
    ctx.font = '16px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`Score: ${state.score}`, 16, 26);
    ctx.fillText(`HP: ${player.hp}`, 16, 48);
    if (state.room) {
      ctx.font = '14px system-ui';
      ctx.fillText(`Room: ${state.room}`, 16, 68);
    }
  }

  function spawnEnemies() {
    const delay = Math.max(28, 60 - Math.floor(state.tick / 240));
    if (state.tick % delay === 0) {
      const y = 20 + Math.random() * (H - 40);
      const speed = 2 + Math.random() * (1 + state.tick / 1800);
      enemies.push({
        x: W + 20,
        y,
        vx: -speed,
        r: 12,
        hp: 1 + Math.floor(state.tick / 1800)
      });
    }
  }

  function updateBullets() {
    for (const b of bullets) {
      b.x += b.vx;
      b.y += b.vy;
    }
    for (let i = bullets.length - 1; i >= 0; i--) {
      if (bullets[i].x > W + 30 || bullets[i].x < -30 || bullets[i].y < -30 || bullets[i].y > H + 30) {
        bullets.splice(i, 1);
      }
    }
  }

  function updateEnemies() {
    for (const e of enemies) {
      e.x += e.vx;
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.x < -40) {
        enemies.splice(i, 1);
        continue;
      }

      if (distance(player.x, player.y, e.x, e.y) < e.r + player.r) {
        enemies.splice(i, 1);
        if (player.shield > 0) {
          player.shield--;
          updateShieldDisplay();
        } else {
          player.hp = Math.max(0, player.hp - 1);
        }
        continue;
      }

      for (let j = bullets.length - 1; j >= 0; j--) {
        const b = bullets[j];
        if (!b.friendly) continue;
        if (distance(e.x, e.y, b.x, b.y) < e.r + b.r) {
          bullets.splice(j, 1);
          e.hp--;
          if (e.hp <= 0) {
            enemies.splice(i, 1);
            onEnemyDestroyed(e);
          }
          break;
        }
      }

      for (const d of defenses) {
        if (d.type === 'wall' && aabbCircleCollision(d, e)) {
          enemies.splice(i, 1);
          d.hp--;
          if (d.hp <= 0) removeDefense(d);
          onEnemyDestroyed(e);
          break;
        }
      }
    }
  }

  function updateDefenses() {
    for (let i = defenses.length - 1; i >= 0; i--) {
      const d = defenses[i];
      if (d.type === 'turret') {
        d.timer--;
        d.cooldown = Math.max(0, d.cooldown - 1);
        if (d.cooldown === 0 && enemies.length) {
          const target = enemies.reduce((prev, curr) => (curr.x < prev.x ? curr : prev), enemies[0]);
          const angle = Math.atan2(target.y - d.y, target.x - d.x);
          bullets.push({
            x: d.x + Math.cos(angle) * 12,
            y: d.y + Math.sin(angle) * 12,
            vx: Math.cos(angle) * 8,
            vy: Math.sin(angle) * 8,
            r: 3,
            friendly: true
          });
          d.cooldown = 30;
        }
        if (d.timer <= 0) {
          defenses.splice(i, 1);
        }
      }
      if (d.type === 'wall') {
        d.timer--;
        if (d.timer <= 0 || d.hp <= 0) {
          defenses.splice(i, 1);
        }
      }
    }
  }

  function updatePowerUps() {
    for (const p of powerUps) {
      p.t++; 
      p.y += Math.sin(p.t / 15) * 0.4;
    }

    for (let i = powerUps.length - 1; i >= 0; i--) {
      const p = powerUps[i];
      if (distance(player.x, player.y, p.x, p.y) < player.r + p.r + 4) {
        powerUps.splice(i, 1);
        applyPowerUp(p.type);
        continue;
      }
      if (p.t > p.ttl) {
        powerUps.splice(i, 1);
      }
    }
  }

  function updatePowerTimer() {
    if (!state.power) return;
    state.power.timer--;
    if (state.power.timer <= 0) {
      state.power = null;
      updatePowerDisplay();
      return;
    }
    if (state.power.timer % 30 === 0) {
      updatePowerDisplay();
    }
  }

  function updateRemotePlayers() {
    const now = performance.now();
    for (const [id, remote] of otherPlayers) {
      if (remote.room && remote.room !== state.room) {
        otherPlayers.delete(id);
        continue;
      }
      if (now - remote.lastSeen > 7000) {
        otherPlayers.delete(id);
      }
    }
  }

  function shootPlayerBullets() {
    const base = {
      x: player.x + player.r + 2,
      y: player.y,
      vx: 10,
      vy: 0,
      r: 3,
      friendly: true
    };
    const bulletsToAdd = [];
    if (state.power && state.power.type === 'spread') {
      bulletsToAdd.push({ ...base, vy: -1.5, vx: 9 });
      bulletsToAdd.push(base);
      bulletsToAdd.push({ ...base, vy: 1.5, vx: 9 });
    } else {
      bulletsToAdd.push(base);
    }
    bullets.push(...bulletsToAdd);
  }

  function onEnemyDestroyed(enemy) {
    updateScore(state.score + 1);
    if (Math.random() < 0.25) {
      const type = POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)];
      powerUps.push({
        x: enemy.x,
        y: enemy.y,
        r: 8,
        type,
        ttl: 900,
        t: 0
      });
    }
  }

  function applyPowerUp(type) {
    switch (type) {
      case 'rapid':
        state.power = { type: 'rapid', timer: 600, duration: 600 };
        updatePowerDisplay();
        break;
      case 'spread':
        state.power = { type: 'spread', timer: 480, duration: 480 };
        updatePowerDisplay();
        break;
      case 'shield':
        player.shield = Math.min(player.shield + 3, 5);
        updateShieldDisplay();
        state.power = { type: 'shield', timer: 180, duration: 180 };
        updatePowerDisplay();
        break;
      case 'turret':
        state.turretCharges = Math.min(state.turretCharges + 1, 3);
        updatePowerDisplay();
        break;
      case 'wall':
        state.wallCharges = Math.min(state.wallCharges + 1, 3);
        updatePowerDisplay();
        break;
      default:
        break;
    }
  }

  function deployDefense(type) {
    if (type === 'turret') {
      if (state.turretCharges <= 0) return;
      state.turretCharges--;
      defenses.push({
        type: 'turret',
        x: player.x + player.r + 8,
        y: player.y,
        timer: 600,
        cooldown: 0
      });
      updatePowerDisplay();
      return;
    }
    if (type === 'wall') {
      if (state.wallCharges <= 0) return;
      state.wallCharges--;
      defenses.push({
        type: 'wall',
        x: player.x + 40,
        y: player.y,
        w: 14,
        h: 68,
        hp: 3,
        timer: 720
      });
      updatePowerDisplay();
    }
  }

  function removeDefense(defense) {
    const idx = defenses.indexOf(defense);
    if (idx >= 0) defenses.splice(idx, 1);
  }

  function updateScore(value) {
    state.score = value;
    if (ui.score) ui.score.textContent = String(state.score);
    if (state.score > state.best) {
      updateBest(state.score);
    }
  }

  function updateBest(value) {
    state.best = value;
    if (ui.best) ui.best.textContent = String(state.best);
    try {
      localStorage.setItem(BEST_KEY, String(state.best));
    } catch (err) {
      console.warn('[shooter] unable to persist best score', err);
    }
  }

  function updatePowerDisplay() {
    if (!ui.power) return;
    const parts = [];
    if (state.power) {
      const seconds = Math.max(1, Math.ceil(state.power.timer / 60));
      const label = state.power.type === 'rapid'
        ? 'Rapid'
        : state.power.type === 'spread'
          ? 'Spread'
          : state.power.type === 'shield'
            ? 'Shield+' : state.power.type;
      parts.push(`${label} (${seconds}s)`);
    }
    if (state.turretCharges) parts.push(`Turrets ${state.turretCharges}`);
    if (state.wallCharges) parts.push(`Walls ${state.wallCharges}`);
    ui.power.textContent = parts.length ? parts.join(' • ') : 'None';
  }

  function updateShieldDisplay() {
    state.shield = player.shield;
    if (ui.shield) ui.shield.textContent = String(player.shield);
  }

  function showOverlay(title, info) {
    if (!ui.overlay) return;
    ui.overTitle.textContent = title;
    ui.overInfo.textContent = info;
    ui.overlay.classList.add('show');
  }

  function hideOverlay() {
    if (!ui.overlay) return;
    ui.overlay.classList.remove('show');
  }

  function joinRoom() {
    if (!ui.roomInput) return;
    const name = ui.roomInput.value.trim();
    if (!name) return;
    if (state.room === name) return;
    state.room = name;
    if (ui.chatInput) {
      ui.chatInput.disabled = false;
      ui.chatInput.placeholder = `Chat in ${name}`;
    }
    openChatChannel(name);
    otherPlayers.clear();
    postSystemMessage(`Joined room “${name}”`);
  }

  function leaveRoom() {
    if (!state.room) return;
    postSystemMessage(`Left room “${state.room}”`);
    state.room = null;
    otherPlayers.clear();
    closeChatChannel();
    if (ui.chatInput) {
      ui.chatInput.disabled = true;
      ui.chatInput.placeholder = 'Join a room to chat';
    }
  }

  function openChatChannel(name) {
    closeChatChannel();
    if (!('BroadcastChannel' in window)) {
      postSystemMessage('Multiplayer sync unavailable in this browser');
      return;
    }
    chatChannel = new BroadcastChannel(`shooter-room-${name}`);
    chatChannel.addEventListener('message', handleChatMessage);
  }

  function closeChatChannel() {
    if (!chatChannel) return;
    chatChannel.removeEventListener('message', handleChatMessage);
    chatChannel.close();
    chatChannel = null;
  }

  function sendChat(text) {
    if (!state.room) {
      postSystemMessage('Join a room to chat');
      return;
    }
    const message = {
      room: state.room,
      from: player.id,
      name: player.name,
      text,
      time: Date.now()
    };
    handleChatMessage({ data: message });
    if (chatChannel && state.room) {
      chatChannel.postMessage(message);
    }
  }

  function handleChatMessage(event) {
    const payload = event.data;
    if (!payload || payload.room !== state.room) return;
    const label = payload.from === player.id ? 'You' : (payload.name || 'Ally');
    addChatLine(`${label}: ${payload.text}`);
    if (payload.from !== player.id) {
      otherPlayers.set(payload.from, {
        ...(otherPlayers.get(payload.from) || {}),
        id: payload.from,
        name: payload.name,
        lastSeen: performance.now()
      });
    }
  }

  function addChatLine(text) {
    if (!ui.chatLog) return;
    const div = document.createElement('div');
    div.textContent = text;
    ui.chatLog.appendChild(div);
    while (ui.chatLog.childNodes.length > 20) {
      ui.chatLog.removeChild(ui.chatLog.firstChild);
    }
    ui.chatLog.scrollTop = ui.chatLog.scrollHeight;
  }

  function postSystemMessage(text) {
    addChatLine(`• ${text}`);
  }

  function handleShare() {
    const message = state.lastShareMessage || `I'm playing Space Shooter! Score: ${state.score}`;
    if (navigator.share) {
      navigator.share({ title: 'Space Shooter', text: message, url: location.href }).catch(() => {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(`${message}\n${location.href}`).then(() => {
        postSystemMessage('Share text copied to clipboard');
      }).catch(() => {
        postSystemMessage('Unable to copy share text');
      });
      return;
    }
    postSystemMessage(message);
  }

  function distance(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2);
  }

  function powerColor(type) {
    switch (type) {
      case 'rapid': return '#0ea5e9';
      case 'spread': return '#f472b6';
      case 'shield': return '#22c55e';
      case 'turret': return '#facc15';
      case 'wall': return '#8b5cf6';
      default: return '#fff';
    }
  }

  function aabbCircleCollision(box, circle) {
    const closestX = clamp(circle.x, box.x - box.w / 2, box.x + box.w / 2);
    const closestY = clamp(circle.y, box.y - box.h / 2, box.y + box.h / 2);
    return distance(circle.x, circle.y, closestX, closestY) < circle.r + 1;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  restartGame();
  start();

  addEventListener('beforeunload', () => {
    cancelAnimationFrame(raf);
    closeChatChannel();
  });
}
