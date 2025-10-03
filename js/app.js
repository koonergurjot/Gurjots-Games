import { adaptGameForLanding } from './catalog-utils.js';

const $=(s,el=document)=>el.querySelector(s);
const $$=(s,el=document)=>[...el.querySelectorAll(s)];
const state={games:[],tags:new Set(),activeTag:null,search:"",sort:"az"};

const fxQuery=(()=>{try{return new URLSearchParams(window.location.search).has('fx');}catch{return false;}})();
const reduceMotionQuery=typeof window!=='undefined'&&typeof window.matchMedia==='function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;
const fxEnabled=()=>fxQuery&&!((reduceMotionQuery&&reduceMotionQuery.matches));
let teardownLandingFx=null;
let landingFxSetupPromise=null;
function setTheme(name){document.body.classList.remove("theme-retro","theme-neon","theme-minimal");if(name==="retro")document.body.classList.add("theme-retro");if(name==="neon")document.body.classList.add("theme-neon");if(name==="minimal")document.body.classList.add("theme-minimal");localStorage.setItem("gg:theme",name);}
function hydrateUI(){$("#year").textContent=new Date().getFullYear();const saved=localStorage.getItem("gg:theme")||"default";$("#theme").value=saved;setTheme(saved);$("#theme").addEventListener("change",e=>setTheme(e.target.value));$("#search").addEventListener("input",e=>{state.search=e.target.value.toLowerCase().trim();render();});$("#sort").addEventListener("change",e=>{state.sort=e.target.value;render();});}
function buildTagChips(){
  const w=$("#tagChips");
  w.innerHTML="";

  const all=document.createElement("button");
  const allActive=!state.activeTag;
  all.className="chip"+(allActive?" active":"");
  all.textContent="All";
  all.setAttribute("aria-pressed",allActive?"true":"false");
  all.onclick=()=>{
    state.activeTag=null;
    $$("#tagChips button").forEach(btn=>{
      const active=btn===all;
      btn.classList.toggle("active",active);
      btn.setAttribute("aria-pressed",active?"true":"false");
    });
    render();
  };
  w.appendChild(all);

  [...state.tags].sort().forEach(tag=>{
    const b=document.createElement("button");
    const active=state.activeTag===tag;
    b.className="chip"+(active?" active":"");
    b.textContent=tag;
    b.setAttribute("aria-pressed",active?"true":"false");
    b.onclick=()=>{
      const willActivate=state.activeTag!==tag;
      state.activeTag=willActivate?tag:null;
      $$("#tagChips button").forEach(btn=>{
        if(btn===all){
          const isActive=!willActivate;
          btn.classList.toggle("active",isActive);
          btn.setAttribute("aria-pressed",isActive?"true":"false");
        }else{
          const isActive=btn===b&&willActivate;
          btn.classList.toggle("active",isActive);
          btn.setAttribute("aria-pressed",isActive?"true":"false");
        }
      });
      render();
    };
    w.appendChild(b);
  });
}
function skeletonCards(n=6){const grid=$("#gamesGrid");grid.innerHTML="";for(let i=0;i<n;i++){const card=document.createElement("article");card.className="card";const th=document.createElement("div");th.className="thumb skeleton";card.appendChild(th);const t=document.createElement("div");t.className="skeleton";t.style.cssText="height:18px;width:60%;margin:10px 0 8px;border-radius:6px;";card.appendChild(t);const l=document.createElement("div");l.className="skeleton";l.style.cssText="height:14px;width:90%;border-radius:6px;";card.appendChild(l);grid.appendChild(card);}}
async function setupLandingFx(){
  if(!fxEnabled()||teardownLandingFx)return landingFxSetupPromise;
  if(landingFxSetupPromise)return landingFxSetupPromise;
  landingFxSetupPromise=(async()=>{
    try{
      const { createParticleSystem }=await import('../shared/fx/canvasFx.js');
      const canvas=document.createElement('canvas');
      canvas.id='bgParticles';
      Object.assign(canvas.style,{position:'fixed',inset:0,zIndex:0,pointerEvents:'none'});
      document.body.prepend(canvas);
      const ctx=canvas.getContext('2d');
      const system=createParticleSystem(ctx);
      const targetCount=80;
      let frameId=null;
      let width=0;
      let height=0;
      let dpr=1;
      function resize(){
        dpr=window.devicePixelRatio||1;
        width=canvas.width=innerWidth*dpr;
        height=canvas.height=innerHeight*dpr;
        canvas.style.width=innerWidth+'px';
        canvas.style.height=innerHeight+'px';
      }
      function spawn(){
        const angle=Math.random()*Math.PI*2;
        const speed=(0.15+Math.random()*0.35)*dpr;
        system.add(Math.random()*width,Math.random()*height,{
          vx:Math.cos(angle)*speed,
          vy:Math.sin(angle)*speed,
          life:420+Math.random()*180,
          size:(0.6+Math.random()*1.6)*dpr,
          color:'rgba(255,255,255,0.2)',
          decay:0.997
        });
      }
      function frame(){
        while(system.particles.length<targetCount)spawn();
        ctx.clearRect(0,0,width,height);
        system.update();
        system.draw();
        frameId=requestAnimationFrame(frame);
      }
      resize();
      addEventListener('resize',resize);
      frame();
      teardownLandingFx=()=>{
        if(frameId!=null)cancelAnimationFrame(frameId);
        removeEventListener('resize',resize);
        canvas.remove();
        teardownLandingFx=null;
      };
    }catch(e){
      console.warn('Landing FX unavailable',e);
      teardownLandingFx=null;
    }finally{
      landingFxSetupPromise=null;
    }
  })();
  return landingFxSetupPromise;
}

if(reduceMotionQuery&&fxQuery){
  const handleMotionChange=event=>{
    if(event.matches){
      if(teardownLandingFx)teardownLandingFx();
    }else if(!teardownLandingFx&&fxEnabled()){
      setupLandingFx();
    }
  };
  if(typeof reduceMotionQuery.addEventListener==='function'){
    reduceMotionQuery.addEventListener('change',handleMotionChange);
  }else if(typeof reduceMotionQuery.addListener==='function'){
    reduceMotionQuery.addListener(handleMotionChange);
  }
}
function getGameMetaText(id){return localStorage.getItem('gg:meta:'+id)||'';}
function getGameBadges(id){const v=localStorage.getItem('gg:ach:'+id)||'';return v?v.split(',').filter(Boolean):[];}
let lastFocus=null;
function ensureModal(){
  if($('#playerModal'))return $('#playerModal');
  const wrap=document.createElement('div');
  wrap.id='playerModal';
  wrap.setAttribute('role','dialog');
  wrap.setAttribute('aria-modal','true');
  Object.assign(wrap.style,{position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',display:'none',alignItems:'center',justifyContent:'center',zIndex:100});
  const inner=document.createElement('div');
  inner.id='playerModalInner';
  inner.tabIndex=-1;
  Object.assign(inner.style,{width:'min(1000px,94vw)',height:'min(720px,84vh)',borderRadius:'16px',overflow:'hidden',border:'1px solid rgba(255,255,255,0.12)',background:'var(--bg-soft)',position:'relative',boxShadow:'var(--shadow)'});
  const close=document.createElement('button');
  close.textContent='✕';
  close.setAttribute('aria-label','Close modal');
  Object.assign(close.style,{position:'absolute',top:'8px',right:'8px',zIndex:2,background:'var(--bg)',color:'var(--text)',border:'1px solid var(--card-border)',borderRadius:'10px',padding:'6px 10px',cursor:'pointer'});
  const frame=document.createElement('iframe');
  Object.assign(frame,{id:'playerFrame'});
  Object.assign(frame.style,{width:'100%',height:'100%',border:'0'});
  function closeModal(){
    wrap.style.display='none';
    frame.src='about:blank';
    if(lastFocus)lastFocus.focus();
  }
  close.onclick=closeModal;
  wrap.addEventListener('click',e=>{if(e.target===wrap)closeModal();});
  wrap.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();closeModal();}
    if(e.key==='Tab'){
      const fcs=$$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',inner);
      if(!fcs.length)return;
      const first=fcs[0],last=fcs[fcs.length-1];
      if(e.shiftKey){
        if(document.activeElement===first||document.activeElement===inner){e.preventDefault();last.focus();}
      }else{
        if(document.activeElement===last){e.preventDefault();first.focus();}
      }
    }
  });
  inner.appendChild(close);
  inner.appendChild(frame);
  wrap.appendChild(inner);
  document.body.appendChild(wrap);
  return wrap;
}
async function playInModal(url,id){
  const m=ensureModal();
  const f=$('#playerFrame',m);
  const inner=$('#playerModalInner',m);
  try{
    const res=await fetch(url,{method:'HEAD'});
    if(!res.ok)throw 0;
    lastFocus=document.activeElement;
    m.style.display='flex';
    f.src=url;
    inner.focus();
    addXP(5);
  }catch{
    alert('Game not found. It may be missing or the path is wrong.');
  }
}
async function shareGame(game){const url=new URL(location.href);url.hash=game.id;const data={title:game.title,text:`Play ${game.title} on Gurjot's Games`,url:url.toString()};try{if(navigator.share){await navigator.share(data);}else{await navigator.clipboard.writeText(data.url);alert('Link copied!');}}catch{}}
const LEGACY_XP_KEY='gg:xp';
function safeJSONParse(value){try{return value?JSON.parse(value):null;}catch{return null;}}
function normalizeProfileKeyName(name){if(typeof name!=='string')return'guest';const trimmed=name.trim();if(!trimmed)return'guest';if(trimmed.toLowerCase()==='default')return'guest';return trimmed.toLowerCase();}
function getActiveProfileName(){try{const stored=safeJSONParse(localStorage.getItem('gg:profile'));if(stored&&typeof stored.name==='string'&&stored.name.trim())return stored.name;}catch{}try{const fallback=localStorage.getItem('profile');if(typeof fallback==='string'&&fallback.trim()){if(fallback.trim().toLowerCase()==='default')return'Guest';return fallback;}}catch{}return'Guest';}
function getProfileStorageContext(){const normalized=normalizeProfileKeyName(getActiveProfileName());return{key:`${LEGACY_XP_KEY}:${encodeURIComponent(normalized)}`,normalized};}
function getProfileStatsKey(){return getProfileStorageContext().key;}
function persistStats(stats){const context=getProfileStorageContext();const payload={xp:Number.isFinite(Number(stats.xp))?Number(stats.xp):0,plays:Number.isFinite(Number(stats.plays))?Number(stats.plays):0};try{localStorage.setItem(context.key,JSON.stringify(payload));localStorage.setItem(LEGACY_XP_KEY,JSON.stringify(payload));}catch{}return payload;}
function readStat(){const context=getProfileStorageContext();try{let raw=localStorage.getItem(context.key);if(!raw&&context.normalized==='guest'){const legacy=localStorage.getItem(LEGACY_XP_KEY);if(legacy){raw=legacy;localStorage.setItem(context.key,legacy);}}const parsed=safeJSONParse(raw)||{xp:0,plays:0};return{xp:Number.isFinite(Number(parsed.xp))?Number(parsed.xp):0,plays:Number.isFinite(Number(parsed.plays))?Number(parsed.plays):0};}catch{return{xp:0,plays:0};}}
function addXP(n){const stats=readStat();stats.xp+=n|0;persistStats(stats);}
function xpBadge(){const {xp,plays}=readStat();const b=document.createElement('div');b.className='status info';b.style.margin='6px 0 0';b.textContent=`Your XP: ${xp} • Plays: ${plays}`;return b;}
function render(){const grid=$("#gamesGrid");const status=$("#status");let list=[...state.games];if(state.activeTag)list=list.filter(g=>g.tags.includes(state.activeTag));if(state.search)list=list.filter(g=>g.title.toLowerCase().includes(state.search)||(g.description||g.desc||'').toLowerCase().includes(state.search));if(state.sort==='az')list.sort((a,b)=>a.title.localeCompare(b.title));if(state.sort==='za')list.sort((a,b)=>b.title.localeCompare(a.title));if(state.sort==='new')list.sort((a,b)=>(b.comparableTimestamp??0)-(a.comparableTimestamp??0));status.textContent=list.length?`${list.length} game${list.length>1?'s':''} ready to play`:"No matches. Try a different search or tag.";grid.innerHTML="";list.forEach(game=>{const card=document.createElement('article');card.className='card';const badge=document.createElement('div');badge.className='badge';badge.textContent=game.new?'NEW':'PLAY';card.appendChild(badge);const thumb=document.createElement('div');thumb.className='thumb';if(game.thumb){const img=document.createElement('img');img.src=game.thumb;img.alt=game.title+' thumbnail';img.loading='lazy';img.style.width='100%';img.style.height='100%';img.style.objectFit='cover';thumb.appendChild(img);}else{thumb.textContent=game.emoji||'🎮';}card.appendChild(thumb);const h3=document.createElement('h3');h3.textContent=game.title;card.appendChild(h3);const p=document.createElement('p');p.textContent=game.description||game.desc;card.appendChild(p);const meta=getGameMetaText(game.id);if(meta){const m=document.createElement('p');m.style.margin='6px 0 0';m.style.fontSize='.85rem';m.style.opacity='.85';m.textContent=meta;card.appendChild(m);}const badges=getGameBadges(game.id);if(badges.length){const row=document.createElement('div');row.style.margin='8px 0 0';row.style.display='flex';row.style.gap='6px';badges.forEach(b=>{const s=document.createElement('span');s.className='chip';s.textContent=b;row.appendChild(s);});card.appendChild(row);}const actions=document.createElement('div');actions.className='actions';const play=document.createElement('button');play.className='btn primary';play.textContent='Play';play.onclick=()=>playInModal(game.path,game.id);actions.appendChild(play);const share=document.createElement('button');share.className='btn';share.textContent='Share';share.onclick=()=>shareGame(game);actions.appendChild(share);const open=document.createElement('a');open.href=game.path;open.className='btn';open.textContent='Open Tab';open.target='_blank';open.setAttribute('rel','noopener');actions.appendChild(open);card.appendChild(actions);grid.appendChild(card);});}
async function loadGames(){
  skeletonCards();
  try{
    const { loadGameCatalog }=await import('../shared/game-catalog.js');
    const catalog=await loadGameCatalog();
    state.games=catalog.games.map(adaptGameForLanding).filter(Boolean);
  }catch(e){
    import('../tools/reporters/console-signature.js').then(({ warn })=>warn('app','[games] catalog unavailable',e));
    state.games=[];
  }
  state.tags=new Set(state.games.flatMap(g=>g.tags||[]));
  buildTagChips();
  render();
}
document.addEventListener('DOMContentLoaded',()=>{if(fxEnabled())setupLandingFx();const status=document.getElementById('status');status.parentElement.insertBefore(xpBadge(),status.nextSibling);});
hydrateUI();loadGames();
