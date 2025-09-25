
window.drawParticles = window.drawParticles || function(){ /* no-op fallback */ };

(function(){
  "use strict";

  const SLUG = "pong";
  const LS_KEY = "pong.v3";
  const W = 1280, H = 720;

  const DFLT = {
    mode:"1P",            // 1P, 2P, Endless, Mayhem
    ai:"Normal",          // Easy, Normal, Hard, Insane
    toScore:11,
    winByTwo:true,
    powerups:true,
    sfx:true,
    theme:"neon",         // neon | vapor | crt | minimal
    reduceMotion:false,
    keys:{p1Up:"KeyW", p1Down:"KeyS", p2Up:"ArrowUp", p2Down:"ArrowDown", pause:"Space"},
  };

  const state = {
    ...DFLT, ...loadLS(),
    running:false, debug:hasDebug(), t0:0, last:0, dt:0,
    canvas:null, ctx:null, ratio:1, paused:false, over:false,
    score:{p1:0,p2:0}, ball:null, balls:[], p1:null, p2:null, hud:null, diag:null, loopId:0,
    particles:[], shakes:0, themeClass:"theme-neon", gamepad:null, keyModal:null,
    trail:[], trailMax:20, touches:{}, replay:[], replayMax:5*60, recording:true,
    shellPaused:false,
    gridPhase:0
  };

  // ---------- Utilities ----------
  function hasDebug(){ return location.search.includes("debug"); }
  function post(type, detail){ try{ window.parent && window.parent.postMessage({type, slug:SLUG, detail}, "*"); }catch{} }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function rand(a,b){ return Math.random()*(b-a)+a; }
  function lerp(a,b,t){ return a+(b-a)*t; }

  function loadLS(){
    try{ return JSON.parse(localStorage.getItem(LS_KEY)||"{}"); }catch{return{}}
  }
  function saveLS(){
    const o={mode:state.mode, ai:state.ai, toScore:state.toScore, winByTwo:state.winByTwo, powerups:state.powerups, sfx:state.sfx, theme:state.theme, reduceMotion:state.reduceMotion, keys:state.keys};
    try{ localStorage.setItem(LS_KEY, JSON.stringify(o)); }catch{}
  }

  // ---------- Audio (WebAudio beeps) ----------
  let ac=null;
  function ensureAC(){ if(!ac) try{ ac=new (window.AudioContext||window.webkitAudioContext)(); }catch{} }
  function beep(freq=440, len=0.06, type="sine", gain=0.08){
    if(!state.sfx) return;
    ensureAC(); if(!ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t+0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t+len);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t+len+0.02);
  }

  // ---------- Rendering helpers ----------
  function clear(){
    const ctx = state.ctx;
    // Fancy gradient grid background
    state.gridPhase += state.dt * 0.5;
    const grad = ctx.createLinearGradient(0,0,W,H);
    grad.addColorStop(0, "rgba(255,255,255,0.02)");
    grad.addColorStop(1, "rgba(255,255,255,0.06)");
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,W,H);

    // moving grid
    ctx.save();
    ctx.globalAlpha = 0.18;
    const cell = 40;
    ctx.translate((state.gridPhase*20)%cell, (state.gridPhase*14)%cell);
    ctx.beginPath();
    for(let x=-cell; x<=W+cell; x+=cell){ ctx.moveTo(x,0); ctx.lineTo(x,H); }
    for(let y=-cell; y<=H+cell; y+=cell){ ctx.moveTo(0,y); ctx.lineTo(W,y); }
    ctx.strokeStyle = getCSS("--pong-grid"); ctx.lineWidth=1;
    ctx.stroke();
    ctx.restore();
  }
  function getCSS(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#fff"; }

  function drawNet(){
    const ctx=state.ctx;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([14,14]);
    ctx.lineWidth = 6;
    ctx.strokeStyle = getCSS("--pong-accent");
    ctx.beginPath();
    ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H);
    ctx.stroke();
    ctx.restore();
  }

  function circle(x,y,r, color){ const c=state.ctx; c.fillStyle=color; c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.fill(); }
  function rect(x,y,w,h, color){ const c=state.ctx; c.fillStyle=color; c.fillRect(x,y,w,h); }

  function addParticles(x,y, color, n=12, speed=240){
    if(state.reduceMotion) return;
    for(let i=0;i<n;i++){
      state.particles.push({x,y, vx:rand(-1,1)*speed, vy:rand(-1,1)*speed, life:rand(0.35,0.75), r:rand(2,4), color});
    }
  }

  function updateParticles(dt){
    const a=[]; const g=800;
    for(const p of state.particles){
      p.life -= dt;
      p.vy += g*dt*0.25;
      p.x += p.vx*dt; p.y += p.vy*dt;
      if(p.life>0 && p.x>-40 && p.x<W+40 && p.y>-40 && p.y<H+40) a.push(p);
    }
    state.particles=a;
  }
  function drawParticles(){
    const c=state.ctx;
    for(const p of state.particles){
      c.globalAlpha = Math.max(0, Math.min(1, p.life*1.8));
      circle(p.x, p.y, p.r, p.color);
    }
    c.globalAlpha = 1;
  }

  // ---------- Game objects ----------
  function reset(){
    state.score.p1=0; state.score.p2=0; updateHUD();
    state.balls.length=0;
    state.p1 = {x:32, y:H/2-60, w:18, h:120, dy:0, speed:560, maxH:180, minH:80};
    state.p2 = {x:W-50, y:H/2-60, w:18, h:120, dy:0, speed:560, maxH:180, minH:80};
    spawnBall(Math.random()<0.5? -1 : 1);
    state.over=false; state.paused=false;
  }

  function spawnBall(dir=1, speed=360){
    const a = rand(-0.35, 0.35);
    const v = speed;
    state.balls.push({x:W/2, y:H/2, r:9, dx:Math.cos(a)*v*dir, dy:Math.sin(a)*v, spin:0, lastHit:null});
  }

  function award(pointTo){
    state.score[pointTo]++; updateHUD();
    if(state.mode==="Endless") { // endless: don't end, just reset
      spawnBall(pointTo==="p1" ? 1 : -1);
    } else if(isMatchOver()) endMatch();
  }

  function isMatchOver(){
    const a=state.score.p1, b=state.score.p2, T=state.toScore;
    if(a>=T||b>=T){
      if(!state.winByTwo) return true;
      return Math.abs(a-b)>=2;
    }
    return false;
  }

  function endMatch(){ state.over=true; state.paused=true; toast("Match over"); beep(220,0.25,"triangle",0.12); }

  function toast(msg){
    if(state.diag){ const pre=state.diag.querySelector("pre"); pre.textContent = `[note] ${msg}\n` + pre.textContent; }
  }

  function updateHUD(){
    state.hud.p1.textContent=String(state.score.p1);
    state.hud.p2.textContent=String(state.score.p2);
  }

  // ---------- Input ----------
  const pressed = new Set();
  function bindMove(){
    state.p1.dy = (pressed.has(state.keys.p1Down)? 1:0) - (pressed.has(state.keys.p1Up)? 1:0);
    if(state.mode==="2P"){
      state.p2.dy = (pressed.has(state.keys.p2Down)? 1:0) - (pressed.has(state.keys.p2Up)? 1:0);
    }
  }

  function onPointer(e){
    const r = state.canvas.getBoundingClientRect(); const y = (e.clientY - r.top) * state.ratio;
    state.p1.y = clamp(y - state.p1.h/2, 0, H - state.p1.h);
  }

  // ---------- AI ----------
  function aiSpeed(){
    return {Easy:420, Normal:560, Hard:700, Insane:900}[state.ai] || 560;
  }
  function moveAI(dt){
    if(state.mode==="2P") return;
    // Predict next Y (simple extrapolation with bounce prediction)
    let targetY = H/2;
    let nearest = state.balls[0];
    if(!nearest) return;
    // If ball moving towards AI
    if(nearest.dx > 0){
      targetY = predictY(nearest);
    } else {
      // recentre
      targetY = H/2;
    }
    const sp = aiSpeed();
    if(Math.abs((state.p2.y + state.p2.h/2) - targetY) < 8) return;
    const dir = (state.p2.y + state.p2.h/2) < targetY ? 1 : -1;
    state.p2.y = clamp(state.p2.y + dir*sp*dt, 0, H - state.p2.h);
  }

  function predictY(ball){
    // simulate bounces on vertical walls
    let x=ball.x, y=ball.y, dx=ball.dx, dy=ball.dy;
    const steps = 240; // rough
    for(let i=0;i<steps;i++){
      const t=1/120;
      x += dx*t; y += dy*t;
      if(y < ball.r && dy<0){ dy = -dy; y = ball.r; }
      if(y > H-ball.r && dy>0){ dy = -dy; y = H-ball.r; }
      if(dx>0 && x>=state.p2.x) break;
    }
    return y;
  }

  // ---------- Physics ----------
  function updatePaddle(p, dt){
    p.y = clamp(p.y + p.dy * p.speed * dt, 0, H - p.h);
  }

  function updateBall(b, dt){
    // Spin: Magnus-like effect
    b.dy += b.spin * 18 * dt;

    b.x += b.dx * dt;
    b.y += b.dy * dt;

    // Wall bounce
    if(b.y < b.r && b.dy < 0){ b.y=b.r; b.dy = -b.dy; addParticles(b.x,b.y,getCSS("--pong-accent"), 10, 180); beep(880,0.02); }
    if(b.y > H-b.r && b.dy > 0){ b.y=H-b.r; b.dy = -b.dy; addParticles(b.x,b.y,getCSS("--pong-accent"), 10, 180); beep(880,0.02); }

    // Paddle collisions
    // P1
    if(b.x - b.r <= state.p1.x + state.p1.w && b.x > state.p1.x && b.y > state.p1.y && b.y < state.p1.y + state.p1.h && b.dx < 0){
      collidePaddle(b, state.p1, 1);
    }
    // P2
    if(b.x + b.r >= state.p2.x && b.x < state.p2.x + state.p2.w && b.y > state.p2.y && b.y < state.p2.y + state.p2.h && b.dx > 0){
      collidePaddle(b, state.p2, -1);
    }

    // Score
    if(b.x < -40){ award("p2"); respawn(b, 1); }
    if(b.x > W+40){ award("p1"); respawn(b, -1); }
  }

  function respawn(b, dir){ Object.assign(b, {x:W/2, y:H/2, dx:dir*rand(340,420), dy:rand(-220,220), spin:0, lastHit:null}); }

  function collidePaddle(b, p, dir){
    // hit offset (-1..1)
    const rel = ((b.y - (p.y + p.h/2)) / (p.h/2));
    const speed = Math.hypot(b.dx, b.dy);
    const add = rel * 280;
    b.dx = Math.sign(dir) * Math.max(240, speed*0.92);
    b.dy = clamp(b.dy + add, -640, 640);
    // Spin depends on paddle movement and offset
    b.spin = clamp((p.dy*0.8) + rel*2.0, -6, 6);
    b.lastHit = p===state.p1 ? "p1" : "p2";

    // Add FX
    addParticles(b.x, b.y, getCSS("--pong-accent"), 16, 240);
    shake(6);
    beep(520,0.03,"square",0.08);
  }

  // ---------- Screen shake ----------
  function shake(px){ if(state.reduceMotion) return; state.shakes = Math.max(state.shakes, px); }
  function applyShake(){
    if(state.shakes<=0) return;
    const c=state.ctx; c.save();
    const dx = rand(-state.shakes, state.shakes), dy = rand(-state.shakes, state.shakes);
    c.translate(dx,dy);
    state.shakes = Math.max(0, state.shakes - 0.8);
  }
  function endShake(){ state.ctx.restore(); }

  // ---------- Powerups ----------
  const powerups = [];
  function maybeSpawnPowerup(dt){
    if(!state.powerups) return;
    if(Math.random() < dt * 0.25){ // avg every ~4s
      const types = ["grow","shrink","slow","fast","multiball","ghost"];
      const kind = types[(Math.random()*types.length)|0];
      powerups.push({x:rand(200,W-200), y:rand(120,H-120), r:10, kind, life:8});
    }
  }
  function updatePowerups(dt){
    for(const pu of powerups){ pu.life -= dt; }
    for(let i=powerups.length-1;i>=0;i--) if(powerups[i].life<=0) powerups.splice(i,1);
  }
  function drawPowerups(){
    const c=state.ctx;
    for(const pu of powerups){
      c.globalAlpha = Math.min(1, pu.life/8 + 0.2);
      circle(pu.x, pu.y, pu.r+2, "rgba(0,0,0,0.3)");
      circle(pu.x, pu.y, pu.r, getCSS("--pong-accent"));
      c.globalAlpha = 1;
    }
  }
  function checkPowerupCollisions(){
    // Ball collects, applies to last hitter's paddle
    for(let i=powerups.length-1;i>=0;i--){
      const pu=powerups[i];
      for(const b of state.balls){
        const d = Math.hypot(b.x-pu.x, b.y-pu.y);
        if(d < b.r + pu.r + 2){
          const who = b.lastHit || (b.dx>0? "p2":"p1");
          applyPowerup(pu.kind, who);
          addParticles(pu.x, pu.y, getCSS("--pong-good"), 20, 260);
          beep(880,0.08,"sawtooth",0.1);
          powerups.splice(i,1);
          break;
        }
      }
    }
  }
  function applyPowerup(kind, who){
    const p = (who==="p1"? state.p1 : state.p2);
    switch(kind){
      case "grow": p.h = clamp(p.h + 40, 60, p.maxH); break;
      case "shrink": p.h = clamp(p.h - 40, p.minH, 240); break;
      case "slow": for(const b of state.balls){ b.dx*=0.85; b.dy*=0.85; } break;
      case "fast": for(const b of state.balls){ b.dx*=1.15; b.dy*=1.15; } break;
      case "multiball": if(state.balls.length<3){ spawnBall(Math.random()<0.5?-1:1, 400); } break;
      case "ghost": // next paddle collision ignores bounce (pass through once)
        const flag = who+"_ghost";
        state[flag] = 1.0; // seconds
        break;
    }
  }

  // ---------- Frame ----------
  function frame(t){
    state.loopId = requestAnimationFrame(frame);
    state.dt = Math.min(0.033, (t - (state.last||t)) / 1000);
    state.last = t;
    if(!state.running || state.paused) return;

    // Update paddles
    updatePaddle(state.p1, state.dt);
    updatePaddle(state.p2, state.dt);
    if(state.mode!=="2P") moveAI(state.dt);

    // Powerups + balls
    maybeSpawnPowerup(state.dt);
    updatePowerups(state.dt);

    for(const b of state.balls){ updateBall(b, state.dt); }
    checkPowerupCollisions();

    // Replay ring buffer (store last N seconds of state)
    if(state.recording){
      state.replay.push({p1y:state.p1.y, p2y:state.p2.y, balls:state.balls.map(b=>({x:b.x,y:b.y,dx:b.dx,dy:b.dy,r:b.r}))});
      if(state.replay.length>state.replayMax) state.replay.shift();
    }

    // Render
    const ctx=state.ctx;
    ctx.save();
    clear();
    applyShake();

    drawNet();

    // paddles
    rect(state.p1.x, state.p1.y, state.p1.w, state.p1.h, getCSS("--pong-fg"));
    rect(state.p2.x, state.p2.y, state.p2.w, state.p2.h, getCSS("--pong-fg"));

    // trails
    if(!state.reduceMotion){
      for(const b of state.balls){
        state.trail.push({x:b.x,y:b.y,r:b.r,life:0.35});
      }
      // draw trail
      const t2=[];
      for(const t of state.trail){
        t.life -= state.dt;
        if(t.life>0){
          state.ctx.globalAlpha = Math.max(0, Math.min(1, t.life*1.8));
          circle(t.x, t.y, t.r, getCSS("--pong-accent"));
          t2.push(t);
        }
      }
      state.trail = t2.slice(-120);
      state.ctx.globalAlpha = 1;
    }

    // balls
    for(const b of state.balls){ circle(b.x,b.y,b.r, getCSS("--pong-fg")); }

    if(typeof drawParticles === "function"){
      drawParticles();
    }
    endShake();
    ctx.restore();

    // Diag text
    if(state.debug && state.diag){ const pre=state.diag.querySelector("pre"); if(pre){
      pre.textContent = `mode=${state.mode} ai=${state.ai} powerups=${state.powerups}
score=${state.score.p1}-${state.score.p2} paused=${state.paused} over=${state.over}
dt=${(state.dt*1000).toFixed(2)}ms DPR=${state.ratio}
balls=${state.balls.length} p1.y=${state.p1.y|0} p2.y=${state.p2.y|0}
` + pre.textContent.slice(0,400);
    }}
  }

  // ---------- UI ----------
  function h(tag, props={}, ...kids){
    const el = document.createElement(tag);
    for(const k in props){
      const v = props[k];
      if(k==="class") el.className = v;
      else if(k.startsWith("on") && typeof v==="function") el.addEventListener(k.slice(2), v);
      else if(k==="html") el.innerHTML = v;
      else el.setAttribute(k, String(v));
    }
    for(const k of kids){ if(k==null) continue; if(typeof k==="string") el.append(document.createTextNode(k)); else el.append(k); }
    return el;
  }

  function buildUI(root){
    document.body.classList.remove("theme-neon","theme-vapor","theme-crt","theme-minimal");
    document.body.classList.add(themeToClass(state.theme));

    const bar = h("div",{class:"pong-bar"},
      h("div",{class:"pong-title"},"Pong"),
      h("span",{class:"pong-spacer"}),
      h("span",{class:"pong-kbd"},"Pause: Space"),
      h("button",{class:"pong-btn",onclick:togglePause},"Pause"),
      h("button",{class:"pong-btn",onclick:openKeybinds},"Keys"),
      h("button",{class:"pong-btn",onclick:toggleDiag},"Diagnostics")
    );

    const wrap = h("div",{class:"pong-canvas-wrap"},
      h("canvas",{class:"pong-canvas", id:"game", width:String(W), height:String(H), role:"img", "aria-label":"Pong gameplay"})
    );

    const hud = h("div",{class:"pong-hud"},
      h("div",{class:"pong-score", id:"score-p1"},"0"),
      h("div",{class:"pong-mid"},"—"),
      h("div",{class:"pong-score", id:"score-p2"},"0"),
      h("span",{class:"touch-hint"}," • Drag the left side to move")
    );

    const menu = h("div",{class:"pong-menu"},
      // Mode
      h("div",{class:"pong-row"},
        h("label",{},"Mode:"),
        select(["1P","2P","Endless","Mayhem"], state.mode, v=>{state.mode=v; saveLS(); reset();})
      ),
      // AI
      h("div",{class:"pong-row"},
        h("label",{},"AI:"),
        select(["Easy","Normal","Hard","Insane"], state.ai, v=>{state.ai=v; saveLS();})
      ),
      // Score to
      h("div",{class:"pong-row"},
        h("label",{},"To Score:"),
        number(state.toScore, v=>{state.toScore=v; saveLS();})
      ),
      // Powerups
      h("div",{class:"pong-row"},
        h("label",{},"Powerups:"),
        toggle(state.powerups, v=>{state.powerups=v; saveLS();})
      ),
      // SFX
      h("div",{class:"pong-row"},
        h("label",{},"SFX:"),
        toggle(state.sfx, v=>{state.sfx=v; saveLS();})
      ),
      // Theme
      h("div",{class:"pong-row"},
        h("label",{},"Theme:"),
        select(["neon","vapor","crt","minimal"], state.theme, v=>{state.theme=v; saveLS(); document.body.className='pong-root '+themeToClass(v);})
      ),
      // Reduce motion
      h("div",{class:"pong-row"},
        h("label",{},"Reduce motion:"),
        toggle(state.reduceMotion, v=>{state.reduceMotion=v; saveLS();})
      ),
      // Replay btn
      h("button",{class:"pong-btn",onclick:playReplay},"Instant Replay"),
      h("button",{class:"pong-btn",onclick:()=>{reset();}},"Reset Match")
    );

    const diag = state.diag = h("div",{class:"pong-diag", role:"region", "aria-label":"Diagnostics"},
      h("div",{class:"pong-row"},
        h("strong",{},"Diagnostics"),
        h("span",{class:"pong-spacer"}),
        h("button",{class:"pong-btn",onclick:copyDiag},"Copy"),
        h("button",{class:"pong-btn",onclick:()=>{state.debug=false; state.diag.classList.remove('show');}},"Close")
      ),
      h("pre",{},"Diagnostics ready.")
    );

    const keyModal = state.keyModal = h("div",{class:"pong-modal", id:"key-modal"},
      h("div",{class:"pong-card"},
        h("h3",{},"Rebind Keys"),
        keyRow("P1 Up","p1Up"),
        keyRow("P1 Down","p1Down"),
        keyRow("P2 Up","p2Up"),
        keyRow("P2 Down","p2Down"),
        keyRow("Pause","pause"),
        h("div",{class:"pong-row"},
          h("button",{class:"pong-btn",onclick:()=>{saveLS(); closeKeybinds();}},"Done"),
          h("button",{class:"pong-btn",onclick:()=>{Object.assign(state.keys,{p1Up:'KeyW',p1Down:'KeyS',p2Up:'ArrowUp',p2Down:'ArrowDown',pause:'Space'}); renderKeyRows();}},"Reset")
        )
      )
    );

    root.append(bar, wrap, hud, menu, diag, keyModal);
    state.hud = {p1: hud.querySelector("#score-p1"), p2: hud.querySelector("#score-p2")};
    installCanvas();
    ensureContext();
    addEvents();
    onResize();
  }

  function themeToClass(t){ return {"neon":"theme-neon","vapor":"theme-vapor","crt":"theme-crt","minimal":"theme-minimal"}[t]||"theme-neon"; }

  function keyRow(label, key){
    const span = h("span",{id:"key-"+key}, prettyKey(state.keys[key]));
    const btn = h("button",{class:"pong-btn",onclick:()=>listenKey(key, span)},"Change");
    return h("div",{class:"pong-row"}, h("label",{}, label+":"), span, btn);
  }
  function prettyKey(code){ return code.replace(/^Key/,'').replace(/^Arrow/,''); }
  function renderKeyRows(){ for(const k of Object.keys(state.keys)){ const el=document.getElementById("key-"+k); if(el) el.textContent=prettyKey(state.keys[k]); } }
  function openKeybinds(){ state.keyModal.classList.add("show"); renderKeyRows(); }
  function closeKeybinds(){ state.keyModal.classList.remove("show"); }
  function listenKey(which, span){
    const handler = (e)=>{ e.preventDefault(); state.keys[which]=e.code; span.textContent=prettyKey(e.code); document.removeEventListener("keydown", handler, true); };
    document.addEventListener("keydown", handler, true);
    span.textContent="...";
  }

  function select(options, value, on){
    const el = h("select",{class:"pong-select"});
    for(const o of options){ const opt=h("option",{},o); opt.value=o; if(o===value) opt.selected=true; el.append(opt); }
    el.addEventListener("change", ()=>on(el.value));
    return el;
  }
  function toggle(value, on){ const b=h("button",{class:"pong-btn", "aria-pressed":String(!!value)}, value?"On":"Off"); b.addEventListener("click", ()=>{ value=!value; b.setAttribute("aria-pressed", String(!!value)); b.textContent=value?"On":"Off"; on(value); }); return b; }
  function number(value, on){ const i=h("input",{class:"pong-input", type:"number", value:String(value), min:"1", max:"99", style:"width:5rem"}); i.addEventListener("change", ()=>on(parseInt(i.value||"0")||11)); return i; }

  function togglePause(){ state.paused=!state.paused; if(!state.paused){ state.last=performance.now(); } }
  function pauseForShell(){
    if(state.over) return;
    if(state.paused){ state.shellPaused=false; return; }
    state.shellPaused=true;
    state.paused=true;
  }
  function resumeFromShell(){
    if(!state.shellPaused || state.over) return;
    state.shellPaused=false;
    state.paused=false;
    state.last=performance.now();
  }
  function toggleDiag(){ state.debug=!state.debug; state.diag.classList.toggle("show", state.debug); }
  function copyDiag(){ const pre=state.diag && state.diag.querySelector("pre"); if(pre) navigator.clipboard && navigator.clipboard.writeText(pre.textContent).catch(()=>{}); }

  // Replay
  function playReplay(){
    if(state.replay.length<10) return toast("Not enough replay data yet");
    state.paused=true;
    const frames = state.replay.slice(-Math.min(state.replay.length, 5*60));
    const saveBalls = state.balls.map(b=>({...b}));
    const saveP1 = {...state.p1}, saveP2 = {...state.p2};
    const ctx = state.ctx;
    let i=0;
    const step=()=>{
      if(i>=frames.length){ state.p1=saveP1; state.p2=saveP2; state.balls=saveBalls; state.paused=false; return; }
      const f=frames[i++];
      state.p1.y=f.p1y; state.p2.y=f.p2y;
      state.balls = f.balls.map(b=>({...b, spin:0, lastHit:null}));
      // draw only
      ctx.save(); clear(); drawNet(); rect(state.p1.x, state.p1.y, state.p1.w, state.p1.h, getCSS("--pong-fg")); rect(state.p2.x, state.p2.y, state.p2.w, state.p2.h, getCSS("--pong-fg")); for(const b of state.balls){ circle(b.x,b.y,b.r, getCSS("--pong-fg")); } ctx.restore();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- Canvas ----------
  function installCanvas(){
    const el = document.getElementById("game");
    state.canvas = el;
  }
  function ensureContext(){
    const ctx = state.canvas.getContext("2d", {alpha:false, desynchronized:true});
    if(!ctx || typeof ctx.clearRect !== "function"){
      installCanvas();
      const retry = state.canvas.getContext && state.canvas.getContext("2d", {alpha:false, desynchronized:true});
      if(!retry || typeof retry.clearRect !== "function"){
        throw new Error("Canvas context unavailable");
      }
      state.ctx = retry; return;
    }
    state.ctx = ctx;
  }
  function onResize(){
    const el = state.canvas;
    const rect = el.getBoundingClientRect();
    const cssW = rect.width, cssH = rect.height;
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(cssW * dpr), targetH = Math.round(cssH * dpr);
    if(el.width!==targetW || el.height!==targetH){ el.width=targetW; el.height=targetH; }
    state.ctx.setTransform(targetW/W, 0, 0, targetH/H, 0, 0);
    state.ratio = (targetW/W);
  }

  // ---------- Events ----------
  function addEvents(){
    window.addEventListener("resize", onResize);
    const onShellPause=()=>pauseForShell();
    const onShellResume=()=>{ if(!document.hidden) resumeFromShell(); };
    const onVisibility=()=>{ if(document.hidden) pauseForShell(); else resumeFromShell(); };
    const onMessage=(event)=>{
      const data=event && typeof event.data==="object" ? event.data : null;
      const type=data?.type;
      if(type==="GAME_PAUSE" || type==="GG_PAUSE") pauseForShell();
      if(type==="GAME_RESUME" || type==="GG_RESUME") resumeFromShell();
    };
    window.addEventListener("ggshell:pause", onShellPause);
    window.addEventListener("ggshell:resume", onShellResume);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("message", onMessage, {passive:true});
    window.addEventListener("keydown", e=>{
      pressed.add(e.code);
      if(e.code===state.keys.pause){ togglePause(); e.preventDefault(); }
      bindMove();
    }, {passive:false});
    window.addEventListener("keyup", e=>{ pressed.delete(e.code); bindMove(); });

    // Touch (left half controls P1)
    state.canvas.addEventListener("pointerdown", onPointer, {passive:true});
    state.canvas.addEventListener("pointermove", onPointer, {passive:true});

    window.addEventListener("gamepadconnected", (e)=>{ state.gamepad = e.gamepad; });
    window.addEventListener("gamepaddisconnected", ()=>{ state.gamepad = null; });
  }

  // ---------- Boot ----------
  function boot(){
    try{
      const app = document.getElementById("app");
      app.innerHTML="";
      buildUI(app);
      reset(); saveLS();
      state.running=true; state.paused=false; state.over=false; state.last=performance.now(); requestAnimationFrame(frame);
      post("GAME_READY");
    }catch(err){
      console.error("[pong] boot error", err);
      post("GAME_ERROR", String(err&&err.message||err));
      if(state.diag){ const pre=state.diag.querySelector("pre"); pre.textContent = String(err && (err.stack||err.message)||err) + "\n" + pre.textContent; state.diag.classList.add("show"); }
    }
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", boot, {once:true});
  else boot();

})();
