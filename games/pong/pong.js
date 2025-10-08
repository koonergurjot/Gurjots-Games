
import { pushEvent } from "/games/common/diag-adapter.js";
import { preloadFirstFrameAssets } from "../../shared/game-asset-preloader.js";
import { play as playSfx } from "../../shared/juice/audio.js";
import "./pauseOverlay.js";

(function(){
  "use strict";

  const SLUG = "pong";
  const LS_KEY = "pong.v3";
  const W = 1280, H = 720;
  const STEP = 1/60;
  const MAX_FRAME_DELTA = 0.1;

  const AI_LEVELS = ["Easy","Medium","Hard"];
  const AI_SETTINGS = {
    Easy:   { speed: 460, reaction: 0.26, offset: 90, noise: 18 },
    Medium: { speed: 560, reaction: 0.16, offset: 42, noise: 10 },
    Hard:   { speed: 720, reaction: 0.08, offset: 14, noise: 4 },
  };
  const SPIN_ACCEL = 22;
  const SPIN_DECAY = 0.985;
  const TOUCH_DEBOUNCE_MS = 18;
  const TOUCH_MIN_DELTA = 2.5;
  const TOUCH_SCALE = 88;

  const DFLT = {
    mode:"1P",            // 1P, 2P, Endless, Mayhem
    ai:"Medium",          // Easy, Medium, Hard
    toScore:11,
    winByTwo:true,
    powerups:true,
    sfx:true,
    theme:"neon",         // neon | vapor | crt | minimal
    reduceMotion:false,
    keys:{p1Up:"KeyW", p1Down:"KeyS", p2Up:"ArrowUp", p2Down:"ArrowDown", pause:"Space"},
  };

  const BG_HUE_BASE_A = 220;
  const BG_HUE_BASE_B = 260;
  const BG_HUE_AMP = 15;
  const BG_HUE_SPEED = 0.05;
  const BG_VIGNETTE_ALPHA = 0.4;

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
    backgroundCanvas:null,
    backgroundCtx:null,
    pauseOverlay:null,
    debugHud:null,
    debugVisible:false,
    debugData:{ ballSpeed:0, dt:0, lastNormal:{x:0,y:0} },
    axes:{
      keyboard:{p1:0,p2:0},
      touch:{p1:0,p2:0},
      ai:{p1:0,p2:0},
      combined:{p1:0,p2:0},
    },
    touchBuffer:[],
    aiBrain:{ targetY:H/2, timer:0 },
  };

  if(!AI_LEVELS.includes(state.ai)){
    if(state.ai === "Normal") state.ai = "Medium";
    else if(state.ai === "Insane") state.ai = "Hard";
    else state.ai = "Medium";
  }

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

  const OVERLAY_FADE_MS = 220;

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

  function ensureBackgroundCanvas(){
    if(state.backgroundCanvas && state.backgroundCtx) return state.backgroundCanvas;
    if(typeof document === "undefined") return null;
    let canvas = state.backgroundCanvas;
    if(!canvas){
      canvas = document.querySelector(".pong-bg-canvas");
      if(!canvas){
        canvas = document.createElement("canvas");
        canvas.className = "pong-bg-canvas";
        canvas.setAttribute("aria-hidden", "true");
        const target = document.body || document.documentElement;
        if(target.firstChild){
          target.insertBefore(canvas, target.firstChild);
        } else {
          target.appendChild(canvas);
        }
      }
      state.backgroundCanvas = canvas;
    }
    const ctx = canvas.getContext("2d");
    if(!ctx) return null;
    state.backgroundCtx = ctx;
    return canvas;
  }

  function resizeBackgroundCanvas(){
    if(typeof window === "undefined") return;
    const canvas = ensureBackgroundCanvas();
    if(!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));
    if(canvas.width !== width || canvas.height !== height){
      canvas.width = width;
      canvas.height = height;
    }
  }

  function renderBackground(timeMs){
    if(typeof window === "undefined") return;
    const canvas = ensureBackgroundCanvas();
    const ctx = state.backgroundCtx;
    if(!canvas || !ctx) return;
    resizeBackgroundCanvas();
    const w = canvas.width;
    const h = canvas.height;
    if(!w || !h) return;
    const seconds = (timeMs || performance.now()) / 1000;
    const phase = seconds * BG_HUE_SPEED;
    const motionScale = state.reduceMotion ? 0 : 1;
    const hue1 = BG_HUE_BASE_A + BG_HUE_AMP * Math.sin(phase) * motionScale;
    const hue2 = BG_HUE_BASE_B + BG_HUE_AMP * Math.sin(phase + Math.PI / 2) * motionScale;
    ctx.globalCompositeOperation = "source-over";
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, `hsl(${hue1}, 60%, 12%)`);
    gradient.addColorStop(1, `hsl(${hue2}, 60%, 10%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const radius = Math.sqrt(w * w + h * h) * 0.6;
    const vignette = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, radius);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, `rgba(0,0,0,${BG_VIGNETTE_ALPHA})`);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
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
    hidePauseOverlay();
    state.shellPaused=false;
    state.touches = {};
    state.touchBuffer.length = 0;
    Object.assign(state.axes.keyboard, {p1:0,p2:0});
    Object.assign(state.axes.touch, {p1:0,p2:0});
    Object.assign(state.axes.ai, {p1:0,p2:0});
    Object.assign(state.axes.combined, {p1:0,p2:0});
    state.aiBrain = { targetY:H/2, timer:0 };
    state.debugData.ballSpeed = 0;
    state.debugData.lastNormal = {x:0,y:0};
    resolveMovementAxes();
    if(Array.isArray(state.backgroundLayers)){
      for(const layer of state.backgroundLayers){
        if(layer) layer.offset = 0;
      }
    }
    updateTitleOverlay();
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

  function endMatch(){
    if (state.over) return;
    state.over=true;
    state.paused=true;
    toast("Match over");
    playSound("explode");
    const winner = state.score.p1 === state.score.p2 ? null : state.score.p1 > state.score.p2 ? 'p1' : 'p2';
    const details = { winner, left: state.score.p1, right: state.score.p2, mode: state.mode };
    scenes.push(() => createGameOverScene(details)).catch(err => console.error('[pong] gameover scene failed', err));
  }

  function toast(msg){
    pushEvent("game", { level:"info", message:`[${SLUG}] ${msg}` });
  }

  function updateHUD(){
    state.hud.p1.textContent=String(state.score.p1);
    state.hud.p2.textContent=String(state.score.p2);
  }

  // ---------- Input ----------
  const pressed = new Set();

  function resolveMovementAxes(){
    const sources = state.axes;
    const sum = (side)=>{
      return clamp(
        (sources.keyboard?.[side] || 0) +
        (sources.touch?.[side] || 0) +
        (sources.ai?.[side] || 0),
        -1,
        1
      );
    };
    const p1Axis = sum("p1");
    const p2Axis = sum("p2");
    sources.combined.p1 = p1Axis;
    sources.combined.p2 = p2Axis;
    if(state.p1) state.p1.dy = p1Axis;
    if(state.p2) state.p2.dy = p2Axis;
  }

  function bindMove(){
    state.axes.keyboard.p1 = (pressed.has(state.keys.p1Down)? 1:0) - (pressed.has(state.keys.p1Up)? 1:0);
    if(state.mode==="2P"){
      state.axes.keyboard.p2 = (pressed.has(state.keys.p2Down)? 1:0) - (pressed.has(state.keys.p2Up)? 1:0);
    } else {
      state.axes.keyboard.p2 = 0;
    }
    resolveMovementAxes();
  }

  function queueTouchImpulse(side, deltaX, timestamp){
    if(side==="p2" && state.mode!=="2P") return;
    const direction = deltaX > 0 ? 1 : -1;
    const magnitude = Math.min(1.25, Math.abs(deltaX) / TOUCH_SCALE);
    state.touchBuffer.push({ side, value: direction * magnitude, time: timestamp });
  }

  function consumeTouchBuffer(dt){
    const buffer = state.touchBuffer;
    if(buffer.length){
      for(const item of buffer){
        const side = item.side;
        state.axes.touch[side] = clamp((state.axes.touch[side] || 0) + item.value, -1.5, 1.5);
      }
      buffer.length = 0;
    }
    const decay = Math.exp(-dt * 6);
    for(const side of ["p1","p2"]){
      state.axes.touch[side] = (state.axes.touch[side] || 0) * decay;
      if(Math.abs(state.axes.touch[side]) < 0.01) state.axes.touch[side] = 0;
    }
  }

  function pointerToGame(e){
    const rect = state.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    return { x, y };
  }

  function inputSideFromX(x){
    return x < W/2 ? "p1" : "p2";
  }

  function directMovePaddle(side, y){
    if(side==="p2" && state.mode!=="2P") return;
    const paddle = side==="p1" ? state.p1 : state.p2;
    if(!paddle) return;
    paddle.y = clamp(y - paddle.h/2, 0, H - paddle.h);
  }

  function trackTouch(id, data){
    state.touches[id] = data;
  }

  function forgetTouch(id){
    delete state.touches[id];
  }

  function onPointerDown(e){
    const id = e.pointerId ?? `ptr-${Math.random()}`;
    const pos = pointerToGame(e);
    const side = inputSideFromX(pos.x);
    if(e.pointerType === "mouse"){
      directMovePaddle(side, pos.y);
      state.canvas.setPointerCapture?.(e.pointerId);
    }
    trackTouch(id, {
      id,
      side,
      pointerType: e.pointerType || "mouse",
      lastX: pos.x,
      lastY: pos.y,
      lastEmit: performance.now(),
    });
  }

  function onPointerMove(e){
    const id = e.pointerId ?? "mouse";
    const touch = state.touches[id];
    if(!touch) return;
    const pos = pointerToGame(e);
    if(touch.pointerType === "mouse"){
      directMovePaddle(touch.side, pos.y);
      touch.lastX = pos.x;
      touch.lastY = pos.y;
      return;
    }
    const now = performance.now();
    const deltaX = pos.x - touch.lastX;
    if(Math.abs(deltaX) >= TOUCH_MIN_DELTA && (now - touch.lastEmit) >= TOUCH_DEBOUNCE_MS){
      queueTouchImpulse(touch.side, deltaX, now);
      touch.lastEmit = now;
    }
    touch.lastX = pos.x;
    touch.lastY = pos.y;
  }

  function onPointerUp(e){
    const id = e.pointerId ?? "mouse";
    forgetTouch(id);
  }

  // ---------- AI ----------
  function moveAI(dt){
    if(state.mode==="2P") return;
    const config = AI_SETTINGS[state.ai] || AI_SETTINGS.Medium;
    state.p2.speed = config.speed;
    const brain = state.aiBrain;
    brain.timer = Math.max(0, brain.timer - dt);
    const nearest = state.balls[0];
    if(nearest && nearest.dx > 0){
      if(brain.timer <= 0){
        const predicted = predictY(nearest, config.reaction);
        const offset = (Math.random()*2 - 1) * config.offset;
        const target = clamp(predicted + offset, state.p2.h/2, H - state.p2.h/2);
        brain.targetY = target;
        brain.timer = config.reaction;
      }
    } else if(brain.timer <= 0){
      brain.targetY = H/2;
      brain.timer = config.reaction * 0.75;
    }
    const aim = brain.targetY ?? H/2;
    const noisy = clamp(aim + rand(-config.noise, config.noise), state.p2.h/2, H - state.p2.h/2);
    const center = state.p2.y + state.p2.h/2;
    const diff = noisy - center;
    const axis = clamp(diff / (state.p2.h * 0.5), -1, 1);
    state.axes.ai.p2 = axis;
  }

  function predictY(ball, delay=0){
    // simulate bounces on vertical walls
    let x=ball.x + ball.dx * delay;
    let y=ball.y + ball.dy * delay;
    let dx=ball.dx, dy=ball.dy;
    const steps = 240; // rough
    for(let i=0;i<steps;i++){
      const t=1/120;
      x += dx*t; y += dy*t;
      if(y < ball.r && dy<0){ dy = -dy; y = ball.r; }
      if(y > H-ball.r && dy>0){ dy = -dy; y = H-ball.r; }
      if(dx>0 && x>=state.p2.x) break;
    }
    return clamp(y, ball.r, H - ball.r);
  }

  // ---------- Physics ----------
  function updatePaddle(p, dt){
    p.y = clamp(p.y + p.dy * p.speed * dt, 0, H - p.h);
  }

  function updateBall(b, dt){
    let remaining = dt;
    let guard = 0;
    while(remaining > 0.00001 && guard++ < 8){
      const collision = findEarliestCollision(b, remaining);
      const slice = collision ? Math.max(0, Math.min(collision.time, remaining)) : remaining;
      if(slice > 0){
        const spinAccel = b.spin * SPIN_ACCEL;
        b.dy += spinAccel * slice;
        b.x += b.dx * slice;
        b.y += b.dy * slice;
        b.spin *= SPIN_DECAY;
      }
      remaining -= slice;

      if(!collision || collision.time > slice + 1e-6) continue;

      switch(collision.type){
        case "wall":{
          const normal = collision.normal || {x:0,y:1};
          state.debugData.lastNormal = {x:normal.x, y:normal.y};
          if(normal.y > 0){
            b.y = Math.max(b.r, b.y);
            b.dy = Math.abs(b.dy);
          } else if(normal.y < 0){
            b.y = Math.min(H - b.r, b.y);
            b.dy = -Math.abs(b.dy);
          }
          spawnEffect("spark", b.x, b.y, {scale:0.6, duration:0.3});
          playSound("hit");
          break;
        }
        case "paddle":{
          const paddle = collision.paddle;
          const dir = collision.dir;
          if(useGhost(paddle, b, -dir)){
            if(dir < 0){
              b.x = paddle.x - b.r - 0.2;
            } else {
              b.x = paddle.x + paddle.w + b.r + 0.2;
            }
            state.debugData.lastNormal = {x:0,y:0};
          } else {
            collidePaddle(b, paddle, dir, collision.point);
          }
          break;
        }
        case "score":{
          award(collision.side);
          respawn(b, collision.side === "p1" ? -1 : 1);
          state.debugData.lastNormal = {x:0,y:0};
          return;
        }
      }
    }
  }

  function respawn(b, dir){
    Object.assign(b, {x:W/2, y:H/2, dx:dir*rand(340,420), dy:rand(-220,220), spin:0, lastHit:null});
  }

  function findEarliestCollision(ball, dt){
    let result = null;
    const record = (candidate)=>{
      if(!candidate) return;
      if(candidate.time < 0 || candidate.time > dt) return;
      if(!result || candidate.time < result.time){
        result = candidate;
      }
    };

    // Top & bottom walls
    if(ball.dy < 0){
      const time = (ball.r - ball.y) / ball.dy;
      record({ time, type:"wall", normal:{x:0,y:1} });
    } else if(ball.dy > 0){
      const time = ((H - ball.r) - ball.y) / ball.dy;
      record({ time, type:"wall", normal:{x:0,y:-1} });
    }

    if(ball.dx < 0){
      const paddleHit = sweptCircleRect(ball, state.p1, dt);
      if(paddleHit){
        record({ time:paddleHit.time, type:"paddle", paddle:state.p1, dir:1, point:paddleHit.point });
      }
      const scoreTime = ((-40) - ball.x) / ball.dx;
      record({ time:scoreTime, type:"score", side:"p2" });
    } else if(ball.dx > 0){
      const paddleHit = sweptCircleRect(ball, state.p2, dt);
      if(paddleHit){
        record({ time:paddleHit.time, type:"paddle", paddle:state.p2, dir:-1, point:paddleHit.point });
      }
      const scoreTime = ((W + 40) - ball.x) / ball.dx;
      record({ time:scoreTime, type:"score", side:"p1" });
    }

    return result;
  }

  function sweptCircleRect(ball, paddle, dt){
    if(!paddle) return null;
    const expanded = {
      minX: paddle.x - ball.r,
      maxX: paddle.x + paddle.w + ball.r,
      minY: paddle.y - ball.r,
      maxY: paddle.y + paddle.h + ball.r,
    };
    let tEnter = 0;
    let tExit = dt;

    const vx = ball.dx;
    const vy = ball.dy;

    if(vx === 0){
      if(ball.x < expanded.minX || ball.x > expanded.maxX) return null;
    } else {
      let tx1 = (expanded.minX - ball.x) / vx;
      let tx2 = (expanded.maxX - ball.x) / vx;
      if(tx1 > tx2) [tx1, tx2] = [tx2, tx1];
      tEnter = Math.max(tEnter, tx1);
      tExit = Math.min(tExit, tx2);
    }

    if(vy === 0){
      if(ball.y < expanded.minY || ball.y > expanded.maxY) return null;
    } else {
      let ty1 = (expanded.minY - ball.y) / vy;
      let ty2 = (expanded.maxY - ball.y) / vy;
      if(ty1 > ty2) [ty1, ty2] = [ty2, ty1];
      tEnter = Math.max(tEnter, ty1);
      tExit = Math.min(tExit, ty2);
    }

    if(tEnter > tExit || tExit < 0) return null;
    const time = Math.max(0, tEnter);
    if(time > dt) return null;

    const point = {
      x: ball.x + ball.dx * time,
      y: ball.y + ball.dy * time,
    };
    return { time, point };
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

  function collidePaddle(b, p, dir, point){
    const contact = computeContactData(b, p, dir, point);
    const normal = contact.normal;
    state.debugData.lastNormal = {x:normal.x, y:normal.y};
    const velocity = { x: b.dx, y: b.dy };
    const dot = velocity.x * normal.x + velocity.y * normal.y;
    let rx = velocity.x - 2 * dot * normal.x;
    let ry = velocity.y - 2 * dot * normal.y;
    let mag = Math.hypot(rx, ry);
    if(mag === 0){
      rx = dir;
      ry = 0;
      mag = 1;
    }
    const targetSpeed = Math.max(260, Math.min(Math.hypot(velocity.x, velocity.y) * 1.05, 900));
    rx = (rx / mag) * targetSpeed;
    ry = (ry / mag) * targetSpeed;

    const tangent = { x: -normal.y, y: normal.x };
    const paddleVelocity = (p.dy || 0) * (p.speed || 0);
    const tangentAdjust = paddleVelocity * 0.35 + contact.offset * 340;
    rx += tangent.x * tangentAdjust;
    ry += tangent.y * tangentAdjust;

    b.dx = rx;
    b.dy = clamp(ry, -900, 900);
    b.spin = clamp((paddleVelocity / Math.max(1, p.speed || 1)) * 4 + contact.offset * 5, -8, 8);
    b.lastHit = p===state.p1 ? "p1" : "p2";

    const pushPoint = contact.point;
    b.x = pushPoint.x + normal.x * (b.r + 0.5);
    b.y = clamp(pushPoint.y + normal.y * (b.r + 0.5), b.r, H - b.r);

    spawnEffect("spark", b.x, b.y, {scale:0.8, duration:0.35});
    shake(6);
    playSound("hit");
  }

  function computeContactData(ball, paddle, dir, point){
    const cx = point?.x ?? ball.x;
    const cy = point?.y ?? ball.y;
    const px = clamp(cx, paddle.x, paddle.x + paddle.w);
    const py = clamp(cy, paddle.y, paddle.y + paddle.h);
    let nx = cx - px;
    let ny = cy - py;
    const dist = Math.hypot(nx, ny);
    if(dist === 0){
      nx = dir;
      ny = 0;
    } else {
      nx /= dist;
      ny /= dist;
    }
    const offset = clamp((py - (paddle.y + paddle.h/2)) / (paddle.h/2), -1, 1);
    const pointOnSurface = {
      x: dist === 0 ? (dir < 0 ? paddle.x : paddle.x + paddle.w) : px,
      y: py,
    };
    return {
      normal: { x: nx, y: ny },
      offset,
      point: pointOnSurface,
    };
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
    state.debugData.dt = dt;

    for(const flag of ["p1_ghost","p2_ghost"]){
      if(state[flag] && state[flag] > 0){
        state[flag] = Math.max(0, state[flag] - dt);
      }
    }

    consumeTouchBuffer(dt);
    state.axes.ai.p1 = 0;
    state.axes.ai.p2 = 0;
    if(state.mode!=="2P") moveAI(dt);
    else state.p2.speed = state.p1?.speed || state.p2.speed;
    resolveMovementAxes();

    updatePaddle(state.p1, dt);
    updatePaddle(state.p2, dt);

    maybeSpawnPowerup(dt);
    updatePowerups(dt);

    for(const b of state.balls){ updateBall(b, dt); }
    const firstBall = state.balls[0];
    state.debugData.ballSpeed = firstBall ? Math.hypot(firstBall.dx, firstBall.dy) : 0;
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

    updateDebugHud();
  }

  function ensureDebugHud(){
    if(state.debugHud) return state.debugHud;
    if(typeof document === "undefined") return null;
    const root = document.createElement("div");
    root.className = "pong-debug";
    root.setAttribute("aria-live", "polite");
    const title = document.createElement("div");
    title.className = "pong-debug__title";
    title.textContent = "Debug HUD";
    const body = document.createElement("pre");
    body.className = "pong-debug__body";
    root.append(title, body);
    (document.body || document.documentElement).appendChild(root);
    state.debugHud = { root, body };
    return state.debugHud;
  }

  function toggleDebugHud(force){
    const next = force===undefined ? !state.debugVisible : !!force;
    state.debugVisible = next;
    const hud = ensureDebugHud();
    if(!hud) return;
    hud.root.classList.toggle("show", next);
    if(next) updateDebugHud();
  }

  function updateDebugHud(){
    if(!state.debugVisible) return;
    const hud = ensureDebugHud();
    if(!hud) return;
    const { ballSpeed, dt, lastNormal } = state.debugData || {};
    const nx = lastNormal?.x ?? 0;
    const ny = lastNormal?.y ?? 0;
    hud.body.textContent = `ball: ${(ballSpeed||0).toFixed(1)} px/s\n` +
      `dt: ${(dt||0).toFixed(4)} s\n` +
      `normal: (${nx.toFixed(2)}, ${ny.toFixed(2)})`;
    hud.root.classList.add("show");
  }

  function frame(t){
    state.loopId = requestAnimationFrame(frame);
    const delta = Math.min(MAX_FRAME_DELTA, (t - (state.last||t)) / 1000); // Fixed-step integration with an accumulator; clamp to avoid spiral of death.
    state.last = t;
    renderBackground(t);

    updateParallax(delta);
    try { scenes.update(delta); } catch (err) { console.error('[pong] scene update failed', err); }

    if(!state.running){
      state.dt = 0;
      state.debugData.dt = 0;
      render();
      return;
    }

    if(state.paused){
      state.acc = 0;
      state.dt = 0;
      state.debugData.dt = 0;
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
    ensureBackgroundCanvas();
    resizeBackgroundCanvas();

    const bar = h("div",{class:"pong-bar"},
      h("div",{class:"pong-title"},"Pong"),
      h("span",{class:"pong-spacer"}),
      h("span",{class:"pong-kbd"},"Pause: Space"),
      h("button",{class:"pong-btn",onclick:()=>dispatchAction('pause',{source:'ui', reason:'user'})},"Pause"),
      h("button",{class:"pong-btn",onclick:openKeybinds},"Keys")
    );

    const canvasEl = h("canvas",{class:"pong-canvas", id:"game", width:String(W), height:String(H), role:"img", "aria-label":"Pong gameplay"});

    const overlayRoot = h("div",{class:"pong-overlay", id:"pong-overlay", "aria-live":"polite", "aria-hidden":"true"});
    const overlayTitleMessage = h("p",{class:"pong-overlay__text", id:"pong-overlay-title"},"");
    const overlayStartBtn = h("button",{class:"pong-overlay__btn", id:"pong-overlay-start"},"Start Match");
    const overlayTitlePanel = h("div",{class:"pong-overlay__panel", "data-scene":"title"},
      h("h2",{class:"pong-overlay__heading"},"Pong Classic"),
      overlayTitleMessage,
      h("div",{class:"pong-overlay__actions"}, overlayStartBtn)
    );

    const overlayPauseMessage = h("p",{class:"pong-overlay__text", id:"pong-overlay-pause"},"Game paused");
    const overlayResumeBtn = h("button",{class:"pong-overlay__btn", id:"pong-overlay-resume"},"Resume");
    const overlayRestartBtn = h("button",{class:"pong-overlay__btn", id:"pong-overlay-restart"},"Restart");
    const overlayMenuBtn = h("button",{class:"pong-overlay__btn", id:"pong-overlay-menu"},"Main Menu");
    const overlayPausePanel = h("div",{class:"pong-overlay__panel", "data-scene":"pause"},
      h("h2",{class:"pong-overlay__heading"},"Paused"),
      overlayPauseMessage,
      h("div",{class:"pong-overlay__actions"}, overlayResumeBtn, overlayRestartBtn, overlayMenuBtn)
    );

    const overlayGameOverHeading = h("h2",{class:"pong-overlay__heading", id:"pong-overlay-gameover-heading"},"Match Over");
    const overlayGameOverDetail = h("p",{class:"pong-overlay__text", id:"pong-overlay-gameover-detail"},"");
    const overlayGameOverScore = h("p",{class:"pong-overlay__score", id:"pong-overlay-gameover-score"},"");
    const overlayGameOverRestart = h("button",{class:"pong-overlay__btn", id:"pong-overlay-gameover-restart"},"Play Again");
    const overlayGameOverMenu = h("button",{class:"pong-overlay__btn", id:"pong-overlay-gameover-menu"},"Main Menu");
    const overlayGameOverPanel = h("div",{class:"pong-overlay__panel", "data-scene":"gameover"},
      overlayGameOverHeading,
      overlayGameOverDetail,
      overlayGameOverScore,
      h("div",{class:"pong-overlay__actions"}, overlayGameOverRestart, overlayGameOverMenu)
    );

    overlayRoot.append(overlayTitlePanel, overlayPausePanel, overlayGameOverPanel);

    const wrap = h("div",{class:"pong-canvas-wrap"}, canvasEl, overlayRoot);

    const hud = h("div",{class:"pong-hud"},
      h("div",{class:"pong-score", id:"score-p1"},"0"),
      h("div",{class:"pong-mid"},"—"),
      h("div",{class:"pong-score", id:"score-p2"},"0"),
      h("span",{class:"touch-hint"}," • Swipe left/right to move")
    );

    const menu = h("div",{class:"pong-menu"},
      h("div",{class:"pong-row"},
        h("label",{},"Mode:"),
        select(["1P","2P","Endless","Mayhem"], state.mode, v=>{state.mode=v; saveLS(); reset(); emitStateChange("mode", v);})
      ),
      h("div",{class:"pong-row"},
        h("label",{},"AI:"),
        select(["Easy","Medium","Hard"], state.ai, v=>{state.ai=v; saveLS(); emitStateChange("difficulty", v);})
      ),
      h("div",{class:"pong-row"},
        h("label",{},"To Score:"),
        number(state.toScore, v=>{state.toScore=v; saveLS(); updateTitleOverlay();})
      ),
      h("div",{class:"pong-row"},
        h("label",{},"Powerups:"),
        toggle(state.powerups, v=>{state.powerups=v; saveLS();})
      ),
      h("div",{class:"pong-row"},
        h("label",{},"SFX:"),
        toggle(state.sfx, v=>{state.sfx=v; saveLS();})
      ),
      h("div",{class:"pong-row"},
        h("label",{},"Theme:"),
        select(["neon","vapor","crt","minimal"], state.theme, v=>{state.theme=v; saveLS();
          document.body.classList.remove("theme-neon","theme-vapor","theme-crt","theme-minimal");
          document.body.classList.add(themeToClass(v));
        })
      ),
      h("div",{class:"pong-row"},
        h("label",{},"Reduce motion:"),
        toggle(state.reduceMotion, v=>{state.reduceMotion=v; saveLS();})
      ),
      h("button",{class:"pong-btn",onclick:playReplay},"Instant Replay"),
      h("button",{class:"pong-btn",onclick:()=>dispatchAction('restart',{source:'ui'})},"Reset Match")
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
    state.overlay = {
      root: overlayRoot,
      current: null,
      title: { panel: overlayTitlePanel, message: overlayTitleMessage, startBtn: overlayStartBtn },
      pause: { panel: overlayPausePanel, message: overlayPauseMessage, resumeBtn: overlayResumeBtn, restartBtn: overlayRestartBtn, menuBtn: overlayMenuBtn },
      gameover: { panel: overlayGameOverPanel, heading: overlayGameOverHeading, detail: overlayGameOverDetail, score: overlayGameOverScore, restartBtn: overlayGameOverRestart, menuBtn: overlayGameOverMenu },
    };

    overlayStartBtn.addEventListener('click', () => dispatchAction('start', { source: 'ui' }));
    overlayResumeBtn.addEventListener('click', () => dispatchAction('resume', { source: 'ui' }));
    overlayRestartBtn.addEventListener('click', () => dispatchAction('restart', { source: 'ui' }));
    overlayMenuBtn.addEventListener('click', () => dispatchAction('menu', { source: 'ui' }));
    overlayGameOverRestart.addEventListener('click', () => dispatchAction('restart', { source: 'ui' }));
    overlayGameOverMenu.addEventListener('click', () => dispatchAction('menu', { source: 'ui' }));

    installCanvas();
    ensureContext();
    addEvents();
    onResize();
    updateTitleOverlay();
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

  function isTouchPreferred(){
    if(typeof window === "undefined") return false;
    if(window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return true;
    return "ontouchstart" in window;
  }

  function ensurePauseOverlay(){
    if(state.pauseOverlay) return state.pauseOverlay;
    if(!globalScope?.PongPauseOverlay?.create) return null;
    state.pauseOverlay = globalScope.PongPauseOverlay.create({
      onResume: ()=>{ setPaused(false, "manual"); },
      onRestart: ()=>{ reset(); setPaused(false, "manual"); },
      hint: isTouchPreferred() ? "Tap resume to continue" : "Press Space to resume",
    });
    return state.pauseOverlay;
  }

  function showPauseOverlay(message){
    const overlay = ensurePauseOverlay();
    if(!overlay) return;
    if(typeof message === "string" && message){
      overlay.setHint?.(message);
    }
    overlay.show?.();
  }

  function hidePauseOverlay(){
    if(state.pauseOverlay && typeof state.pauseOverlay.hide === "function"){
      state.pauseOverlay.hide();
    }
  }

  function pauseHint(reason){
    if(reason === "shell") return "Paused by host – switch back or press resume";
    return isTouchPreferred() ? "Tap resume to continue" : "Press Space to resume";
  }

  function setPaused(next, reason){
    if(next){
      state.paused = true;
      state.shellPaused = reason === "shell";
      showPauseOverlay(pauseHint(reason));
    } else {
      state.paused = false;
      state.shellPaused = false;
      hidePauseOverlay();
      state.last = performance.now();
    }
  }

  function togglePause(force){
    const target = force === undefined ? !state.paused : !!force;
    if(target === state.paused){
      if(!target){
        state.shellPaused = false;
        state.last = performance.now();
        hidePauseOverlay();
      } else if(state.shellPaused){
        showPauseOverlay(pauseHint("shell"));
      } else {
        showPauseOverlay(pauseHint("manual"));
      }
      return;
    }
    setPaused(target, "manual");
  }

  function pauseForShell(){
    if(state.over) return;
    setPaused(true, "shell");
  }

  function resumeFromShell(){
    if(state.over || !state.paused) return;
    if(state.shellPaused){
      setPaused(false, "shell");
    }
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

  async function startGame(){
    try {
      await scenes.clear();
      await scenes.push(createGameScene);
    } catch (err) {
      console.error('[pong] startGame failed', err);
    }
  }

  function pauseGame(){
    if(state.over || state.paused) return;
    setPaused(true, "manual");
  }

  function resumeGame(){
    const top = scenes.currentId;
    if (top === 'pause' || top === 'gameover') {
      dispatchAction('resume', { source: 'api' });
    }
    setPaused(false, "manual");
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
    window.addEventListener("resize", resizeBackgroundCanvas);
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
      if(e.key === "?" || (e.key === "/" && e.shiftKey)){
        toggleDebugHud();
        e.preventDefault();
        return;
      }
      pressed.add(e.code);
      let handled = false;
      if(e.code===state.keys.pause){
        handled = dispatchAction('pause', { source: 'keyboard', reason: 'user', event: e });
      } else if (e.code === 'Enter'){ handled = dispatchAction('start', { source: 'keyboard', event: e }); }
      if(handled) e.preventDefault();
      bindMove();
    }, {passive:false});
    window.addEventListener("keyup", e=>{ pressed.delete(e.code); bindMove(); });

    // Touch / pointer controls
    state.canvas.addEventListener("pointerdown", onPointerDown, {passive:true});
    state.canvas.addEventListener("pointermove", onPointerMove, {passive:true});
    state.canvas.addEventListener("pointerup", onPointerUp, {passive:true});
    state.canvas.addEventListener("pointercancel", onPointerUp, {passive:true});
    state.canvas.addEventListener("pointerleave", onPointerUp, {passive:true});
    state.canvas.addEventListener("pointerout", onPointerUp, {passive:true});

    window.addEventListener("gamepadconnected", (e)=>{ state.gamepad = e.gamepad; });
    window.addEventListener("gamepaddisconnected", ()=>{ state.gamepad = null; });
  }

  // ---------- Boot ----------
  function boot(){
    try{
      const app = document.getElementById("app");
      app.innerHTML="";
      buildUI(app);
      reset();
      saveLS();
      state.running=false;
      state.paused=false;
      state.over=false;
      state.shellPaused=false;
      state.last=performance.now();
      requestAnimationFrame(frame);
      scenes.clear()
        .then(() => scenes.push(createTitleScene))
        .catch(err => console.error('[pong] scene init failed', err));
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
