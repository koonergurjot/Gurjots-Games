// Minimal playable Pong (canvas id='game')
let previousCleanup;

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 540;

function reportFatal(message) {
  console.error(`[pong] ${message}`);
  try {
    window.DIAG?.error?.(message);
  } catch (err) {
    // Ignore diagnostics reporting failures.
  }
  try {
    window.parent?.postMessage?.({ type: 'GAME_ERROR', message }, '*');
  } catch (err) {
    // Ignore failures to notify parent window.
  }
}

function resolveCanvas() {
  const gameEl = document.getElementById('game');
  if (gameEl instanceof HTMLCanvasElement) return gameEl;

  const fallback = document.getElementById('gameCanvas');
  if (fallback instanceof HTMLCanvasElement) return fallback;

  const stage = document.getElementById('stage');
  if (stage) {
    const stageCanvas = stage instanceof HTMLCanvasElement ? stage : stage.querySelector('canvas');
    if (stageCanvas instanceof HTMLCanvasElement) return stageCanvas;
  }

  return undefined;
}

function createCanvas() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = DEFAULT_WIDTH;
    canvas.height = DEFAULT_HEIGHT;
    if (!document.getElementById('game')) {
      canvas.id = 'game';
    }
    const target = document.getElementById('stage') || document.body;
    if (!target) return undefined;
    target.appendChild(canvas);
    return canvas;
  } catch (err) {
    return undefined;
  }
}

export function boot(configOverrides = {}) {
  if (typeof previousCleanup === 'function') {
    previousCleanup();
    previousCleanup = undefined;
  }

  let canvas = resolveCanvas();
  if (!(canvas instanceof HTMLCanvasElement)) {
    canvas = createCanvas();
  }

  if (!(canvas instanceof HTMLCanvasElement)) {
    reportFatal('unable to locate or create a canvas element for rendering');
    return;
  }

  canvas.width = canvas.width || DEFAULT_WIDTH;
  canvas.height = canvas.height || DEFAULT_HEIGHT;

  const ctx = canvas.getContext?.('2d');
  if (!ctx) {
    reportFatal('canvas 2D context is unavailable');
    return;
  }
  const W = canvas.width, H = canvas.height;

  const paddleW = 14, paddleH = Math.floor(H * 0.2);
  const ballR = 8;
  const speed = Math.max(4, Math.floor(W / 240));

  const left = { x: 24, y: (H - paddleH) / 2, vy: 0, score: 0 };
  const right = { x: W - 24 - paddleW, y: (H - paddleH) / 2, vy: 0, score: 0 };
  const ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };

  const keys = new Set();
  let paused = false;
  let servePending = true;
  let serveDirection = 1;
  let overlayNeedsDraw = true;
  let matchOver = false;
  let pauseRequested = false;
  let winner = null;
  let testHooks;

  const difficultyPresets = {
    off: { label: '2P (Manual)', reactionFrames: 0, maxSpeed: speed * 1.1 },
    easy: { label: 'Easy AI', reactionFrames: 18, maxSpeed: speed * 0.85 },
    normal: { label: 'Normal AI', reactionFrames: 9, maxSpeed: speed * 1.05 },
    hard: { label: 'Hard AI', reactionFrames: 4, maxSpeed: speed * 1.35 },
  };
  const difficultyOrder = ['off', 'easy', 'normal', 'hard'];
  const searchParams = (() => {
    try {
      return new URLSearchParams(window.location?.search || '');
    } catch (err) {
      return new URLSearchParams();
    }
  })();

  function parseTargetScore(value) {
    const num = Number.parseInt(value, 10);
    if (!Number.isFinite(num) || num <= 0) return undefined;
    return num;
  }

  function parseBoolean(value) {
    if (value === undefined || value === null) return undefined;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return undefined;
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return undefined;
  }

  const defaultMatchConfig = {
    targetScore: 11,
    winByTwo: false,
  };

  const matchConfig = {
    targetScore:
      parseTargetScore(configOverrides.targetScore) ||
      parseTargetScore(searchParams.get('to') || searchParams.get('target') || searchParams.get('score')) ||
      defaultMatchConfig.targetScore,
    winByTwo:
      parseBoolean(configOverrides.winByTwo) ??
      parseBoolean(searchParams.get('winbytwo') || searchParams.get('win-by-two')) ??
      defaultMatchConfig.winByTwo,
  };

  function normalizeDifficulty(value) {
    if (!value) return 'off';
    const key = String(value).toLowerCase();
    if (difficultyPresets[key]) return key;
    if (key === '1p' || key === 'single' || key === 'solo' || key === 'cpu') return 'normal';
    if (key === 'easy' || key === '1') return 'easy';
    if (key === 'normal' || key === 'medium' || key === '2') return 'normal';
    if (key === 'hard' || key === '3') return 'hard';
    return 'off';
  }

  let aiMode = normalizeDifficulty(searchParams.get('cpu') || searchParams.get('ai'));
  let aiCooldown = 0;
  let aiTargetY = right.y + paddleH / 2;

  function setAiMode(nextMode) {
    const normalized = normalizeDifficulty(nextMode);
    if (normalized === aiMode) return;
    aiMode = normalized;
    aiCooldown = 0;
    aiTargetY = right.y + paddleH / 2;
    overlayNeedsDraw = true;
  }

  function cycleDifficulty(direction = 1) {
    const currentIndex = Math.max(0, difficultyOrder.indexOf(aiMode));
    const nextIndex = (currentIndex + direction + difficultyOrder.length) % difficultyOrder.length;
    setAiMode(difficultyOrder[nextIndex]);
  }

  function awaitServe(direction = serveDirection) {
    servePending = true;
    serveDirection = direction;
    ball.x = W / 2;
    ball.y = H / 2;
    ball.vx = 0;
    ball.vy = 0;
    left.vy = 0;
    right.vy = 0;
    overlayNeedsDraw = true;
  }

  function resetBall(direction = serveDirection) {
    servePending = false;
    serveDirection = direction;
    ball.x = W / 2;
    ball.y = H / 2;
    ball.vx = direction * speed;
    ball.vy = (Math.random() * 2 - 1) * speed;
    overlayNeedsDraw = true;
  }

  function hasPlayerWon(score, opponentScore) {
    if (score < matchConfig.targetScore) return false;
    if (matchConfig.winByTwo && score - opponentScore < 2) return false;
    return true;
  }

  function concludeMatch(side) {
    matchOver = true;
    winner = side;
    pauseRequested = true;
    awaitServe(side === 'left' ? 1 : -1);
    overlayNeedsDraw = true;
  }

  function handleScore(side) {
    if (matchOver) return;
    const scoring = side === 'left' ? left : right;
    const opponent = side === 'left' ? right : left;
    const nextServeDirection = side === 'left' ? 1 : -1;
    scoring.score += 1;
    overlayNeedsDraw = true;
    if (hasPlayerWon(scoring.score, opponent.score)) {
      concludeMatch(side);
      return;
    }
    awaitServe(nextServeDirection);
  }

  function startNewMatch() {
    const nextServeDirection = winner === 'left' ? -1 : 1;
    left.score = 0;
    right.score = 0;
    matchOver = false;
    pauseRequested = false;
    paused = false;
    winner = null;
    awaitServe(nextServeDirection);
    overlayNeedsDraw = true;
  }

  awaitServe(serveDirection);

  function handleKeydown(e) {
    const key = e.key;

    if (matchOver) {
      if (key === ' ' || key === 'Space' || key === 'Enter') {
        e.preventDefault();
        startNewMatch();
        return;
      }
      if (key === 'p' || key === 'P' || key === 'Escape') {
        e.preventDefault();
        return;
      }
    }

    if (key === 'p' || key === 'P' || key === 'Escape') {
      e.preventDefault();
      paused = !paused;
      if (paused) {
        left.vy = 0;
        right.vy = 0;
      }
      overlayNeedsDraw = true;
      return;
    }

    if ((key === ' ' || key === 'Space' || key === 'Enter') && servePending && !paused) {
      e.preventDefault();
      resetBall(serveDirection);
      return;
    }

    if (key === ' ' || key === 'Space' || key === 'ArrowUp' || key === 'ArrowDown') {
      e.preventDefault();
    }

    if (key === '0') {
      setAiMode('off');
      return;
    }

    if (key === '1') {
      setAiMode('easy');
      return;
    }

    if (key === '2') {
      setAiMode('normal');
      return;
    }

    if (key === '3') {
      setAiMode('hard');
      return;
    }

    if (key === 'c' || key === 'C') {
      cycleDifficulty(1);
      return;
    }

    keys.add(key);
  }

  function handleKeyup(e) {
    keys.delete(e.key);
  }

  addEventListener('keydown', handleKeydown);
  addEventListener('keyup', handleKeyup);

  function update() {
    if (servePending) return;

    left.vy = (keys.has('w')||keys.has('W') ? -speed*1.1 : 0) + (keys.has('s')||keys.has('S') ? speed*1.1 : 0);

    const aiPreset = difficultyPresets[aiMode] || difficultyPresets.off;
    const aiActive = aiMode !== 'off';

    if (aiActive) {
      if (aiCooldown <= 0) {
        aiTargetY = ball.y;
        aiCooldown = aiPreset.reactionFrames;
      } else {
        aiCooldown -= 1;
      }
      const paddleCenter = right.y + paddleH / 2;
      const delta = aiTargetY - paddleCenter;
      const direction = Math.sign(delta);
      const magnitude = Math.min(Math.abs(delta), aiPreset.maxSpeed);
      right.vy = direction * magnitude;
    } else {
      right.vy = (keys.has('ArrowUp')?-speed*1.1:0) + (keys.has('ArrowDown')?speed*1.1:0);
    }

    left.y = Math.max(0, Math.min(H - paddleH, left.y + left.vy));
    right.y = Math.max(0, Math.min(H - paddleH, right.y + right.vy));

    ball.x += ball.vx; ball.y += ball.vy;
    if (ball.y - ballR < 0 && ball.vy < 0) { ball.y = ballR; ball.vy *= -1; }
    if (ball.y + ballR > H && ball.vy > 0) { ball.y = H - ballR; ball.vy *= -1; }

    const hitLeft = (ball.x - ballR <= left.x + paddleW) && (ball.y >= left.y && ball.y <= left.y + paddleH) && (ball.vx < 0);
    const hitRight = (ball.x + ballR >= right.x) && (ball.y >= right.y && ball.y <= right.y + paddleH) && (ball.vx > 0);

    if (hitLeft || hitRight) {
      ball.vx *= -1.05;
      const p = hitLeft ? left : right;
      const rel = ((ball.y - (p.y + paddleH / 2)) / (paddleH / 2));
      ball.vy = Math.max(-speed * 1.5, Math.min(speed * 1.5, ball.vy + rel * speed));
      if (hitLeft)  ball.x = left.x + paddleW + ballR + 1;
      if (hitRight) ball.x = right.x - ballR - 1;
    }

    if (ball.x < -ballR) { handleScore('right'); }
    if (ball.x > W + ballR) { handleScore('left'); }
  }

  function draw() {
    ctx.clearRect(0,0,W,H);
    ctx.globalAlpha = 0.15; ctx.fillStyle = '#000';
    for (let y=0;y<H;y+=24) ctx.fillRect(W/2-2,y,4,12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#222';
    ctx.fillRect(left.x,left.y,paddleW,paddleH);
    ctx.fillRect(right.x,right.y,paddleW,paddleH);
    ctx.beginPath(); ctx.arc(ball.x,ball.y,ballR,0,Math.PI*2); ctx.fill();
    ctx.font = 'bold 36px system-ui, sans-serif'; ctx.textAlign='center';
    ctx.fillText(String(left.score), W*0.25, 48);
    ctx.fillText(String(right.score), W*0.75, 48);
  }

  function drawPauseOverlay() {
    if (!paused || matchOver) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 48px system-ui, sans-serif';
    ctx.fillText('Paused', W/2, H/2 - 32);
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillText('Press P or Esc to resume', W/2, H/2 + 16);
    ctx.restore();
  }

  function drawServePrompt() {
    if (!servePending || matchOver) return;
    ctx.save();
    const message = paused ? 'Serve ready: press Space or Enter' : 'Press Space or Enter to serve';
    ctx.font = '24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textY = paused ? H / 2 + 72 : H * 0.65;
    const metrics = ctx.measureText(message);
    const padding = 18;
    const boxWidth = metrics.width + padding * 2;
    const boxHeight = 42;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(W / 2 - boxWidth / 2, textY - boxHeight / 2, boxWidth, boxHeight);
    ctx.fillStyle = '#fff';
    ctx.fillText(message, W / 2, textY);
    ctx.restore();
  }

  function drawInstructionsOverlay() {
    const lines = [
      `Match: first to ${matchConfig.targetScore}${matchConfig.winByTwo ? ' (win by 2)' : ''}`,
      'Left paddle: W / S',
      aiMode === 'off' ? 'Right paddle: Arrow keys (2P mode)' : `Right paddle: ${difficultyPresets[aiMode]?.label || 'AI'}`,
      'Press 1/2/3 for Easy/Normal/Hard AI, 0 for 2P, C to cycle',
      'After a win, press Space or Enter to start a new match',
      'URL ?cpu=easy|normal|hard starts with AI enabled',
    ];
    const padding = 10;
    const lineHeight = 20;
    ctx.save();
    ctx.font = '16px system-ui, sans-serif';
    const maxWidth = lines.reduce((acc, line) => Math.max(acc, ctx.measureText(line).width), 0);
    const boxWidth = Math.ceil(maxWidth + padding * 2);
    const boxHeight = padding * 2 + lineHeight * lines.length;
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(12, 12, boxWidth, boxHeight);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, index) => {
      ctx.fillText(line, 12 + padding, 12 + padding + index * lineHeight);
    });
    ctx.restore();
  }

  function drawVictoryOverlay() {
    if (!matchOver) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const winnerLabel = winner === 'left' ? 'Player 1' : 'Player 2';
    ctx.font = 'bold 56px system-ui, sans-serif';
    ctx.fillText(`${winnerLabel} wins!`, W / 2, H / 2 - 40);
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillText('Press Space or Enter to start a new match', W / 2, H / 2 + 12);
    ctx.restore();
  }

  function drawOverlay() {
    drawInstructionsOverlay();
    drawPauseOverlay();
    drawServePrompt();
    drawVictoryOverlay();
  }

  let raf;
  let readyNotified = false;
  function notifyReady() {
    if (readyNotified) return;
    readyNotified = true;
    try {
      window.DIAG?.ready?.();
    } catch (err) {
      // Ignore errors from diagnostics hooks.
    }
    try {
      window.parent?.postMessage?.({ type: 'GAME_READY' }, '*');
    } catch (err) {
      // Ignore failures to notify parent window.
    }
  }

  function loop(){
    if (!paused) {
      update();
      draw();
      if (pauseRequested) {
        paused = true;
        pauseRequested = false;
      }
      drawOverlay();
      overlayNeedsDraw = true;
    } else if (overlayNeedsDraw) {
      drawOverlay();
      overlayNeedsDraw = false;
    }
    notifyReady();
    raf = requestAnimationFrame(loop);
  }
  loop();

  const handleUnload = () => cleanup();
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', handleKeydown);
    removeEventListener('keyup', handleKeyup);
    removeEventListener('beforeunload', handleUnload);
    if (typeof window !== 'undefined' && window.__pongTest === testHooks) {
      delete window.__pongTest;
    }
  }

  testHooks = {
    config: matchConfig,
    handleScore,
    startNewMatch,
    getState: () => ({
      leftScore: left.score,
      rightScore: right.score,
      servePending,
      paused: paused || pauseRequested,
      matchOver,
      winner,
    }),
    cleanup,
  };

  if (typeof window !== 'undefined') {
    window.__pongTest = testHooks;
  }

  addEventListener('beforeunload', handleUnload);
  previousCleanup = cleanup;
}

if (typeof window !== 'undefined') {
  const start = () => boot();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
