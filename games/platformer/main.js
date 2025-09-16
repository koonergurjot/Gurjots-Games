// Minimal platformer (canvas id='game')
export function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) return console.error('[platformer] missing #game canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.width || 960;
  canvas.height = canvas.height || 540;
  const W = canvas.width, H = canvas.height;

  const GRAV = 0.7, MOVE = 4, JUMP = 13;
  const groundY = H - 60;
  const player = { x: 100, y: groundY - 40, w: 28, h: 40, vx: 0, vy: 0, onGround: true };
  const platforms = [
    { x: 0, y: groundY, w: W, h: 60 },
    { x: 240, y: groundY - 120, w: 140, h: 14 },
    { x: 520, y: groundY - 200, w: 160, h: 14 },
    { x: 760, y: groundY - 80, w: 120, h: 14 }
  ];

  const keys = new Set();
  addEventListener('keydown', e => keys.add(e.key));
  addEventListener('keyup', e => keys.delete(e.key));

  function aabb(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }

  function update(){
    // horizontal
    player.vx = 0;
    if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) player.vx = -MOVE;
    if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) player.vx = MOVE;

    // jump
    if ((keys.has(' ') || keys.has('Spacebar') || keys.has('ArrowUp') || keys.has('w') || keys.has('W')) && player.onGround) {
      player.vy = -JUMP;
      player.onGround = false;
    }

    // gravity
    player.vy += GRAV;

    // integrate
    player.x += player.vx;
    player.y += player.vy;

    // collisions
    player.onGround = false;
    for (const p of platforms){
      if (!aabb(player,p)) continue;
      // resolve vertically first
      const prevY = player.y - player.vy;
      if (prevY + player.h <= p.y && player.vy > 0){
        player.y = p.y - player.h; player.vy = 0; player.onGround = true;
      } else if (prevY >= p.y + p.h && player.vy < 0){
        player.y = p.y + p.h; player.vy = 0;
      } else {
        // horizontal resolve
        if (player.vx > 0) player.x = p.x - player.w;
        if (player.vx < 0) player.x = p.x + p.w;
      }
    }

    // bounds
    if (player.x < 0) player.x = 0;
    if (player.x + player.w > W) player.x = W - player.w;
    if (player.y + player.h > H) { player.y = H - player.h; player.vy = 0; player.onGround = true; }
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    // bg
    ctx.fillStyle = '#eef6ff'; ctx.fillRect(0,0,W,H);
    // platforms
    ctx.fillStyle = '#7aa2ff';
    for (const p of platforms) ctx.fillRect(p.x,p.y,p.w,p.h);
    // player
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(player.x,player.y,player.w,player.h);
    // HUD
    ctx.fillStyle='#000'; ctx.font='14px system-ui';
    ctx.fillText('←/→ or A/D to move, Space/↑ to jump', 16, 24);
  }

  let raf; function loop(){ update(); draw(); raf = requestAnimationFrame(loop); } loop();
  addEventListener('beforeunload', ()=>cancelAnimationFrame(raf));
}
