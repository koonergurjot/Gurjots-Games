// Minimal top-down shooter (canvas id='game')
export function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) return console.error('[shooter] missing #game canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.width || 960;
  canvas.height = canvas.height || 540;
  const W = canvas.width, H = canvas.height;
  let postedReady = false;

  const player = { x: W*0.2, y: H*0.5, r: 12, vx: 0, vy: 0, speed: 5, hp: 3, cd: 0 };
  const bullets = [];
  const enemies = [];
  let t = 0, score = 0;
  const scoreElement = document.getElementById('score');
  const scoreDisplay = document.getElementById('scoreDisplay');

  const keys = new Set();
  addEventListener('keydown', e => keys.add(e.key));
  addEventListener('keyup', e => keys.delete(e.key));

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
    }

    // spawn enemies
    if (t % 45 === 0){
      const y = 20 + Math.random()*(H-40);
      enemies.push({ x: W+20, y, vx: - (2 + Math.random()*2), r: 10 });
    }

    // move bullets & enemies
    for (const b of bullets){ b.x += b.vx; }
    for (const e of enemies){ e.x += e.vx; }

    // collisions & culling
    for (let i=enemies.length-1;i>=0;i--){
      const e = enemies[i];
      if (e.x < -30) { enemies.splice(i,1); continue; }
      // hit player?
      if (Math.hypot(e.x-player.x, e.y-player.y) < e.r + player.r){
        enemies.splice(i,1);
        player.hp--;
      }
      // bullets hit
      for (let j=bullets.length-1;j>=0;j--){
        const b = bullets[j];
        if (Math.hypot(e.x-b.x, e.y-b.y) < e.r + b.r){
          enemies.splice(i,1); bullets.splice(j,1);
          score++;
          break;
        }
      }
    }
    for (let i=bullets.length-1;i>=0;i--){
      if (bullets[i].x > W+30) bullets.splice(i,1);
    }

    t++;
  }

  function draw(){
    if(!postedReady){
      postedReady = true;
      try { window.parent?.postMessage({ type:'GAME_READY', slug:'shooter' }, '*'); } catch {}
    }
    ctx.clearRect(0,0,W,H);
    // bg
    ctx.fillStyle = '#10151a';
    ctx.fillRect(0,0,W,H);
    // player
    ctx.fillStyle = '#4ade80';
    ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, Math.PI*2); ctx.fill();
    // bullets
    ctx.fillStyle = '#93c5fd';
    for (const b of bullets){ ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill(); }
    // enemies
    ctx.fillStyle = '#f87171';
    for (const e of enemies){ ctx.beginPath(); ctx.arc(e.x,e.y,e.r,0,Math.PI*2); ctx.fill(); }
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

  let raf = 0;
  let shellPaused = false;
  let pausedByShell = false;

  function frame(){
    if(shellPaused){ raf = 0; return; }
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

  function startLoop(){ if(!raf && player.hp>0){ raf=requestAnimationFrame(frame); } }

  function stopLoop(){ if(raf){ cancelAnimationFrame(raf); raf=0; } }

  function pauseForShell(){
    if(shellPaused) return;
    if(player.hp<=0){ shellPaused=false; pausedByShell=false; return; }
    shellPaused=true;
    pausedByShell=true;
    stopLoop();
  }

  function resumeFromShell(){
    if(!shellPaused || document.hidden) return;
    shellPaused=false;
    if(pausedByShell && player.hp>0){ pausedByShell=false; startLoop(); }
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

  startLoop();

  function gameOver(){
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#fff'; ctx.font='bold 48px system-ui'; ctx.textAlign='center';
    ctx.fillText('Game Over', W/2, H/2 - 10);
    ctx.font='24px system-ui';
    ctx.fillText(`Score: ${score}`, W/2, H/2 + 26);
  }
  addEventListener('beforeunload', ()=>stopLoop());
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
