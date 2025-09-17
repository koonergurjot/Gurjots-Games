/* Gurjot's Games — diag-upgrades.js (v1)
   Drop-in advanced diagnostics for any game page.
   Load AFTER the game's main script; or let game.html auto-inject it (see README).
*/
(function(){
  const params = new URLSearchParams(location.search);
  const slug = params.get("slug") || document.currentScript?.dataset?.slug || document.body?.dataset?.slug || "unknown";
  const FULL = params.has("diag") && params.get("diag") !== "0" && params.get("diag") !== "off";
  const BOOT_READY_TIMEOUT_MS = 5000, NOFRAME_TIMEOUT_MS = 2000, MAX_NET = 30;

  function post(type, message=""){ try { parent && parent.postMessage({type, slug, message}, "*"); } catch(_) {} }
  function stringify(x){ try{ if (x instanceof Error) return x.stack||x.message||String(x); if (typeof x==="object") return JSON.stringify(x); return String(x);}catch(_){return String(x);} }

  const box = document.createElement("div");
  box.style.cssText = "position:fixed;inset:auto 6px 6px auto;background:#0b0f14;color:#cde3ff;border:1px solid #203049;border-radius:8px;padding:6px 8px;font:12px ui-monospace,Menlo,monospace;opacity:.85;z-index:99999;max-width:min(90vw,520px)";
  box.setAttribute("role","status"); box.setAttribute("aria-live","polite");
  const head = document.createElement("div"); head.style.cssText="display:flex;gap:6px;align-items:center;margin-bottom:4px";
  head.innerHTML = `<strong style="font-weight:600">diag</strong><span style="color:#7c8aa5">(${slug})</span><span style="flex:1"></span>`;
  const pre = document.createElement("pre"); pre.style.cssText="margin:0;white-space:pre-wrap;max-height:45svh;overflow:auto";
  const btn = (t,fn)=>{const b=document.createElement("button"); b.textContent=t; b.onclick=fn; b.style.cssText="cursor:pointer;border:1px solid #243043;background:#131a24;color:#e8f1ff;border-radius:6px;padding:2px 6px;font:inherit"; return b;};
  const btnCopy = btn("Copy", ()=> navigator.clipboard?.writeText(reportText()).catch(()=>{}));
  const btnSave = btn("Save JSON", downloadReport);
  const btnHide = btn("Hide", ()=> box.style.display="none");
  head.append(btnCopy, btnSave, btnHide);
  box.append(head, pre);
  document.addEventListener("DOMContentLoaded", ()=> document.body.appendChild(box), {once:true});
  function overlayLine(s){ pre.textContent = (s+"\n"+pre.textContent).slice(0, 5000); }
  function overlayStatus(line){ overlayLine("[status] " + line); }

  const report = { slug, ts: Date.now(), ua: navigator.userAgent, dpr: devicePixelRatio,
    viewport: [innerWidth, innerHeight], sw: null, fps: 0, longTasks: 0,
    net: [], last: null, boot: {firstFrame:false, ready:false, t0: performance.now()}
  };
  function reportText(){ try { return JSON.stringify(report, null, 2); } catch(_){ return "{}"; } }
  function downloadReport(){ const blob = new Blob([reportText()], {type:"application/json"}); const a = Object.assign(document.createElement("a"), {href: URL.createObjectURL(blob), download: `${slug}-diag.json`}); a.click(); URL.revokeObjectURL(a.href); }
  function emit(type, message=""){ report.last = {type, message, at: Date.now()}; post(type, message); overlayLine(`[${type}] ${message}`); }

  window.addEventListener("error", (e) => {
    const t = e.target;
    if (t && (t.tagName==="IMG"||t.tagName==="LINK"||t.tagName==="SCRIPT")) return emit("GAME_RES_ERROR", `${t.tagName} failed: ${t.src||t.href||"(inline)"}`);
    emit("GAME_ERROR", stringify(e.error||e.message||e));
  }, {capture:true});
  window.addEventListener("unhandledrejection", (e) => emit("GAME_ERROR", "unhandledrejection: " + stringify(e.reason)));
  document.addEventListener("securitypolicyviolation", (e) => emit("GAME_CSP", `${e.effectiveDirective}: ${e.blockedURI||"(inline)"}`));

  const bootReadyTimer = setTimeout(() => { if (!report.boot.ready) emit("GAME_HUNG", `No GAME_READY in 5000ms`); }, 5000);
  let firstFrameFired=false; requestAnimationFrame(()=>{ firstFrameFired=true; report.boot.firstFrame=true; });
  setTimeout(()=>{ if(!firstFrameFired) emit("GAME_NOFRAME", "No RAF within 2000ms"); }, 2000);

  (function wrapRAF(){ const _raf=requestAnimationFrame; window.requestAnimationFrame=(cb)=>_raf((t)=>{ report.fps=(report.fps||0)+1; cb(t); }); })();
  try{ const po=new PerformanceObserver(list=>{ const n=list.getEntries().length; if(n){ report.longTasks+=n; emit("GAME_LONGTASKS", `${n} long task(s)`);} }); po.observe({entryTypes:["longtask"]}); }catch(_){}
  setInterval(()=>{ overlayStatus(`fps≈${report.fps} long=${report.longTasks}`); report.fps=0; }, 1000);

  function findCanvas(){ return document.querySelector("canvas[data-game-root], #pong-canvas, #game-canvas, .game-canvas, canvas"); }
  function ensureCanvasHealth(cv){
    if (!(cv instanceof HTMLCanvasElement)) return emit("GAME_CANVAS_INVALID","not a canvas");
    if (cv.width===0 || cv.height===0 || cv.clientWidth*cv.clientHeight===0) emit("GAME_CANVAS_COLLAPSED", `${cv.width}x${cv.height} css=${cv.clientWidth}x${cv.clientHeight}`);
    const ctx = cv.getContext && (cv.getContext("2d") || cv.getContext("webgl") || cv.getContext("webgl2"));
    if (!ctx) emit("GAME_CTX_NULL","getContext() returned null");
    cv.addEventListener("webglcontextlost", ()=> emit("GAME_WEBGL_LOST",""), {once:true});
    cv.addEventListener("webglcontextrestored", ()=> emit("GAME_WEBGL_RESTORED",""));
  }
  const cv = findCanvas();
  if(cv){
    const ro = new ResizeObserver(()=> ensureCanvasHealth(cv)); ro.observe(cv);
    const mo = new MutationObserver(()=>{ if(!document.contains(cv)) emit("GAME_CANVAS_LOST","canvas removed from DOM"); });
    mo.observe(cv.parentNode||document.body,{subtree:true, childList:true});
    ensureCanvasHealth(cv);
  } else { emit("GAME_CANVAS_MISSING","no canvas found"); }

  if(FULL && 'fetch' in window){ const _fetch=window.fetch; window.fetch=async function(i,init){ const t0=performance.now(); try{ const r=await _fetch(i,init); if(!r.ok) net("fetch",i,r.status,performance.now()-t0); return r; }catch(err){ net("fetch",i,"ERR",performance.now()-t0,err); throw err; } }; }
  if(FULL && 'XMLHttpRequest' in window){ const _open=XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open=function(m,u,...rest){ this.__url=u; return _open.call(this,m,u,...rest); }; const _send=XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send=function(...args){ const url=this.__url||this.responseURL||"(unknown)"; const t0=performance.now(); this.addEventListener("loadend",()=>{ const code=this.status||"ERR"; if(code!==200) net("xhr",url,code,performance.now()-t0); }); return _send.apply(this,args); }; }
  function net(kind,url,code,ms,err){ report.net.push({kind, url:String(url), code, ms:Math.round(ms), err:err?.message}); if(report.net.length>30) report.net.shift(); emit("GAME_NET", `${kind} ${String(url)} -> ${code} (${Math.round(ms)}ms)`); }

  (function audioInit(){ try{ const ac=new (window.AudioContext||window.webkitAudioContext)(); if(ac.state!=="running"){ emit("GAME_AUDIO_SUSPENDED", ac.state); const unlock=()=>ac.resume().then(()=>emit("GAME_AUDIO_RESUMED")).catch(()=>{}); window.addEventListener("pointerdown", unlock, {once:true}); } }catch(_){ emit("GAME_AUDIO_UNAVAILABLE"); } })();

  if (navigator.serviceWorker?.controller){ const ch=new MessageChannel(); const timeout=setTimeout(()=>emit("SW_TIMEOUT"),1500); ch.port1.onmessage=(e)=>{ clearTimeout(timeout); emit("SW_OK", e.data?.version||"unknown"); }; navigator.serviceWorker.controller.postMessage({type:"PING"}, [ch.port2]); }

  window.GameDiag = window.GameDiag || {};
  window.GameDiag.ready = () => { report.boot.ready=true; clearTimeout(bootReadyTimer); emit("GAME_READY"); };
  window.GameDiag.overlay = (s) => overlayStatus(String(s));
  window.GameDiag.log = (s) => overlayLine("[log] "+String(s));
  window.GameDiag.copy = () => navigator.clipboard?.writeText(reportText());
  window.GameDiag.save = downloadReport;

  const bootReadyTimer = setTimeout(()=>{}, 0);
})();