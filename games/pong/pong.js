
import { pushEvent } from "/games/common/diag-adapter.js";
import { preloadFirstFrameAssets } from "../../shared/game-asset-preloader.js";
import { play as playSfx } from "../../shared/juice/audio.js";

(function(){
  "use strict";

  const SLUG = "pong";
  const LS_KEY = "pong.v3";
  const W = 1280, H = 720;
  const STEP = 1/60;
  const MAX_FRAME_DELTA = 0.1;

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
    running:false, t0:0, last:0, dt:0, acc:0,
    canvas:null, ctx:null, ratio:1, scaleX:1, scaleY:1, paused:false, over:false,
    score:{p1:0,p2:0}, ball:null, balls:[], p1:null, p2:null, hud:null, loopId:0,
    effects:[], shakes:0, themeClass:"theme-neon", gamepad:null, keyModal:null,
    trail:[], trailMax:20, touches:{}, replay:[], replayMax:5*60, recording:true,
    shellPaused:false,
    images:{ powerups:{}, effects:{} },
    backgroundLayers:null,
  };

  const globalScope = typeof window !== "undefined" ? window : undefined;
  const pongReadyQueue = (() => {
    if (!globalScope) return [];
    if (Array.isArray(globalScope.__PONG_READY__)) return globalScope.__PONG_READY__;
    const queue = [];
    globalScope.__PONG_READY__ = queue;
    return queue;
  })();

  const SPRITE_SOURCES = {
    paddle: "/assets/sprites/paddle.png",
    ball: "/assets/sprites/ball.png",
    particle: "/assets/effects/particle.png",
    net: "/assets/effects/particle.png",
    spark: "/assets/effects/spark.png",
    explosion: "/assets/effects/explosion.png",
    shield: "/assets/effects/shield.png",
  };

  const PARALLAX_LAYERS = [
    { src: "/assets/backgrounds/parallax/arcade_layer1.png", speed: 18, alpha: 0.85 },
    { src: "/assets/backgrounds/parallax/arcade_layer2.png", speed: 36, alpha: 1 },
  ];

  const POWERUP_SOURCES = {
    grow: SPRITE_SOURCES.shield,
    shrink: SPRITE_SOURCES.particle,
    slow: SPRITE_SOURCES.particle,
    fast: SPRITE_SOURCES.spark,
    multiball: SPRITE_SOURCES.explosion,
    ghost: SPRITE_SOURCES.shield,
  };

  preloadFirstFrameAssets(SLUG).catch(()=>{});

  function createImage(src){
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    return img;
  }

  function ensureSprites(){
    if(!state.images) state.images = { powerups:{}, effects:{} };
    const images = state.images;
    images.paddle = images.paddle || createImage(SPRITE_SOURCES.paddle);
    images.ball = images.ball || createImage(SPRITE_SOURCES.ball);
    images.net = images.net || createImage(SPRITE_SOURCES.net);
    if(!images.effects) images.effects = {};
    images.effects.spark = images.effects.spark || createImage(SPRITE_SOURCES.spark);
    images.effects.explosion = images.effects.explosion || createImage(SPRITE_SOURCES.explosion);
    images.effects.shield = images.effects.shield || createImage(SPRITE_SOURCES.shield);
    if(!images.powerups) images.powerups = {};
    for(const [kind, src] of Object.entries(POWERUP_SOURCES)){
      if(!images.powerups[kind]) images.powerups[kind] = createImage(src);
    }
    ensureParallaxLayers();
  }

  function drawSprite(img, x, y, w, h, alpha=1){
    if(!img || !img.complete || !img.naturalWidth) return;
    const ctx = state.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  function drawSpriteCentered(img, x, y, w, h, alpha=1){
    drawSprite(img, x - w/2, y - h/2, w, h, alpha);
  }

  function emitStateChange(field, value){
    pushEvent("state", {
      slug: SLUG,
      field,
      value,
      mode: state.mode,
      difficulty: state.ai,
    });
  }

  // ---------- Utilities ----------
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

  // ---------- Audio ----------
  function playSound(name){
    if(!state.sfx) return;
    try{ playSfx(name); }catch(err){ console.warn("[pong] sfx failed", err); }
  }

  // ---------- Rendering helpers ----------
  function ensureParallaxLayers(){
    if(state.backgroundLayers) return;
    const layers = [];
    for(const cfg of PARALLAX_LAYERS){
      const img = createImage(cfg.src);
      const layer = {
        image: img,
        speed: Number.isFinite(cfg.speed) ? cfg.speed : 0,
        alpha: typeof cfg.alpha === "number" ? Math.max(0, Math.min(1, cfg.alpha)) : 1,
        offset: 0,
        width: 0,
        height: 0,
      };
      if(img){
        img.addEventListener("load", ()=>{
          layer.width = img.naturalWidth || img.width || 0;
          layer.height = img.naturalHeight || img.height || 0;
        });
        img.addEventListener("error", ()=>{
          layer.width = 0;
          layer.height = 0;
        });
      }
      layers.push(layer);
    }
    state.backgroundLayers = layers;
  }

  function getParallaxMetrics(layer){
    if(!layer || !layer.image) return null;
    const img = layer.image;
    const baseW = img.naturalWidth || img.width || layer.width || 0;
    const baseH = img.naturalHeight || img.height || layer.height || 0;
    if(!baseW || !baseH) return null;
    layer.width = baseW;
    layer.height = baseH;
    const destHeight = H;
    const destWidth = destHeight * (baseW / baseH);
    if(!Number.isFinite(destWidth) || destWidth <= 0) return null;
    return { width: destWidth, height: destHeight };
  }

  function updateParallax(delta){
    ensureParallaxLayers();
    if(!Array.isArray(state.backgroundLayers)) return;
    if(state.reduceMotion) return;
    for(const layer of state.backgroundLayers){
      const metrics = getParallaxMetrics(layer);
      if(!metrics) continue;
      const speed = layer.speed || 0;
      if(!speed) continue;
      let offset = (layer.offset || 0) + speed * delta;
      const span = metrics.width;
      if(span > 0){
        offset %= span;
        if(offset < 0) offset += span;
      }
      layer.offset = offset;
    }
  }

  function drawParallaxBackground(){
    const ctx = state.ctx;
    if(!ctx) return;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = "#050516";
    ctx.fillRect(0,0,W,H);
    ensureParallaxLayers();
    if(!Array.isArray(state.backgroundLayers)) return;
    for(const layer of state.backgroundLayers){
      const metrics = getParallaxMetrics(layer);
      if(!metrics) continue;
      const alpha = layer.alpha ?? 1;
      let startX = -(layer.offset || 0);
      while(startX > 0) startX -= metrics.width;
      ctx.save();
      ctx.globalAlpha = alpha;
      for(let x=startX; x < W; x += metrics.width){
        ctx.drawImage(layer.image, x, 0, metrics.width, metrics.height);
      }
      ctx.restore();
    }
  }

  function clear(){
    ensureSprites();
    drawParallaxBackground();
  }
  function getCSS(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#fff"; }

  function drawNet(){
    const img = state.images?.net;
    if(!img || !img.complete || !img.naturalWidth) return;
    const segmentHeight = 48;
    const segmentWidth = 24;
    const gap = 18;
    for(let y=0; y<H; y+=segmentHeight+gap){
      drawSprite(img, W/2 - segmentWidth/2, y, segmentWidth, segmentHeight, 0.85);
    }
  }

  function spawnEffect(type, x, y, opts={}){
    if(state.reduceMotion) return;
    ensureSprites();
    const sprite = state.images?.effects?.[type];
    if(!sprite) return;
    const duration = opts.duration || 0.5;
    state.effects.push({
      type,
      x,
      y,
      duration,
      life: duration,
      scale: opts.scale || 1,
    });
  }

  function updateEffects(dt){
    if(!state.effects || !state.effects.length) return;
    const remaining=[];
    for(const fx of state.effects){
      fx.life -= dt;
      if(fx.life>0){
        remaining.push(fx);
      }
    }
    state.effects = remaining;
  }

  function drawEffects(){
    if(!state.effects || !state.effects.length) return;
    for(const fx of state.effects){
      const img = state.images?.effects?.[fx.type];
      if(!img || !img.complete || !img.naturalWidth) continue;
      const progress = Math.max(0, Math.min(1, fx.life / fx.duration));
      const alpha = Math.pow(progress, 0.6);
      const w = img.naturalWidth * fx.scale;
      const h = img.naturalHeight * fx.scale;
      drawSpriteCentered(img, fx.x, fx.y, w, h, alpha);
    }
  }

  function drawPaddleSprite(p){
    const img = state.images?.paddle;
    if(img && img.complete && img.naturalWidth){
      drawSprite(img, p.x, p.y, p.w, p.h, 1);
    } else {
      const ctx = state.ctx;
      ctx.fillStyle = getCSS("--pong-fg");
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
  }

  function drawBallSprite(b, alpha=1){
    const img = state.images?.ball;
    const size = b.r * 2;
    if(img && img.complete && img.naturalWidth){
      drawSpriteCentered(img, b.x, b.y, size, size, alpha);
    } else {
      const ctx = state.ctx;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = getCSS("--pong-fg");
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPowerupSprite(pu){
    const img = state.images?.powerups?.[pu.kind];
    const size = pu.r * 2;
    if(img && img.complete && img.naturalWidth){
      drawSpriteCentered(img, pu.x, pu.y, size, size, Math.min(1, pu.life/8 + 0.2));
    } else {
      const ctx = state.ctx;
      ctx.save();
      ctx.globalAlpha = Math.min(1, pu.life/8 + 0.2);
      ctx.fillStyle = getCSS("--pong-accent");
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- Game objects ----------
  function reset(){
    state.score.p1=0; state.score.p2=0; updateHUD();
    state.balls.length=0;
    powerups.length=0;
    state.effects.length=0;
    state.trail.length=0;
    state.p1 = {x:32, y:H/2-60, w:18, h:120, dy:0, speed:560, maxH:180, minH:80};
    state.p2 = {x:W-50, y:H/2-60, w:18, h:120, dy:0, speed:560, maxH:180, minH:80};
    spawnBall(Math.random()<0.5? -1 : 1);
    state.over=false; state.paused=false;
    if(Array.isArray(state.backgroundLayers)){
      for(const layer of state.backgroundLayers){
        if(layer) layer.offset = 0;
      }
    }
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

  function endMatch(){ state.over=true; state.paused=true; toast("Match over"); playSound("explode"); }

  function toast(msg){
    pushEvent("game", { level:"info", message:`[${SLUG}] ${msg}` });
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

  function pointerToGame(e){
    const rect = state.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    return { x, y };
  }

  function onPointer(e){
    const { y } = pointerToGame(e);
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
    if(b.y < b.r && b.dy < 0){ b.y=b.r; b.dy = -b.dy; spawnEffect("spark", b.x, b.y, {scale:0.6, duration:0.3}); playSound("hit"); }
    if(b.y > H-b.r && b.dy > 0){ b.y=H-b.r; b.dy = -b.dy; spawnEffect("spark", b.x, b.y, {scale:0.6, duration:0.3}); playSound("hit"); }

    // Paddle collisions
    // P1
    if(b.dx < 0 && b.x - b.r <= state.p1.x + state.p1.w && b.x >= state.p1.x){
      if(circleRectOverlap(b, state.p1)){
        if(!useGhost(state.p1, b, -1)){
          b.x = state.p1.x + state.p1.w + b.r;
          collidePaddle(b, state.p1, 1);
        }
      }
    }
    // P2
    if(b.dx > 0 && b.x + b.r >= state.p2.x && b.x <= state.p2.x + state.p2.w){
      if(circleRectOverlap(b, state.p2)){
        if(!useGhost(state.p2, b, 1)){
          b.x = state.p2.x - b.r;
          collidePaddle(b, state.p2, -1);
        }
      }
    }

    // Score
    if(b.x < -40){ award("p2"); respawn(b, 1); }
    if(b.x > W+40){ award("p1"); respawn(b, -1); }
  }

  function respawn(b, dir){ Object.assign(b, {x:W/2, y:H/2, dx:dir*rand(340,420), dy:rand(-220,220), spin:0, lastHit:null}); }

  function circleRectOverlap(ball, paddle){
    const px = clamp(ball.x, paddle.x, paddle.x + paddle.w);
    const py = clamp(ball.y, paddle.y, paddle.y + paddle.h);
    const dx = ball.x - px;
    const dy = ball.y - py;
    return (dx*dx + dy*dy) <= ball.r * ball.r;
  }

  function useGhost(p, ball, approach){
    const key = (p===state.p1 ? "p1_ghost" : "p2_ghost");
    if(state[key] && state[key] > 0){
      state[key] = 0;
      if(approach < 0){
        ball.x = p.x - ball.r - 0.1;
      } else {
        ball.x = p.x + p.w + ball.r + 0.1;
      }
      return true;
    }
    return false;
  }

  function collidePaddle(b, p, dir){
    // hit offset (-1..1)
    const rel = clamp((b.y - (p.y + p.h/2)) / (p.h/2), -1, 1);
    const speed = Math.hypot(b.dx, b.dy);
    const add = rel * 280;
    b.dx = Math.sign(dir) * Math.max(240, speed*0.92);
    b.dy = clamp(b.dy + add, -640, 640);
    // Spin depends on paddle movement and offset
    b.spin = clamp((p.dy*0.8) + rel*2.0, -6, 6);
    b.lastHit = p===state.p1 ? "p1" : "p2";

    // Add FX
    spawnEffect("spark", b.x, b.y, {scale:0.8, duration:0.35});
    shake(6);
    playSound("hit");
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
  state.powerups = powerups;
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
    for(const pu of powerups){ drawPowerupSprite(pu); }
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
          spawnEffect("explosion", pu.x, pu.y, {scale:1.2, duration:0.6});
          playSound("power");
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
  function update(dt){
    state.dt = dt;

    for(const flag of ["p1_ghost","p2_ghost"]){
      if(state[flag] && state[flag] > 0){
        state[flag] = Math.max(0, state[flag] - dt);
      }
    }

    updatePaddle(state.p1, dt);
    updatePaddle(state.p2, dt);
    if(state.mode!=="2P") moveAI(dt);

    maybeSpawnPowerup(dt);
    updatePowerups(dt);

    for(const b of state.balls){ updateBall(b, dt); }
    checkPowerupCollisions();
    updateEffects(dt);

    if(state.recording){
      state.replay.push({p1y:state.p1.y, p2y:state.p2.y, balls:state.balls.map(b=>({x:b.x,y:b.y,dx:b.dx,dy:b.dy,r:b.r}))});
      if(state.replay.length>state.replayMax) state.replay.shift();
    }
  }

  function render(){
    const ctx=state.ctx;
    ctx.save();
    clear();
    applyShake();

    drawNet();

    drawPowerups();

    drawPaddleSprite(state.p1);
    drawPaddleSprite(state.p2);

    if(!state.reduceMotion){
      for(const b of state.balls){
        state.trail.push({x:b.x,y:b.y,r:b.r,life:0.35,duration:0.35});
      }
      const t2=[];
      for(const t of state.trail){
        t.life -= state.dt;
        if(t.life>0){
          const duration = t.duration || 0.35;
          const fade = Math.max(0, Math.min(1, t.life / duration));
          drawBallSprite({x:t.x, y:t.y, r:t.r}, fade*0.6);
          t2.push(t);
        }
      }
      state.trail = t2.slice(-120);
    }

    for(const b of state.balls){ drawBallSprite(b); }

    drawEffects();
    endShake();
    ctx.restore();
  }

  function frame(t){
    state.loopId = requestAnimationFrame(frame);
    const delta = Math.min(MAX_FRAME_DELTA, (t - (state.last||t)) / 1000); // Fixed-step integration with an accumulator; clamp to avoid spiral of death.
    state.last = t;

    updateParallax(delta);

    if(!state.running){
      state.dt = 0;
      render();
      return;
    }

    if(state.paused){
      state.acc = 0;
      state.dt = 0;
      render();
      return;
    }

    state.acc += delta;
    while(state.acc >= STEP){
      update(STEP);
      state.acc -= STEP;
    }

    render();
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
      h("button",{class:"pong-btn",onclick:openKeybinds},"Keys")
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
        select(["1P","2P","Endless","Mayhem"], state.mode, v=>{state.mode=v; saveLS(); reset(); emitStateChange("mode", v);})
      ),
      // AI
      h("div",{class:"pong-row"},
        h("label",{},"AI:"),
        select(["Easy","Normal","Hard","Insane"], state.ai, v=>{state.ai=v; saveLS(); emitStateChange("difficulty", v);})
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
        select(["neon","vapor","crt","minimal"], state.theme, v=>{state.theme=v; saveLS();
          // Preserve shell/host classes on <body>; only swap the theme-specific class.
          document.body.classList.remove("theme-neon","theme-vapor","theme-crt","theme-minimal");
          document.body.classList.add(themeToClass(v));
        })
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

    root.append(bar, wrap, hud, menu, keyModal);
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
      ctx.save();
      clear();
      drawNet();
      drawPaddleSprite(state.p1);
      drawPaddleSprite(state.p2);
      for(const b of state.balls){ drawBallSprite(b); }
      ctx.restore();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function matchStatus(){
    if(state.over) return "game-over";
    if(state.paused) return "paused";
    if(state.running) return "running";
    return "idle";
  }

  function getScoreSnapshot(){
    return {
      status: matchStatus(),
      p1: state.score?.p1 ?? 0,
      p2: state.score?.p2 ?? 0,
      mode: state.mode,
      ai: state.ai,
      target: state.toScore,
      winByTwo: !!state.winByTwo,
    };
  }

  function getLifecycleSnapshot(){
    return {
      status: matchStatus(),
      running: !!state.running,
      paused: !!state.paused,
      over: !!state.over,
      shellPaused: !!state.shellPaused,
    };
  }

  function getEntitySnapshot(){
    const paddles = [];
    if(state.p1){
      paddles.push({
        id:"p1",
        x: state.p1.x,
        y: state.p1.y,
        w: state.p1.w,
        h: state.p1.h,
        dy: state.p1.dy,
        speed: state.p1.speed,
      });
    }
    if(state.p2){
      paddles.push({
        id:"p2",
        x: state.p2.x,
        y: state.p2.y,
        w: state.p2.w,
        h: state.p2.h,
        dy: state.p2.dy,
        speed: state.p2.speed,
      });
    }
    const balls = state.balls.map((b, index)=>({
      id:index,
      x:b.x,
      y:b.y,
      dx:b.dx,
      dy:b.dy,
      r:b.r,
      spin:b.spin,
      lastHit:b.lastHit||null,
    }));
    const activePowerups = powerups.map((pu, index)=>({
      id:index,
      kind:pu.kind,
      x:pu.x,
      y:pu.y,
      r:pu.r,
      life:pu.life,
    }));
    return {
      score: getScoreSnapshot(),
      lifecycle: getLifecycleSnapshot(),
      paddles,
      balls,
      powerups: activePowerups,
    };
  }

  function startGame(){
    reset();
    state.running=true;
    state.over=false;
    state.shellPaused=false;
    state.paused=false;
    state.last=performance.now();
  }

  function pauseGame(){
    if(state.over || state.paused) return;
    state.shellPaused=false;
    togglePause();
  }

  function resumeGame(){
    if(state.over || !state.paused) return;
    if(state.shellPaused){
      resumeFromShell();
      return;
    }
    state.shellPaused=false;
    togglePause();
  }

  if(globalScope){
    const api = globalScope.Pong || {};
    api.state = state;
    api.reset = reset;
    api.togglePause = togglePause;
    api.pauseForShell = pauseForShell;
    api.resumeFromShell = resumeFromShell;
    api.emitStateChange = emitStateChange;
    api.playReplay = playReplay;
    api.pushEvent = pushEvent;
    api.getScoreSnapshot = getScoreSnapshot;
    api.getLifecycleSnapshot = getLifecycleSnapshot;
    api.getEntitySnapshot = getEntitySnapshot;
    api.start = startGame;
    api.pause = pauseGame;
    api.resume = resumeGame;
    api.controls = Object.assign({}, api.controls, {
      start: startGame,
      pause: pauseGame,
      resume: resumeGame,
      reset,
    });
    api.ready = (callback)=>{
      if(typeof callback!=="function") return;
      try{ callback(api); }catch(err){ console.error("[pong] ready callback failed", err); }
    };
    globalScope.Pong = api;
    const queueTarget = Array.isArray(pongReadyQueue) ? pongReadyQueue : [];
    globalScope.__PONG_READY__ = queueTarget;
    if(queueTarget.length){
      const pending = queueTarget.splice(0, queueTarget.length);
      for(const cb of pending){
        try{ cb(api); }catch(err){ console.error("[pong] ready callback failed", err); }
      }
    }
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
      retry.imageSmoothingEnabled = false;
      state.ctx = retry;
      ensureSprites();
      return;
    }
    ctx.imageSmoothingEnabled = false;
    state.ctx = ctx;
    ensureSprites();
  }
  function onResize(){
    const el = state.canvas;
    const rect = el.getBoundingClientRect();
    const cssW = rect.width, cssH = rect.height;
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(cssW * dpr), targetH = Math.round(cssH * dpr);
    if(el.width!==targetW || el.height!==targetH){ el.width=targetW; el.height=targetH; }
    const scaleX = targetW / W;
    const scaleY = targetH / H;
    state.ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    state.scaleX = scaleX;
    state.scaleY = scaleY;
    state.ratio = scaleY;
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
      pushEvent("game", { level:"error", message:`[${SLUG}] boot error`, details:{ error: err && (err.stack || err.message) || err } });
    }
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", boot, {once:true});
  else boot();

})();
