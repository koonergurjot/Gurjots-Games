(function(){
  "use strict";
  const SLUG = "pong";
  const LS_KEY = "pong.v2";
  const DFLT = {
    mode:"1P",
    ai:"Normal",
    toScore:11,
    winByTwo:true,
    powerups:true,
    sfx:true,
    keys:{p1Up:"KeyW", p1Down:"KeyS", p2Up:"ArrowUp", p2Down:"ArrowDown", pause:"Space"},
  };
  const state = { ...DFLT, ...loadLS(), running:false, debug:hasDebug(), t0:0, last:0, dt:0,
    canvas:null, ctx:null, ratio:1, paused:false, over:false,
    score:{p1:0,p2:0}, ball:null, p1:null, p2:null, hud:null, diag:null, loopId:0,
    gamepad:null, beepCtx:null
  };

  function hasDebug(){ try { return new URLSearchParams(location.search).has("debug"); } catch(_){ return false; } }
  function loadLS(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||"{}"); }catch(_){return {}}}
  function saveLS(){ try{ localStorage.setItem(LS_KEY, JSON.stringify({mode:state.mode, ai:state.ai, toScore:state.toScore, winByTwo:state.winByTwo, powerups:state.powerups, sfx:state.sfx, keys:state.keys})); }catch(_){ } }
  function post(type, message){ try { parent && parent.postMessage({type, slug:SLUG, message}, "*"); } catch(_){ } }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

  function h(tag, props={}, ...kids){
    const el = document.createElement(tag);
    for(const [k,v] of Object.entries(props)){
      if(k==="class") el.className=v;
      else if(k.startsWith("on")) el.addEventListener(k.slice(2), v, {passive:true});
      else if(k==="html") el.innerHTML=v;
      else el.setAttribute(k,v);
    }
    for(const k of kids) if(k!=null) el.append(k);
    return el;
  }
  function buildUI(root){
    const bar = h("div",{class:"pong-bar", role:"toolbar","aria-label":"Pong toolbar"},
      h("span",{class:"pong-title"},"Pong"),
      h("span",{class:"pong-chip",title:"Mode"}, ()=>state.mode ),
      h("span",{class:"pong-spacer"}),
      h("button",{class:"pong-btn",title:"Keybinds",onclick:()=>openKeybinds()}, "Keybinds"),
      h("button",{class:"pong-btn",title:"Toggle Diagnostics",onclick:()=>toggleDiag()}, "Diagnostics"),
      h("button",{class:"pong-btn",title:"Pause/Resume (Space)",onclick:()=>togglePause()}, "Pause"),
      h("button",{class:"pong-btn",title:"Restart match",onclick:()=>{reset()}}, "Restart")
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
    const wrap = h("div",{class:"pong-canvas-wrap"},
      state.canvas = h("canvas",{class:"pong-canvas", id:"pong-canvas", width:1280, height:720})
    );
    const diag = state.diag = h("div",{class:"pong-diag"+(state.debug?" show":""), id:"diag"},
      h("div",{class:"row"},
        h("button",{class:"pong-btn",onclick:()=>copyDiag()},"Copy"),
        h("button",{class:"pong-btn",onclick:()=>{state.debug=false; state.diag.classList.remove('show');}},"Close")
      ),
      h("pre",{}, "Diagnostics ready.")
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
          h("button",{class:"pong-btn",onclick:()=>{Object.assign(state.keys, {p1Up:'KeyW',p1Down:'KeyS',p2Up:'ArrowUp',p2Down:'ArrowDown',pause:'Space'}); renderKeyRows();}},"Reset")
        )
      )
    );
    root.append(bar, wrap, hud, menu, diag, keyModal);
    state.hud = {p1: hud.querySelector("#score-p1"), p2: hud.querySelector("#score-p2")};
    onResize(); addEvents();
  }
  function keyRow(label, key){
    const span = h("span",{id:"key-"+key}, prettyKey(state.keys[key]));
    const btn = h("button",{class:"pong-btn",onclick:()=>listenKey(key, span)},"Change");
    return h("div",{class:"pong-row"}, h("label",{}, label+":"), span, btn);
  }
  function prettyKey(code){ return code.replace(/^Key/,'').replace(/^Arrow/,''); }
  function renderKeyRows(){
    for(const k of Object.keys(state.keys)){
      const el = document.getElementById("key-"+k);
      if(el) el.textContent = prettyKey(state.keys[k]);
    }
  }
  function listenKey(key, span){
    span.textContent = "…";
    const fn = (e)=>{
      e.preventDefault();
      state.keys[key] = e.code || e.key || "Unidentified";
      renderKeyRows();
      window.removeEventListener("keydown", fn, true);
    };
    window.addEventListener("keydown", fn, true);
  }
  function openKeybinds(){ state.keyModal.classList.add("show"); }
  function closeKeybinds(){ state.keyModal.classList.remove("show"); }
  function labelSel(name, opts, onChange){
    const sel = h("select",{class:"pong-select",onchange:(e)=>onChange(e.target.value)}, ...opts.map(v=>h("option",{value:String(v), selected:String(v)===String(state[name.toLowerCase()]||state[name])},String(v))));
    return h("label",{}, name, " ", sel);
  }
  function labelChk(name, val, onChange){
    const id = "chk-"+name.replace(/\\s+/g,'-').toLowerCase();
    const input = h("input",{id, type:"checkbox", class:"pong-input", checked:val, onchange:(e)=>onChange(e.target.checked)});
    return h("label",{for:id}, input," ", name);
  }

  function beep(freq=440, dur=0.05){
    if(!state.sfx) return;
    try{
      state.beepCtx = state.beepCtx || new (window.AudioContext||window.webkitAudioContext)();
      const ctx = state.beepCtx;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.value = 0.02;
      o.connect(g).connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur);
    }catch(_){ }
  }

  function reset(){
    state.score.p1 = 0; state.score.p2 = 0; updateHUD();
    state.p1 = {x:32, y:360-60, w:18, h:120, dy:0, speed:520};
    state.p2 = {x:1280-50, y:360-60, w:18, h:120, dy:0, speed:520};
    spawnBall();
    state.over=false; state.paused=false;
  }
  function spawnBall(dir = Math.random()<0.5? -1 : 1){
    state.ball = {x:1280/2, y:720/2, r:9, dx: dir*350, dy: (Math.random()*2-1)*220, spin:0};
  }
  function award(pointTo){
    state.score[pointTo]++; updateHUD(); beep(660, 0.04);
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
  function endMatch(){ state.over=true; state.paused=true; toast("Match over"); beep(220,0.2); }
  function toast(msg){ if(state.diag) { const pre = state.diag.querySelector("pre"); pre.textContent = `[note] ${msg}\\n` + pre.textContent; } }
  function updateHUD(){ state.hud.p1.textContent=String(state.score.p1); state.hud.p2.textContent=String(state.score.p2); }

  function onResize(){
    const el = state.canvas;
    if(!(el instanceof HTMLCanvasElement)){
      installCanvas();
    }
    const rect = state.canvas.getBoundingClientRect();
    const ratio = Math.max(1, Math.floor(window.devicePixelRatio||1));
    state.ratio = ratio;
    state.canvas.width = Math.round(rect.width * ratio);
    state.canvas.height = Math.round(rect.height * ratio);
  }
  function aiTick(dt){
    if(state.mode!=="1P") return;
    const target = state.ball.y - state.p2.h/2;
    const k = state.ai==="Easy" ? 0.03 : state.ai==="Normal" ? 0.06 : 0.11;
    state.p2.y += clamp((target - state.p2.y)*k, -state.p2.speed*dt, state.p2.speed*dt);
  }
  function physics(dt){
    const W = state.canvas.width, H = state.canvas.height, K = state.ratio;
    state.p1.y = Math.max(0, Math.min(H - state.p1.h*K, state.p1.y + state.p1.dy*dt*K));
    if(state.mode==="2P") state.p2.y = Math.max(0, Math.min(H - state.p2.h*K, state.p2.y + state.p2.dy*dt*K));
    const b = state.ball;
    b.x += b.dx*dt*K; b.y += b.dy*dt*K;
    if(b.y - b.r < 0){ b.y = b.r; b.dy *= -1; beep(520,0.02); }
    if(b.y + b.r > H){ b.y = H - b.r; b.dy *= -1; beep(520,0.02); }
    collidePaddle(state.p1); collidePaddle(state.p2);
    if(b.x < 0) award("p2");
    if(b.x > W) award("p1");
  }
  function collidePaddle(p){
    const b = state.ball;
    const px1=p.x, py1=p.y, px2=p.x+p.w*state.ratio, py2=p.y+p.h*state.ratio;
    if(b.x+b.r>px1 && b.x-b.r<px2 && b.y+b.r>py1 && b.y-b.r<py2){
      b.dx *= -1;
      const hit = (b.y - (p.y + (p.h*state.ratio)/2)) / ((p.h*state.ratio)/2);
      b.dy = Math.max(-720, Math.min(720, b.dy + hit*260 + p.dy*0.15));
      if(state.powerups){
        const s = Math.hypot(b.dx, b.dy) * 1.03; const ang=Math.atan2(b.dy,b.dx); b.dx=Math.cos(ang)*s; b.dy=Math.sin(ang)*s;
      }
      b.x = (b.dx<0) ? px1 - b.r : px2 + b.r;
      beep(880,0.02);
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
    pollGamepad();
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
  function copyDiag(){
    const pre = state.diag && state.diag.querySelector("pre");
    if(!pre) return;
    navigator.clipboard && navigator.clipboard.writeText(pre.textContent).catch(()=>{});
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
    window.addEventListener("gamepadconnected", (e)=>{ state.gamepad = e.gamepad; });
    window.addEventListener("gamepaddisconnected", ()=>{ state.gamepad = null; });
  }
  function onPoint(e){
    const r = state.canvas.getBoundingClientRect(); const y = (e.clientY - r.top) * state.ratio - state.p1.h*state.ratio/2;
    if(e.clientX < r.left + r.width/2){ state.p1.y = Math.max(0, Math.min(state.canvas.height - state.p1.h*state.ratio, y)); }
    else { state.p2.y = Math.max(0, Math.min(state.canvas.height - state.p2.h*state.ratio, y)); }
  }
  function bindMove(){
    const v = 720;
    state.p1.dy = (pressed.has(state.keys.p1Down) ? v : 0) - (pressed.has(state.keys.p1Up) ? v : 0);
    state.p2.dy = (pressed.has(state.keys.p2Down) ? v : 0) - (pressed.has(state.keys.p2Up) ? v : 0);
  }
  function pollGamepad(){
    if(!('getGamepads' in navigator)) return;
    const pads = navigator.getGamepads();
    const gp = pads && pads[0];
    if(!gp) return;
    const axis = gp.axes[1]||0;
    const v = 720 * axis;
    const toP2 = !!(gp.buttons[5] && gp.buttons[5].pressed);
    if(toP2){ state.p2.dy = v; } else { state.p1.dy = v; }
    if(gp.buttons[0] && gp.buttons[0].pressed){ state.paused=false; }
    if(gp.buttons[1] && gp.buttons[1].pressed){ togglePause(); }
  }
  function togglePause(){ state.paused=!state.paused; }
  function toggleDiag(){ state.debug=!state.debug; state.diag.classList.toggle("show", state.debug); }

  function installCanvas(){
    const existing = document.getElementById("pong-canvas");
    if(existing && !(existing instanceof HTMLCanvasElement)){
      existing.parentNode && existing.parentNode.removeChild(existing);
    }
    let c = document.getElementById("pong-canvas");
    if(!c){
      c = document.createElement("canvas");
      c.className = "pong-canvas"; c.id = "pong-canvas"; c.width = 1280; c.height = 720;
      const wrap = document.querySelector(".pong-canvas-wrap") || document.getElementById("app") || document.body;
      wrap.appendChild(c);
    }
    state.canvas = c;
  }
  function ensureContext(){
    if(!(state.canvas instanceof HTMLCanvasElement)) installCanvas();
    const ctx = state.canvas.getContext && state.canvas.getContext("2d", {alpha:false, desynchronized:true});
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

  function boot(){
    try{
      const app = document.getElementById("app");
      app.innerHTML="";
      buildUI(app);
      installCanvas();
      ensureContext();
      reset(); saveLS();
      state.running=true; state.paused=false; state.over=false; state.last=performance.now(); frame(state.last);
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