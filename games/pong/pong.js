const canvas=document.getElementById('game');fitCanvasToParent(canvas,1100,800,24);addEventListener('resize',()=>fitCanvasToParent(canvas,1100,800,24));const ctx=canvas.getContext('2d');let W=canvas.width,H=canvas.height;const PADDLE_W=12,PADDLE_H=110,BALL_R=8;let left={x:30,y:H/2-PADDLE_H/2,vy:0,score:0},right={x:W-30-PADDLE_W,y:H/2-PADDLE_H/2,vy:0,score:0};function resetBall(dir=Math.random()<.5?-1:1){return{x:W/2,y:H/2,vx:5*dir,vy:(Math.random()*2-1)*3}}let ball=resetBall(1);let keys={};document.addEventListener('keydown',e=>keys[e.key.toLowerCase()]=true);document.addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);function clamp(v,min,max){return Math.max(min,Math.min(max,v))}const GAME_ID='pong';GG.incPlays();let twoP=false;let aiSpeed=.13;function setMetaWins(){const w=parseInt(localStorage.getItem('gg:pong:wins')||'0');const l=parseInt(localStorage.getItem('gg:pong:loss')||'0');GG.setMeta(GAME_ID,`Wins: ${w} • Losses: ${l}`)}function toggle2P(){twoP=!twoP}function setDifficulty(level){aiSpeed=level==='easy'?.08:level==='hard'?.2:.13}setMetaWins();
// v5: pause, power-up, touch
let paused=false,lastHit='left',power=null;function togglePause(){paused=!paused}document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='p')togglePause(); if(e.key==='2')toggle2P(); if(e.key==='1')setDifficulty('easy'); if(e.key==='3')setDifficulty('hard'); if(e.key==='2'&&e.shiftKey)setDifficulty('medium'); if(e.key.toLowerCase()==='r'){left.score=0;right.score=0;ball=resetBall();}});
function maybeSpawnPower(){ if(power||Math.random()>0.006)return; power={x:W/2,y:40+Math.random()*(H-80),ttl:10000}; }
function applyPower(){ if(!power)return; if(Math.abs(ball.x-power.x)<12 && Math.abs(ball.y-power.y)<20){ if(lastHit==='left'){ left._boost=Date.now()+6000; } else { right._boost=Date.now()+6000; } SFX.seq([[880,0.06,0.25],[1320,0.08,0.25]]); power=null; } if(power){ power.ttl-=16; if(power.ttl<0) power=null; } }
function paddleHeight(p){return (p._boost||0)>Date.now()? PADDLE_H*1.35 : PADDLE_H;}
// Touch to move left paddle
(function(){let dragging=false;canvas.addEventListener('touchstart',()=>dragging=true);canvas.addEventListener('touchend',()=>dragging=false);canvas.addEventListener('touchmove',e=>{if(!dragging)return;const t=e.touches[0];const r=canvas.getBoundingClientRect();const y=(t.clientY-r.top)*(canvas.height/r.height);left.y=clamp(y-paddleHeight(left)/2,0,H-paddleHeight(left));e.preventDefault();},{passive:false});})();
function step(){ if(paused)return; maybeSpawnPower(); applyPower();
  left.vy=(keys['w']?-7:0)+(keys['s']?7:0); left.y=clamp(left.y+left.vy,0,H-paddleHeight(left));
  const target=ball.y-(paddleHeight(right)/2-BALL_R); right.vy=(keys['arrowup']?-7:0)+(keys['arrowdown']?7:0);
  if(!twoP&&!keys['arrowup']&&!keys['arrowdown']){ right.y+= (target-right.y)*aiSpeed; } else { right.y=clamp(right.y+right.vy,0,H-paddleHeight(right)); }
  ball.x+=ball.vx; ball.y+=ball.vy;
  if(ball.y<BALL_R||ball.y>H-BALL_R){ ball.vy*=-1; SFX.beep({freq:220}); }
  if(ball.x-BALL_R<left.x+PADDLE_W&&ball.y>left.y&&ball.y<left.y+paddleHeight(left)&&ball.vx<0){ ball.vx*=-1.05; const rel=(ball.y-(left.y+paddleHeight(left)/2))/(paddleHeight(left)/2); ball.vy=rel*6; lastHit='left'; SFX.beep({freq:440}); }
  if(ball.x+BALL_R>right.x&&ball.y>right.y&&ball.y<right.y+paddleHeight(right)&&ball.vx>0){ ball.vx*=-1.05; const rel=(ball.y-(right.y+paddleHeight(right)/2))/(paddleHeight(right)/2); ball.vy=rel*6; lastHit='right'; SFX.beep({freq:520}); }
  if(ball.x<-20){ right.score++; GG.addXP(2); SFX.seq([[260],[200]]); ball=resetBall(1); }
  if(ball.x>W+20){ left.score++; GG.addXP(2); SFX.seq([[260],[200]]); ball=resetBall(-1); }
}
function draw(){ ctx.clearRect(0,0,canvas.width,canvas.height); W=canvas.width; H=canvas.height;
  ctx.fillStyle='#11162a'; ctx.fillRect(0,0,W,H); ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.setLineDash([12,18]); ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='#e6e7ea'; ctx.fillRect(left.x,left.y,PADDLE_W,paddleHeight(left)); ctx.fillRect(right.x,right.y,PADDLE_W,paddleHeight(right));
  ctx.beginPath(); ctx.arc(ball.x,ball.y,BALL_R,0,Math.PI*2); ctx.fill();
  if(power){ ctx.fillStyle='#f59e0b'; ctx.beginPath(); ctx.arc(power.x,power.y,10,0,Math.PI*2); ctx.fill(); }
  ctx.textAlign='center'; ctx.fillStyle='#e6e7ea'; ctx.font='bold 42px Inter, system-ui, sans-serif'; ctx.fillText(`${left.score}`,W/2-80,60); ctx.fillText(`${right.score}`,W/2+80,60);
  if(paused){ ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(0,0,W,H); ctx.fillStyle='#e6e7ea'; ctx.font='bold 34px Inter'; ctx.fillText('Paused — P to resume', W/2, H/2); }
  if(left.score>=7||right.score>=7){ ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,W,H); ctx.fillStyle='#e6e7ea'; ctx.font='bold 48px Inter, system-ui, sans-serif'; ctx.fillText(`${left.score>=7?'Left':'Right'} wins!`,W/2,H/2); ctx.font='24px Inter, system-ui, sans-serif'; ctx.fillText(`Press R to restart`,W/2,H/2+40);
    if(left.score>=7){ const w=parseInt(localStorage.getItem('gg:pong:wins')||'0')+1; localStorage.setItem('gg:pong:wins',w); GG.addXP(10); GG.addAch(GAME_ID,'Pong Win'); } else { const l=parseInt(localStorage.getItem('gg:pong:loss')||'0')+1; localStorage.setItem('gg:pong:loss',l); } setMetaWins(); }
}
(function loop(){ step(); draw(); requestAnimationFrame(loop); })();
