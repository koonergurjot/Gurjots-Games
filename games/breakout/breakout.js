const GAME_ID='breakout';GG.incPlays();
const c=document.getElementById('b');fitCanvasToParent(c,1000,800,24);addEventListener('resize',()=>fitCanvasToParent(c,1000,800,24));
const ctx=c.getContext('2d');
let paddle={w:120,h:14,x:c.width/2-60,y:c.height-40};
let ball={x:c.width/2,y:c.height-60,vx:4,vy:-6,r:8,stuck:true,speed:7};
let bricks=[];let score=0,lives=3;let level=1;let bestLevel=parseInt(localStorage.getItem('gg:bestlvl:breakout')||'1');
let paused=false;function togglePause(){paused=!paused}addEventListener('keydown',e=>{if(e.key.toLowerCase()==='p')togglePause()});
function resetLevel(){bricks=[];const layout=LEVELS[(level-1)%LEVELS.length];const pad=20,top=60;const cols=Math.max(...layout.map(r=>r.length));const bw=(c.width-pad*2-(cols-1)*8)/cols;for(let r=0;r<layout.length;r++)for(let i=0;i<layout[r].length;i++){const hp=layout[r][i];if(hp>0)bricks.push({x:pad+i*(bw+8),y:top+r*26,w:bw,h:20,hp})}ball.speed=7+(level-1)*.5}resetLevel();
c.addEventListener('mousemove',e=>{const r=c.getBoundingClientRect();const mx=e.clientX-r.left;paddle.x=Math.max(0,Math.min(c.width-paddle.w,mx-paddle.w/2));if(ball.stuck){ball.x=paddle.x+paddle.w/2}});
c.addEventListener('click',()=>{if(ball.stuck)ball.stuck=false});
addEventListener('keydown',e=>{if(e.key==='ArrowLeft')paddle.x=Math.max(0,paddle.x-24);if(e.key==='ArrowRight')paddle.x=Math.min(c.width-paddle.w,paddle.x+24);if(e.key.toLowerCase()==='r'&&lives<=0){score=0;lives=3;level=1;resetLevel();resetBall()}});
function resetBall(){ball={x:paddle.x+paddle.w/2,y:paddle.y-20,vx:4*(Math.random()<0.5?-1:1),vy:-6,r:8,stuck:true,speed:7}}
let powerups=[];function spawnPU(x,y){const types=['EXPAND','SLOW','MULTI','LASER'];const t=types[(Math.random()*types.length)|0];powerups.push({x,y,v:2,type:t,dead:false})}
function applyPU(p){if(p.type==='EXPAND'){paddle.w=Math.min(paddle.w*1.35,220)}if(p.type==='SLOW'){ball.vx*=0.7;ball.vy*=0.7}if(p.type==='MULTI'){const b1={x:ball.x,y:ball.y,vx:-Math.abs(ball.vx),vy:ball.vy,r:8,stuck:false,speed:ball.speed};const b2={x:ball.x,y:ball.y,vx: Math.abs(ball.vx),vy:-ball.vy,r:8,stuck:false,speed:ball.speed};multiBalls.push(b1,b2)}if(p.type==='LASER'){lasers.push({x:paddle.x+paddle.w*0.25,y:paddle.y,vy:-9});lasers.push({x:paddle.x+paddle.w*0.75,y:paddle.y,vy:-9})}SFX.seq([[900,0.05],[1200,0.06]])}
function updatePU(){powerups.forEach(p=>{p.y+=p.v;if(p.y>c.height)p.dead=true;if(p.y>paddle.y-6&&p.x>paddle.x&&p.x<paddle.x+paddle.w){p.dead=true;applyPU(p)}});powerups=powerups.filter(p=>!p.dead)}
let lasers=[]; let multiBalls=[];
function step(){if(paused)return; if(ball.stuck)return;
  // normalize velocity to maintain constant speed with gradual ramp
  const sp = Math.max(5, ball.speed);
  const len = Math.hypot(ball.vx, ball.vy) || 1;
  ball.vx = ball.vx / len * sp;
  ball.vy = ball.vy / len * sp;
  ball.x+=ball.vx;ball.y+=ball.vy;
  if(ball.x<ball.r||ball.x>c.width-ball.r)ball.vx*=-1; if(ball.y<ball.r)ball.vy*=-1;
  // paddle collision with angle control
  if(ball.y>paddle.y-ball.r&&ball.y<paddle.y+paddle.h+ball.r&&ball.x>paddle.x&&ball.x<paddle.x+paddle.w&&ball.vy>0){
    const rel=(ball.x-(paddle.x+paddle.w/2))/(paddle.w/2); // -1..1
    const maxAng = Math.PI*0.75; // clamp reflection to avoid horizontals
    const ang = (Math.PI*1.5) + rel * (maxAng*0.25);
    ball.vx = Math.cos(ang) * sp;
    ball.vy = Math.sin(ang) * sp;
    ball.speed = Math.min(14, ball.speed + 0.15); // gentle speed ramp
    SFX.beep({freq:520});
  }
  for(const b of bricks){ if(b.hp<=0) continue; if(ball.x>b.x&&ball.x<b.x+b.w&&ball.y>b.y&&ball.y<b.y+b.h){ b.hp=0; score+=10; GG.addXP(1); ball.vy*=-1; if(Math.random()<0.15) spawnPU(ball.x, ball.y); SFX.beep({freq:700}); } }
  if(ball.y>c.height+20){lives--; SFX.seq([[260,0.06],[200,0.08]]); resetBall(); if(lives<=0){ GG.addAch(GAME_ID,'Game Over'); }}
  if(bricks.every(b=>b.hp<=0)){level++;if(level>bestLevel){bestLevel=level;localStorage.setItem('gg:bestlvl:breakout',bestLevel)}resetLevel();ball.stuck=true;ball.x=paddle.x+paddle.w/2;ball.y=paddle.y-20}
  updatePU();
  // lasers
  lasers.forEach(L=>{L.y+=L.vy}); lasers=lasers.filter(L=>L.y>-20);
  for(const L of lasers){ for(const b of bricks){ if(b.hp>0 && L.x>b.x && L.x<b.x+b.w && L.y<b.y+b.h && L.y>b.y){ b.hp=0; score+=10; } } }
  // multiballs
  for(const m of multiBalls){ const spm=Math.max(5,m.speed); const ln=Math.hypot(m.vx,m.vy)||1; m.vx=m.vx/ln*spm; m.vy=m.vy/ln*spm; m.x+=m.vx; m.y+=m.vy; if(m.x<m.r||m.x>c.width-m.r)m.vx*=-1; if(m.y<m.r)m.vy*=-1; if(m.y>paddle.y-m.r&&m.y<paddle.y+paddle.h+m.r&&m.x>paddle.x&&m.x<paddle.x+paddle.w&&m.vy>0){ const rel=(m.x-(paddle.x+paddle.w/2))/(paddle.w/2); const ang=(Math.PI*1.5)+rel*(Math.PI*0.75*0.25); m.vx=Math.cos(ang)*spm; m.vy=Math.sin(ang)*spm; } for(const b of bricks){ if(b.hp<=0) continue; if(m.x>b.x&&m.x<b.x+b.w&&m.y>b.y&&m.y<b.y+b.h){ b.hp=0; score+=10; m.vy*=-1; }} }
  multiBalls = multiBalls.filter(m=>m.y<=c.height+20);
}
function draw(){ // paddle glow
  ctx.shadowColor='rgba(0,200,255,0.6)'; ctx.shadowBlur=12;ctx.fillStyle='#0f1320';ctx.fillRect(0,0,c.width,c.height);for(const b of bricks){if(b.hp>0){ctx.fillStyle='#8b5cf6';ctx.fillRect(b.x,b.y,b.w,b.h)}}ctx.fillStyle='#e6e7ea';ctx.fillRect(paddle.x,paddle.y,paddle.w,paddle.h);ctx.beginPath();ctx.arc(ball.x,ball.y,ball.r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#e6e7ea';ctx.font='bold 18px Inter';ctx.fillText(`Score ${score} • Lives ${lives} • Lv ${level}`,10,24);powerups.forEach(p=>{ctx.fillStyle=p.type==='EXPAND'?'#10b981':p.type==='SLOW'?'#38bdf8':p.type==='MULTI'?'#eab308':'#ef4444';ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fill()});
  // lasers
  ctx.fillStyle='#ef4444'; for(const L of lasers){ ctx.fillRect(L.x-2,L.y-10,4,10); }
  // multiballs
  ctx.fillStyle='#e6e7ea'; for(const m of multiBalls){ ctx.beginPath(); ctx.arc(m.x,m.y,m.r,0,Math.PI*2); ctx.fill(); }
  const best=parseInt(localStorage.getItem('gg:best:breakout')||'0');if(score>best)localStorage.setItem('gg:best:breakout',score);GG.setMeta(GAME_ID,'Best score: '+Math.max(best,score)+' • Best level: '+bestLevel);if(lives<=0){ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#e6e7ea';ctx.font='bold 30px Inter';ctx.fillText('Game Over — Press R',c.width/2-150,c.height/2)} if(paused){ctx.fillStyle='rgba(0,0,0,0.55)';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#e6e7ea';ctx.font='bold 28px Inter';ctx.fillText('Paused — P to resume', c.width/2-120, c.height/2);} }
function loop(){step();draw();requestAnimationFrame(loop)}requestAnimationFrame(loop);
