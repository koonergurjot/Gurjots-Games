
// Upgraded Pong v3 — module-compatible. Auto-boots and posts GAME_READY/ERROR.
// Exposes window.boot for the site loader, but also starts when DOM is ready.
(() => {
  const SLUG = "pong";
  const LS_KEY = "pong.v3";
  const W = 1280, H = 720;

  // Create root
  function ensureRoot() {
    let root = document.getElementById('game-root');
    if (!root) { root = document.createElement('div'); root.id='game-root'; document.body.appendChild(root); }
    root.classList.add('pong-root');
    return root;
  }

  // Inject CSS (scoped-ish)
  function injectCSS() {
    const style = document.createElement('style');
    style.setAttribute('data-pong', 'v3');
    style.textContent = `
:root {
  --pong-bg:#0b0f14; --pong-fg:#e8f1ff; --pong-accent:#69e1ff; --pong-muted:#7a8aa0; --pong-grid:#132033; --pong-glow: rgba(105,225,255,0.28);
}
.theme-neon { --pong-bg:#05070c; --pong-fg:#e7f7ff; --pong-accent:#69e1ff; --pong-grid:#112038; }
.theme-vapor { --pong-bg:#0b0012; --pong-fg:#ffe8ff; --pong-accent:#ff66cc; --pong-grid:#2a0a3a; --pong-glow: rgba(255,102,204,0.28); }
.theme-crt { --pong-bg:#000; --pong-fg:#e0ffe0; --pong-accent:#7cff7c; --pong-grid:#002200; --pong-glow: rgba(124,255,124,0.18); }
.theme-minimal { --pong-bg:#f7f8fb; --pong-fg:#0b1220; --pong-accent:#2b6cff; --pong-grid:#e6e9f2; --pong-glow: rgba(43,108,255,0.12); }
.pong-root{background:var(--pong-bg); color:var(--pong-fg); min-height:100svh; font-family:system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;}
.pong-app{display:grid; grid-template-rows:auto 1fr auto; min-height:100svh;}
.pong-bar{display:flex; align-items:center; gap:.5rem; padding:.75rem 1rem; border-bottom:1px solid #1b2533;}
.pong-title{font-weight:800; letter-spacing:.3px;}
.pong-spacer{flex:1}
.pong-kbd{padding:.15rem .4rem; border:1px solid #324356; border-bottom-width:2px; border-radius:.35rem; background:#0e1622; font-size:.85rem}
.pong-btn{cursor:pointer; border:1px solid #243043; background:#111a28; color:var(--pong-fg); border-radius:.6rem; padding:.5rem .8rem; font:inherit}
.pong-btn:hover{background:#172334}
.pong-btn[aria-pressed="true"]{outline:2px solid var(--pong-accent); box-shadow:0 0 0 6px var(--pong-glow);}
.pong-canvas-wrap{display:grid; place-items:center; padding:10px}
.pong-canvas{width:100%; max-width:1100px; aspect-ratio:16/9; touch-action:none; background:var(--pong-bg); border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.03);}
.pong-hud{display:flex; align-items:center; justify-content:center; gap:2rem; padding:.4rem 0; font-weight:700}
.pong-score{font-size:1.25rem}
.pong-mid{color:var(--pong-muted)}
.pong-menu{padding:.75rem 1rem; border-top:1px solid #1b2533; display:flex; gap:.5rem; flex-wrap:wrap; align-items:center}
.pong-select,.pong-input{background:#131a24; color:var(--pong-fg); border:1px solid #243043; border-radius:.5rem; padding:.5rem .6rem; font:inherit}
.pong-row{display:flex; align-items:center; gap:.5rem; flex-wrap:wrap}
.pong-modal{position:fixed; inset:0; display:none; place-items:center; background:rgba(0,0,0,.5); backdrop-filter: blur(4px);}
.pong-modal.show{display:grid}
.pong-card{min-width:min(700px, 95vw); max-width:95vw; background:#0e1622; border:1px solid #243043; border-radius:12px; padding:1rem; box-shadow: 0 10px 40px rgba(0,0,0,.55);}
.pong-diag{position:fixed; inset:auto 12px 12px auto; width:min(520px, 95vw); max-height:60vh; overflow:auto; background:#0e1622; border:1px solid #243043; border-radius:12px; padding:.75rem; display:none; white-space:pre-wrap}
.pong-diag.show{display:block}
.pong-diag pre{white-space:pre-wrap;}
.theme-crt .pong-canvas{position:relative; overflow:hidden;}
.theme-crt .pong-canvas::after{content:""; position:absolute; inset:0;
  background: repeating-linear-gradient(to bottom, rgba(255,255,255,0.05), rgba(255,255,255,0.05) 2px, transparent 2px, transparent 4px);
  pointer-events:none; mix-blend-mode: overlay; opacity:.4;}
@media (pointer: coarse) { .touch-hint{display:inline; color:var(--pong-muted); font-size:.9rem} }
    `;
    document.head.appendChild(style);
  }

  const DFLT = {
    mode:"1P", ai:"Normal", toScore:11, winByTwo:true, powerups:true, sfx:true,
    theme:"neon", reduceMotion:false,
    keys:{p1Up:"KeyW", p1Down:"KeyS", p2Up:"ArrowUp", p2Down:"ArrowDown", pause:"Space"},
  };
  const state = {
    ...loadLS(), ...DFLT, running:false, debug:hasDebug(), last:0, dt:0, canvas:null, ctx:null, ratio:1,
    paused:false, over:false, score:{p1:0,p2:0}, balls:[], p1:null, p2:null, hud:null, diag:null, loopId:0,
    particles:[], shakes:0, trail:[], trailMax:20, replay:[], replayMax:5*60, recording:true,
    gridPhase:0
  };
  function hasDebug(){ return location.search.includes('debug'); }
  function loadLS(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'{}'); }catch{return{};} }
  function saveLS(){
    const o={mode:state.mode, ai:state.ai, toScore:state.toScore, winByTwo:state.winByTwo, powerups:state.powerups, sfx:state.sfx, theme:state.theme, reduceMotion:state.reduceMotion, keys:state.keys};
    try{ localStorage.setItem(LS_KEY, JSON.stringify(o)); }catch{}
  }

  // Audio
  let ac=null; function ensureAC(){ if(!ac) try{ ac=new (window.AudioContext||window.webkitAudioContext)(); }catch{} }
  function beep(freq=440, len=0.06, type='sine', gain=0.08){
    if(!state.sfx) return; ensureAC(); if(!ac) return;
    const t = ac.currentTime; const o=ac.createOscillator(), g=ac.createGain();
    o.type=type; o.frequency.value=freq; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain,t+0.005); g.gain.exponentialRampToValueAtTime(0.0001,t+len);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t+len+0.02);
  }

  // Helpers
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const rand=(a,b)=>Math.random()*(b-a)+a;
  const getCSS=(name)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim()||'#fff';

  // Rendering
  function clear(){
    const c=state.ctx;
    state.gridPhase += state.dt * 0.5;
    const grad=c.createLinearGradient(0,0,W,H);
    grad.addColorStop(0,'rgba(255,255,255,0.02)'); grad.addColorStop(1,'rgba(255,255,255,0.06)');
    c.fillStyle=grad; c.fillRect(0,0,W,H);
    c.save(); c.globalAlpha=0.18;
    const cell=40; c.translate((state.gridPhase*20)%cell,(state.gridPhase*14)%cell);
    c.beginPath();
    for(let x=-cell;x<=W+cell;x+=cell){ c.moveTo(x,0); c.lineTo(x,H); }
    for(let y=-cell;y<=H+cell;y+=cell){ c.moveTo(0,y); c.lineTo(W,y); }
    c.strokeStyle=getCSS('--pong-grid'); c.lineWidth=1; c.stroke(); c.restore();
  }
  function circle(x,y,r,col){ const c=state.ctx; c.fillStyle=col; c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.fill(); }
  function rect(x,y,w,h,col){ const c=state.ctx; c.fillStyle=col; c.fillRect(x,y,w,h); }
  function drawNet(){ const c=state.ctx; c.save(); c.globalAlpha=0.9; c.setLineDash([14,14]); c.lineWidth=6; c.strokeStyle=getCSS('--pong-accent'); c.beginPath(); c.moveTo(W/2,0); c.lineTo(W/2,H); c.stroke(); c.restore(); }

  // Particles
  function addParticles(x,y,color,n=12,speed=240){ if(state.reduceMotion) return; for(let i=0;i<n;i++){ state.particles.push({x,y,vx:rand(-1,1)*speed,vy:rand(-1,1)*speed,life:rand(0.35,0.75),r:rand(2,4),color}); } }
  function updateParticles(dt){
    const a=[]; const g=800;
    for(const p of state.particles){ p.life-=dt; p.vy+=g*dt*0.25; p.x+=p.vx*dt; p.y+=p.vy*dt; if(p.life>0 && p.x>-40 && p.x<W+40 && p.y>-40 && p.y<H+40) a.push(p); }
    state.particles=a;
  }
  function drawParticles(){ const c=state.ctx; for(const p of state.particles){ c.globalAlpha=Math.max(0,Math.min(1,p.life*1.8)); circle(p.x,p.y,p.r,p.color);} c.globalAlpha=1; }

  // Objects
  function reset(){
    state.score.p1=0; state.score.p2=0; updateHUD();
    state.balls.length=0;
    state.p1={x:32,y:H/2-60,w:18,h:120,dy:0,speed:560,maxH:180,minH:80};
    state.p2={x:W-50,y:H/2-60,w:18,h:120,dy:0,speed:560,maxH:180,minH:80};
    spawnBall(Math.random()<0.5?-1:1); state.over=false; state.paused=false;
  }
  function spawnBall(dir=1,speed=360){ const a=(Math.random()*0.7-0.35); state.balls.push({x:W/2,y:H/2,r:9,dx:Math.cos(a)*speed*dir,dy:Math.sin(a)*speed,spin:0,lastHit:null}); }
  function award(to){ state.score[to]++; updateHUD(); if(state.mode==='Endless'){ spawnBall(to==='p1'?1:-1); } else if (isMatchOver()) endMatch(); }
  function isMatchOver(){ const a=state.score.p1,b=state.score.p2,T=state.toScore; if(a>=T||b>=T){ return state.winByTwo ? Math.abs(a-b)>=2 : true; } return false; }
  function endMatch(){ state.over=true; state.paused=true; toast('Match over'); beep(220,0.25,'triangle',0.12); }

  function updateHUD(){ if(state.hud){ state.hud.p1.textContent=String(state.score.p1); state.hud.p2.textContent=String(state.score.p2);} }
  function toast(msg){ try{ const pre=state.diag?.querySelector('pre'); if(pre) pre.textContent = `[note] ${msg}\n` + pre.textContent; }catch{} }

  // Input
  const pressed=new Set();
  function bindMove(){ state.p1.dy=(pressed.has(state.keys.p1Down)?1:0)-(pressed.has(state.keys.p1Up)?1:0); if(state.mode==='2P'){ state.p2.dy=(pressed.has(state.keys.p2Down)?1:0)-(pressed.has(state.keys.p2Up)?1:0);} }
  function onPointer(e){ const r=state.canvas.getBoundingClientRect(); const y=(e.clientY-r.top)*state.ratio; state.p1.y = Math.max(0, Math.min(H-state.p1.h, y - state.p1.h/2)); }

  // AI
  function aiSpeed(){ return {Easy:420, Normal:560, Hard:700, Insane:900}[state.ai]||560; }
  function moveAI(dt){ if(state.mode==='2P') return; const b=state.balls[0]; if(!b) return; let target=H/2; if(b.dx>0){ target=predictY(b); } const sp=aiSpeed(); const py=state.p2.y+state.p2.h/2; if(Math.abs(py-target)<8) return; state.p2.y = Math.max(0, Math.min(H-state.p2.h, state.p2.y + (py<target?1:-1)*sp*dt)); }
  function predictY(b){ let x=b.x,y=b.y,dx=b.dx,dy=b.dy; for(let i=0;i<240;i++){ const t=1/120; x+=dx*t; y+=dy*t; if(y<b.r && dy<0){ dy=-dy; y=b.r; } if(y>H-b.r && dy>0){ dy=-dy; y=H-b.r; } if(dx>0 && x>=state.p2.x) break; } return y; }

  // Physics
  function updatePaddle(p,dt){ p.y = Math.max(0, Math.min(H-p.h, p.y + p.dy*p.speed*dt)); }
  function updateBall(b,dt){
    b.dy += b.spin * 18 * dt; b.x += b.dx*dt; b.y += b.dy*dt;
    if(b.y<b.r && b.dy<0){ b.y=b.r; b.dy=-b.dy; addParticles(b.x,b.y,getCSS('--pong-accent'),10,180); beep(880,0.02); }
    if(b.y>H-b.r && b.dy>0){ b.y=H-b.r; b.dy=-b.dy; addParticles(b.x,b.y,getCSS('--pong-accent'),10,180); beep(880,0.02); }
    if(b.x - b.r <= state.p1.x + state.p1.w && b.x > state.p1.x && b.y > state.p1.y && b.y < state.p1.y + state.p1.h && b.dx<0){ collidePaddle(b,state.p1,1); }
    if(b.x + b.r >= state.p2.x && b.x < state.p2.x + state.p2.w && b.y > state.p2.y && b.y < state.p2.y + state.p2.h && b.dx>0){ collidePaddle(b,state.p2,-1); }
    if(b.x < -40){ award('p2'); respawn(b,1); }
    if(b.x > W+40){ award('p1'); respawn(b,-1); }
  }
  function respawn(b,dir){ Object.assign(b,{x:W/2,y:H/2,dx:dir*(340+Math.random()*80),dy:(Math.random()*440-220),spin:0,lastHit:null}); }
  function collidePaddle(b,p,dir){ const rel=((b.y-(p.y+p.h/2))/(p.h/2)); const speed=Math.hypot(b.dx,b.dy); const add=rel*280; b.dx=Math.sign(dir)*Math.max(240,speed*0.92); b.dy=Math.max(-640, Math.min(640, b.dy + add)); b.spin = Math.max(-6, Math.min(6, (p.dy*0.8) + rel*2.0)); b.lastHit=(p===state.p1?'p1':'p2'); addParticles(b.x,b.y,getCSS('--pong-accent'),16,240); shake(6); beep(520,0.03,'square',0.08); }

  // Shake
  function shake(px){ if(state.reduceMotion) return; state.shakes=Math.max(state.shakes,px); }
  function applyShake(){ if(state.shakes<=0) return; const c=state.ctx; c.save(); const dx=(Math.random()*2-1)*state.shakes, dy=(Math.random()*2-1)*state.shakes; c.translate(dx,dy); state._shook=true; state.shakes=Math.max(0,state.shakes-0.8); }
  function endShake(){ if(state._shook){ state.ctx.restore(); state._shook=false; } }

  // Powerups
  const powerups=[];
  function maybeSpawnPowerup(dt){ if(!state.powerups) return; if(Math.random()<dt*0.25){ const types=['grow','shrink','slow','fast','multiball','ghost']; const kind=types[(Math.random()*types.length)|0]; powerups.push({x:200+Math.random()*(W-400), y:120+Math.random()*(H-240), r:10, kind, life:8}); } }
  function updatePowerups(dt){ for(const pu of powerups){ pu.life-=dt; } for(let i=powerups.length-1;i>=0;i--) if(powerups[i].life<=0) powerups.splice(i,1); }
  function drawPowerups(){ for(const pu of powerups){ const c=state.ctx; c.globalAlpha=Math.min(1,pu.life/8+0.2); circle(pu.x,pu.y,pu.r+2,'rgba(0,0,0,0.3)'); circle(pu.x,pu.y,pu.r,getCSS('--pong-accent')); c.globalAlpha=1; } }
  function checkPowerupCollisions(){
    for(let i=powerups.length-1;i>=0;i--){ const pu=powerups[i];
      for(const b of state.balls){ const d=Math.hypot(b.x-pu.x,b.y-pu.y); if(d < b.r+pu.r+2){ const who=b.lastHit || (b.dx>0?'p2':'p1'); applyPowerup(pu.kind, who); addParticles(pu.x,pu.y,getCSS('--pong-good')||getCSS('--pong-accent'),20,260); beep(880,0.08,'sawtooth',0.1); powerups.splice(i,1); break; } } }
  }
  function applyPowerup(kind, who){ const p=(who==='p1'?state.p1:state.p2); switch(kind){ case 'grow': p.h=Math.min(p.h+40,p.maxH); break; case 'shrink': p.h=Math.max(p.h-40,p.minH); break; case 'slow': for(const b of state.balls){ b.dx*=0.85; b.dy*=0.85; } break; case 'fast': for(const b of state.balls){ b.dx*=1.15; b.dy*=1.15; } break; case 'multiball': if(state.balls.length<3){ spawnBall(Math.random()<0.5?-1:1, 400); } break; case 'ghost': state[who+'_ghost']=1.0; break; } }

  // UI helpers
  const h=(t,p={},...k)=>{ const e=document.createElement(t); for(const key in p){ const v=p[key]; if(key==='class') e.className=v; else if(key.startsWith('on')) e.addEventListener(key.slice(2), v); else if(key==='html') e.innerHTML=v; else e.setAttribute(key,String(v)); } for(const kid of k){ if(kid==null) continue; if(typeof kid==='string') e.append(document.createTextNode(kid)); else e.append(kid); } return e; };
  const prettyKey=(code)=>code.replace(/^Key/,'').replace(/^Arrow/,'');
  function toggle(val, on){ const b=h('button',{class:'pong-btn','aria-pressed':String(!!val)}, val?'On':'Off'); b.addEventListener('click',()=>{ val=!val; b.setAttribute('aria-pressed',String(!!val)); b.textContent=val?'On':'Off'; on(val); }); return b; }
  function select(opts, val, on){ const el=h('select',{class:'pong-select'}); for(const o of opts){ const op=h('option',{},o); op.value=o; if(o===val) op.selected=true; el.append(op);} el.addEventListener('change',()=>on(el.value)); return el; }
  function number(val, on){ const i=h('input',{class:'pong-input',type:'number',value:String(val),min:'1',max:'99',style:'width:5rem'}); i.addEventListener('change',()=>on(parseInt(i.value||'0')||11)); return i; }

  function themeToClass(t){ return ({neon:'theme-neon', vapor:'theme-vapor', crt:'theme-crt', minimal:'theme-minimal'})[t]||'theme-neon'; }

  function keyRow(label,key){ const span=h('span',{id:'key-'+key}, prettyKey(state.keys[key])); const btn=h('button',{class:'pong-btn',onclick:()=>listenKey(key,span)},'Change'); return h('div',{class:'pong-row'}, h('label',{},label+':'), span, btn); }
  function renderKeyRows(){ for(const k in state.keys){ const el=document.getElementById('key-'+k); if(el) el.textContent=prettyKey(state.keys[k]); } }
  function openKeybinds(){ state.keyModal.classList.add('show'); renderKeyRows(); }
  function closeKeybinds(){ state.keyModal.classList.remove('show'); }
  function listenKey(which, span){ const handler=(e)=>{ e.preventDefault(); state.keys[which]=e.code; span.textContent=prettyKey(e.code); document.removeEventListener('keydown', handler, true); }; document.addEventListener('keydown', handler, true); span.textContent='...'; }

  function buildUI(root){
    document.body.classList.remove('theme-neon','theme-vapor','theme-crt','theme-minimal');
    document.body.classList.add(themeToClass(state.theme));
    const bar=h('div',{class:'pong-bar'}, h('div',{class:'pong-title'},'Pong'), h('span',{class:'pong-spacer'}), h('span',{class:'pong-kbd'},'Pause: Space'), h('button',{class:'pong-btn',onclick:togglePause},'Pause'), h('button',{class:'pong-btn',onclick:openKeybinds},'Keys'), h('button',{class:'pong-btn',onclick:toggleDiag},'Diagnostics'));
    const wrap=h('div',{class:'pong-canvas-wrap'}, h('canvas',{class:'pong-canvas',id:'game',width:String(W),height:String(H),role:'img','aria-label':'Pong gameplay'}));
    const hud=h('div',{class:'pong-hud'}, h('div',{class:'pong-score',id:'score-p1'},'0'), h('div',{class:'pong-mid'},'—'), h('div',{class:'pong-score',id:'score-p2'},'0'), h('span',{class:'touch-hint'},' • Drag the left side to move'));
    const menu=h('div',{class:'pong-menu'},
      h('div',{class:'pong-row'}, h('label',{},'Mode:'), select(['1P','2P','Endless','Mayhem'], state.mode, v=>{state.mode=v; saveLS(); reset();})),
      h('div',{class:'pong-row'}, h('label',{},'AI:'), select(['Easy','Normal','Hard','Insane'], state.ai, v=>{state.ai=v; saveLS();})),
      h('div',{class:'pong-row'}, h('label',{},'To Score:'), number(state.toScore, v=>{state.toScore=v; saveLS();})),
      h('div',{class:'pong-row'}, h('label',{},'Powerups:'), toggle(state.powerups, v=>{state.powerups=v; saveLS();})),
      h('div',{class:'pong-row'}, h('label',{},'SFX:'), toggle(state.sfx, v=>{state.sfx=v; saveLS();})),
      h('div',{class:'pong-row'}, h('label',{},'Theme:'), select(['neon','vapor','crt','minimal'], state.theme, v=>{state.theme=v; saveLS(); document.body.className='pong-root '+themeToClass(v);})),
      h('div',{class:'pong-row'}, h('label',{},'Reduce motion:'), toggle(state.reduceMotion, v=>{state.reduceMotion=v; saveLS();})),
      h('button',{class:'pong-btn',onclick:playReplay},'Instant Replay'),
      h('button',{class:'pong-btn',onclick:()=>{reset();}},'Reset Match')
    );
    const diag=state.diag=h('div',{class:'pong-diag',role:'region','aria-label':'Diagnostics'},
      h('div',{class:'pong-row'}, h('strong',{},'Diagnostics'), h('span',{class:'pong-spacer'}), h('button',{class:'pong-btn',onclick:copyDiag},'Copy'), h('button',{class:'pong-btn',onclick:()=>{state.debug=false; state.diag.classList.remove('show');}},'Close')), h('pre',{},'Diagnostics ready.'));
    const keyModal=state.keyModal=h('div',{class:'pong-modal',id:'key-modal'},
      h('div',{class:'pong-card'}, h('h3',{},'Rebind Keys'), keyRow('P1 Up','p1Up'), keyRow('P1 Down','p1Down'), keyRow('P2 Up','p2Up'), keyRow('P2 Down','p2Down'), keyRow('Pause','pause'),
        h('div',{class:'pong-row'}, h('button',{class:'pong-btn',onclick:()=>{saveLS(); closeKeybinds();}},'Done'), h('button',{class:'pong-btn',onclick:()=>{Object.assign(state.keys,{p1Up:"KeyW",p1Down:"KeyS",p2Up:"ArrowUp",p2Down:"ArrowDown",pause:"Space"}); renderKeyRows();}},'Reset'))
    ));
    const app=h('div',{class:'pong-app'}, bar, wrap, hud, menu, diag, keyModal);
    root.innerHTML=''; root.append(app);
    state.hud={p1:hud.querySelector('#score-p1'), p2:hud.querySelector('#score-p2')};
  }

  // Canvas & resize
  function ensureContext(){
    state.canvas=document.getElementById('game');
    const ctx=state.canvas.getContext('2d',{alpha:false,desynchronized:true}); if(!ctx){ throw new Error('Canvas context unavailable'); }
    state.ctx=ctx; onResize();
  }
  function onResize(){
    const el=state.canvas; const rect=el.getBoundingClientRect(); const cssW=rect.width, cssH=rect.height; const dpr=window.devicePixelRatio||1;
    const targetW=Math.round(cssW*dpr), targetH=Math.round(cssH*dpr); if(el.width!==targetW||el.height!==targetH){ el.width=targetW; el.height=targetH; }
    state.ctx.setTransform(targetW/W,0,0,targetH/H,0,0); state.ratio=(targetW/W);
  }

  // Powerups driver
  const powerupsArr=[];
  function maybeSpawnPowerup(dt){ if(!state.powerups) return; if(Math.random()<dt*0.25){ const kinds=['grow','shrink','slow','fast','multiball','ghost']; const kind=kinds[(Math.random()*kinds.length)|0]; powerupsArr.push({x:200+Math.random()*(W-400),y:120+Math.random()*(H-240),r:10,kind,life:8}); } }
  function updatePowerups(dt){ for(const pu of powerupsArr){ pu.life-=dt; } for(let i=powerupsArr.length-1;i>=0;i--) if(powerupsArr[i].life<=0) powerupsArr.splice(i,1); }
  function drawPowerups(){ for(const pu of powerupsArr){ const c=state.ctx; c.globalAlpha=Math.min(1,pu.life/8+0.2); circle(pu.x,pu.y,pu.r+2,'rgba(0,0,0,0.3)'); circle(pu.x,pu.y,pu.r,getCSS('--pong-accent')); c.globalAlpha=1; } }
  function checkPowerupCollisions(){
    for(let i=powerupsArr.length-1;i>=0;i--){ const pu=powerupsArr[i];
      for(const b of state.balls){ const d=Math.hypot(b.x-pu.x,b.y-pu.y); if(d< b.r+pu.r+2){ const who=b.lastHit || (b.dx>0?'p2':'p1'); applyPowerup(pu.kind, who); addParticles(pu.x,pu.y,getCSS('--pong-accent'),20,260); beep(880,0.08,'sawtooth',0.1); powerupsArr.splice(i,1); break; } } }
  }
  function applyPowerup(kind, who){ const p=(who==='p1'?state.p1:state.p2); switch(kind){ case 'grow': p.h=Math.min(p.h+40,p.maxH); break; case 'shrink': p.h=Math.max(p.h-40,p.minH); break; case 'slow': for(const b of state.balls){ b.dx*=0.85; b.dy*=0.85; } break; case 'fast': for(const b of state.balls){ b.dx*=1.15; b.dy*=1.15; } break; case 'multiball': if(state.balls.length<3){ spawnBall(Math.random()<0.5?-1:1, 400); } break; case 'ghost': state[who+'_ghost']=1.0; break; } }

  // Game loop
  function frame(t){
    state.loopId=requestAnimationFrame(frame);
    state.dt=Math.min(0.033,(t-(state.last||t))/1000); state.last=t;
    if(!state.running || state.paused) return;
    // update
    state.p1.y = Math.max(0, Math.min(H-state.p1.h, state.p1.y + state.p1.dy*state.p1.speed*state.dt));
    if(state.mode==='2P'){ state.p2.y = Math.max(0, Math.min(H-state.p2.h, state.p2.y + state.p2.dy*state.p2.speed*state.dt)); }
    else { moveAI(state.dt); }
    maybeSpawnPowerup(state.dt); updatePowerups(state.dt);
    for(const b of state.balls){ updateBall(b, state.dt); }
    checkPowerupCollisions();
    // render
    const c=state.ctx; c.save(); clear(); applyShake(); drawNet();
    rect(state.p1.x,state.p1.y,state.p1.w,state.p1.h,getCSS('--pong-fg')); rect(state.p2.x,state.p2.y,state.p2.w,state.p2.h,getCSS('--pong-fg'));
    // trails
    if(!state.reduceMotion){ for(const b of state.balls){ state.trail.push({x:b.x,y:b.y,r:b.r,life:0.35}); } const t2=[]; for(const t of state.trail){ t.life-=state.dt; if(t.life>0){ c.globalAlpha=Math.max(0,Math.min(1,t.life*1.8)); circle(t.x,t.y,t.r,getCSS('--pong-accent')); t2.push(t);} } state.trail=t2.slice(-120); c.globalAlpha=1; }
    for(const b of state.balls){ circle(b.x,b.y,b.r,getCSS('--pong-fg')); }
    drawPowerups(); drawParticles(); endShake(); c.restore();
  }

  // Particles driver
  function drawParticles(){ const c=state.ctx; for(const p of state.particles){ c.globalAlpha=Math.max(0,Math.min(1,p.life*1.8)); circle(p.x,p.y,p.r,p.color);} c.globalAlpha=1; }
  function updateParticles(dt){ const a=[]; const g=800; for(const p of state.particles){ p.life-=dt; p.vy+=g*dt*0.25; p.x+=p.vx*dt; p.y+=p.vy*dt; if(p.life>0 && p.x>-40 && p.x<W+40 && p.y>-40 && p.y<H+40) a.push(p);} state.particles=a; }

  // Shake
  function shake(px){ if(state.reduceMotion) return; state.shakes=Math.max(state.shakes,px); }

  // Replay
  function playReplay(){
    if(state.replay.length<10) return toast('Not enough replay data yet');
    state.paused=true; const frames=state.replay.slice(-Math.min(state.replay.length,5*60));
    const saveBalls=state.balls.map(b=>({...b})); const saveP1={...state.p1}, saveP2={...state.p2}; const ctx=state.ctx; let i=0;
    const step=()=>{ if(i>=frames.length){ state.p1=saveP1; state.p2=saveP2; state.balls=saveBalls; state.paused=false; return; }
      const f=frames[i++]; state.p1.y=f.p1y; state.p2.y=f.p2y; state.balls=f.balls.map(b=>({...b, spin:0, lastHit:null}));
      ctx.save(); clear(); drawNet(); rect(state.p1.x,state.p1.y,state.p1.w,state.p1.h,getCSS('--pong-fg')); rect(state.p2.x,state.p2.y,state.p2.w,state.p2.h,getCSS('--pong-fg')); for(const b of state.balls){ circle(b.x,b.y,b.r,getCSS('--pong-fg')); } ctx.restore(); requestAnimationFrame(step);
    }; requestAnimationFrame(step);
  }

  // UI, diag, controls
  function togglePause(){ state.paused=!state.paused; if(!state.paused){ state.last=performance.now(); } }
  function toggleDiag(){ state.debug=!state.debug; state.diag.classList.toggle('show', state.debug); }
  function copyDiag(){ const pre=state.diag?.querySelector('pre'); if(pre && navigator.clipboard) navigator.clipboard.writeText(pre.textContent).catch(()=>{}); }

  // Boot
  function start(){
    const root = ensureRoot();
    injectCSS();
    const app = document.createElement('div'); app.className='pong-app'; root.appendChild(app);
    // Build UI inside the existing root
    app.remove();
    buildUI(root);
    state.canvas=document.getElementById('game'); ensureContext();
    // Events
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', ()=>{ state.paused = document.hidden || state.paused; });
    window.addEventListener('keydown', e=>{ if(e.code===state.keys.pause){ togglePause(); e.preventDefault(); return; } pressed.add(e.code); bindMove(); }, {passive:false});
    window.addEventListener('keyup', e=>{ pressed.delete(e.code); bindMove(); });
    state.canvas.addEventListener('pointerdown', onPointer, {passive:true}); state.canvas.addEventListener('pointermove', onPointer, {passive:true});
    // Init game
    reset(); saveLS(); state.running=true; state.paused=false; state.over=false; state.last=performance.now(); requestAnimationFrame(frame);
    try{ window.parent?.postMessage?.({type:'GAME_READY', slug:SLUG}, '*'); }catch{}
  }

  // expose for loader
  window.boot = () => { try{ start(); }catch(err){ console.error('[pong] boot error', err); window.parent?.postMessage?.({type:'GAME_ERROR', slug:SLUG, message:String(err?.message||err)}, '*'); } };
  // auto boot too
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.boot(), { once: true });
  else window.boot();
})();
