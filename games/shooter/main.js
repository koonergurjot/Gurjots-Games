// Minimal top-down shooter (canvas id='game')
export function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) return console.error('[shooter] missing #game canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.width || 960;
  canvas.height = canvas.height || 540;
  const W = canvas.width, H = canvas.height;

  const player = { x: W*0.2, y: H*0.5, r: 12, vx: 0, vy: 0, speed: 5, hp: 3, cd: 0 };
  const bullets = [];
  const enemies = [];
  let t = 0, score = 0;

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
  }

  let raf; function loop(){ update(); draw(); if (player.hp>0) raf=requestAnimationFrame(loop); else gameOver(); } loop();
  function gameOver(){
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#fff'; ctx.font='bold 48px system-ui'; ctx.textAlign='center';
    ctx.fillText('Game Over', W/2, H/2 - 10);
    ctx.font='24px system-ui';
    ctx.fillText(`Score: ${score}`, W/2, H/2 + 26);
  }
  addEventListener('beforeunload', ()=>cancelAnimationFrame(raf));
}
