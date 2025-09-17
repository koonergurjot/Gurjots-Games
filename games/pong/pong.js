(function(){
  "use strict";
  const SLUG = "pong";
  const LS_KEY = "pong.v2";
  const DFLT = {
    mode:"1P",          // 1P | 2P | PRACTICE
    ai:"Normal",        // Easy | Normal | Hard
    toScore:11,
    winByTwo:true,
    powerups:true,
    sfx:false,
    keys:{p1Up:"KeyW", p1Down:"KeyS", p2Up:"ArrowUp", p2Down:"ArrowDown", pause:"Space"},
  };
  const state = { ...DFLT, ...loadLS(), running:false, debug:hasDebug(), t0:0, last:0, dt:0,
    canvas:null, ctx:null, ratio:1, paused:false, over:false,
    score:{p1:0,p2:0}, ball:null, p1:null, p2:null, hud:null, diag:null, loopId:0,
  };

  function hasDebug(){ try { return new URLSearchParams(location.search).has("debug"); } catch(_){ return false; } }
  function loadLS(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||"{}"); }catch(_){return {}}}
  function saveLS(){ try{ localStorage.setItem(LS_KEY, JSON.stringify({mode:state.mode, ai:state.ai, toScore:state.toScore, winByTwo:state.winByTwo, powerups:state.powerups, sfx:state.sfx, keys:state.keys})); }catch(_){ } }
  function post(type, message){ try { parent && parent.postMessage({type, slug:SLUG, message}, "*"); } catch(_){ } }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function now(){ return (performance||Date).now(); }

  // --- UI --------------------------------------------------------------------
  function h(tag, props={}, ...kids){
    const el = document.createElement(tag);
    for(const [k,v] of Object.entries(props)){ if(k==="class") el.className=v; else if(k.startsWith("on")) el.addEventListener(k.slice(2), v, {passive:true}); else if(k==="html") el.innerHTML=v; else el.setAttribute(k,v); }
    for(const k of kids) if(k!=null) el.append(k);
    return el;
  }
  function buildUI(root){
    const bar = h("div",{class:"pong-bar", role:"toolbar","aria-label":"Pong toolbar"},
      h("span",{class:"pong-title"},"Pong"),
      h("span",{class:"pong-chip",title:"Mode"}, ()=>state.mode ),
      h("span",{class:"pong-spacer"}),
      h("button",{class:"pong-btn",title:"Toggle Diagnostics",onclick:()=>toggleDiag()}, "Diagnostics"),
      h("button",{class:"pong-btn",title:"Pause/Resume (Space)",onclick:()=>togglePause()}, "Pause")
    );
    const hud = h("div",{class:"pong-hud", role:"status","aria-live":"polite"},
      h("div",{class:"pong-score",id:"score-p1"},"0"),
      h("div",{class:"pong-mid"},"—"),
      h("div",{class:"pong-score",id:"score-p2"},"0"),
    );
    const menu = h("div",{class:"pong-menu"},
      labelSel("Mode",["1P","2P","PRACTICE"], v => (state.mode=v, reset())),
      labelSel("AI",["Easy","Normal","Hard"], v => (state.ai=v, reset())),
      labelSel("To", [5,7,11,15], v => (state.toScore=+v, reset())),
      labelChk("Win by 2", state.winByTwo, v => (state.winByTwo=v, reset())),
      labelChk("Power-ups", state.powerups, v => (state.powerups=v)),
      labelChk("SFX", state.sfx, v => (state.sfx=v)),
    );
    const wrap = h("div",{class:"pong-canvas-wrap"}, state.canvas = h("canvas",{class:"pong-canvas", id:"canvas", width:1280, height:720}));
    const diag = state.diag = h("div",{class:"pong-diag"+(state.debug?" show":""), id:"diag"}, h("pre",{}, "Diagnostics ready."));
    root.append(bar, wrap, hud, menu, diag);
    state.hud = {p1: hud.querySelector("#score-p1"), p2: hud.querySelector("#score-p2")};
    onResize(); addEvents();
  }
  function labelSel(name, opts, onChange){
    const sel = h("select",{class:"pong-select",onchange:(e)=>onChange(e.target.value)}, ...opts.map(v=>h("option",{value:String(v), selected:String(v)===String(state[name.toLowerCase()]||state[name])},String(v))));
    return h("label",{}, name, " ", sel);
  }
  function labelChk(name, val, onChange){
    const id = "chk-"+name.replace(/\s+/g,'-').toLowerCase();
    const input = h("input",{id, type:"checkbox", class:"pong-input", checked:val, onchange:(e)=>onChange(e.target.checked)});
    return h("label",{for:id}, input," ", name);
  }

  // --- Game objects ----------------------------------------------------------
  function reset(){
    state.score.p1 = 0; state.score.p2 = 0; updateHUD();
    state.p1 = {x:32, y:360-60, w:18, h:120, dy:0, speed:520};
    state.p2 = {x:1280-50, y:360-60, w:18, h:120, dy:0, speed:520};
    spawnBall();
  }
  function spawnBall(dir = Math.random()<0.5? -1 : 1){
    state.ball = {x:1280/2, y:720/2, r:9, dx: dir*350, dy: (Math.random()*2-1)*220, spin:0};
  }
  function award(pointTo){
    state.score[pointTo]++; updateHUD();
    if(isMatchOver()) endMatch(); else spawnBall(pointTo==="p1" ? 1 : -1);
  }
  function isMatchOver(){
    const a=state.score.p1, b=state.score.p2, T=state.toScore;
    if(a>=T||b>=T){
      if(!state.winByTwo) return true;
      return Math.abs(a-b)>=2;
    }
    return false;
  }
  function endMatch(){ state.over=true; state.paused=true; toast("Match over"); }
  function toast(msg){ if(state.diag) { const pre = state.diag.querySelector("pre"); pre.textContent = `[note] ${msg}\n` + pre.textContent; } }
  function updateHUD(){ state.hud.p1.textContent=String(state.score.p1); state.hud.p2.textContent=String(state.score.p2); }

  // --- Loop ------------------------------------------------------------------
  function onResize(){
    // devicePixelRatio-aware backing store
    const el = state.canvas; const rect = el.getBoundingClientRect();
    const ratio = Math.max(1, Math.floor(window.devicePixelRatio||1));
    state.ratio = ratio; el.width = Math.round(rect.width * ratio); el.height = Math.round(rect.height * ratio);
  }
  function aiTick(dt){
    if(state.mode!=="1P") return;
    const target = state.ball.y - state.p2.h/2;
    const k = state.ai==="Easy" ? 0.03 : state.ai==="Normal" ? 0.06 : 0.11;
    state.p2.y += clamp((target - state.p2.y)*k, -state.p2.speed*dt, state.p2.speed*dt);
  }
  function physics(dt){
    const W = state.canvas.width, H = state.canvas.height, K = state.ratio;
    // integrate paddles
    state.p1.y = clamp(state.p1.y + state.p1.dy*dt*K, 0, H - state.p1.h*K);
    if(state.mode==="2P") state.p2.y = clamp(state.p2.y + state.p2.dy*dt*K, 0, H - state.p2.h*K);
    // ball
    const b = state.ball;
    b.x += b.dx*dt*K; b.y += b.dy*dt*K;
    // walls
    if(b.y - b.r < 0){ b.y = b.r; b.dy *= -1; }
    if(b.y + b.r > H){ b.y = H - b.r; b.dy *= -1; }
    // paddles
    collidePaddle(state.p1); collidePaddle(state.p2);
    // goals
    if(b.x < 0) award("p2");
    if(b.x > W) award("p1");
  }
  function collidePaddle(p){
    const b = state.ball;
    const px1=p.x, py1=p.y, px2=p.x+p.w*state.ratio, py2=p.y+p.h*state.ratio;
    if(b.x+b.r>px1 && b.x-b.r<px2 && b.y+b.r>py1 && b.y-b.r<py2){
      b.dx *= -1;
      // add “english” based on hit offset and paddle velocity:
      const hit = (b.y - (p.y + (p.h*state.ratio)/2)) / ((p.h*state.ratio)/2);
    }
  }
})();
      b.dy = clamp(b.dy + hit*260 + p.dy*0.15, -720, 720);
      if(state.powerups){
        const s = Math.hypot(b.dx, b.dy) * 1.03; const ang=Math.atan2(b.dy,b.dx); b.dx=Math.cos(ang)*s; b.dy=Math.sin(ang)*s;
      }
      b.x = (b.dx<0) ? px1 - b.r : px2 + b.r;
    }
  }
  function render(){
    const ctx = state.ctx, W = state.canvas.width, H = state.canvas.height, K = state.ratio;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = "#0f1720"; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#1f2b3b"; for(let y=10; y<H; y+=40){ ctx.fillRect(W/2-3, y, 6, 28); }
    ctx.fillStyle = "#e8f1ff"; ctx.fillRect(state.p1.x, state.p1.y, state.p1.w*K, state.p1.h*K);
    ctx.fillRect(state.p2.x, state.p2.y, state.p2.w*K, state.p2.h*K);
    ctx.beginPath(); ctx.arc(state.ball.x, state.ball.y, state.ball.r, 0, Math.PI*2); ctx.fill();
  }
  function frame(t){
    state.loopId = requestAnimationFrame(frame);
    const dt = Math.min(0.033, (t - state.last)/1000 || 0); state.last=t; state.dt=dt;
    if(!state.paused && !state.over){
      if(state.mode==="1P") aiTick(dt);
      physics(dt); render();
    }
    if(state.debug) diagTick();
  }
  function diagTick(){
    if(!state.diag) return;
    const pre = state.diag.querySelector("pre");
    pre.textContent =
`mode=${state.mode} ai=${state.ai} powerups=${state.powerups}
score=${state.score.p1}-${state.score.p2} paused=${state.paused} over=${state.over}
dt=${(state.dt*1000).toFixed(2)}ms DPR=${state.ratio}
ball=(${state.ball.x|0},${state.ball.y|0}) v=(${state.ball.dx|0},${state.ball.dy|0})
` + pre.textContent.slice(0,400);
  }
  const pressed = new Set();
  function addEvents(){
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", ()=> { state.paused = document.hidden || state.paused; });
    window.addEventListener("keydown", e=>{
      pressed.add(e.code);
      if(e.code===state.keys.pause){ togglePause(); e.preventDefault(); }
      bindMove();
    }, {passive:false});
    window.addEventListener("keyup", e=>{ pressed.delete(e.code); bindMove(); });
    state.canvas.addEventListener("pointerdown", onPoint, {passive:true});
    state.canvas.addEventListener("pointermove", onPoint, {passive:true});
  }
  function onPoint(e){
    const r = state.canvas.getBoundingClientRect(); const y = (e.clientY - r.top) * state.ratio - state.p1.h*state.ratio/2;
    if(e.clientX < r.left + r.width/2){ state.p1.y = clamp(y,0,state.canvas.height - state.p1.h*state.ratio); }
    else { state.p2.y = clamp(y,0,state.canvas.height - state.p2.h*state.ratio); }
  }
  function bindMove(){
    const v = 720;
    state.p1.dy = (pressed.has(state.keys.p1Down) ? v : 0) - (pressed.has(state.keys.p1Up) ? v : 0);
    state.p2.dy = (pressed.has(state.keys.p2Down) ? v : 0) - (pressed.has(state.keys.p2Up) ? v : 0);
  }
  function togglePause(){ state.paused=!state.paused; }
  function toggleDiag(){ state.debug=!state.debug; state.diag.classList.toggle("show", state.debug); }
  function boot(){
    try{
      const app = document.getElementById("app");
      app.innerHTML="";
      buildUI(app);
      state.canvas = document.getElementById("canvas");
      state.ctx = state.canvas.getContext("2d", {alpha:false, desynchronized:true});
      reset(); saveLS();
      state.running=true; state.paused=false; state.over=false; state.last=now(); frame(state.last);
      post("GAME_READY");
    }catch(err){
      console.error("[pong] boot error", err);
      post("GAME_ERROR", String(err&&err.message||err));
      if(state.diag){ const pre=state.diag.querySelector("pre"); pre.textContent = "BOOT ERROR: "+String(err)+"\n"+pre.textContent; state.diag.classList.add("show"); }
    }
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", boot, {once:true});
  else boot();
})();