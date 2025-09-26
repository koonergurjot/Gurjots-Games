
/* diag-autowire.js (dup-suppress) */
(function(){
  const onReady=(fn)=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fn,{once:true}):fn();
  const removeDup=()=>{try{
    const preferred=document.getElementById('gg-diag-btn');
    const q='[data-diag-copy],.gg-diag-copy,.diagnostics-btn,#diagnostics,button[data-gg-diag],button.gg-diagnostics,a.gg-diagnostics';
    const cand=[...document.querySelectorAll(q)];
    const labelled=[...document.querySelectorAll('button,a')].filter(el=>{
      const t=(el.textContent||'').trim().toLowerCase(); if(!t) return false;
      if(el.id==='gg-diag-btn') return false; return t==='diagnostics'||t==='open diagnostics';
    });
    const toRemove=new Set([...cand,...labelled]);
    if(preferred){ toRemove.forEach(el=>{ if(el!==preferred) el.remove(); });}
  }catch(_){}}; 
  const guard=()=>{ const opts=window.__GG_DIAG_OPTS||{}; const has=document.getElementById('gg-diag-btn'); window.__GG_DIAG_OPTS=Object.assign(opts,{suppressButton:!!has});};
  const wire=()=>{ const g=(window.__GG_DIAG=window.__GG_DIAG||{}); if(typeof g.open==='function') return;
    g.open=function(){ try{ const ov=document.querySelector('#gg-diagnostics-overlay,.gg-diagnostics-overlay'); if(ov){ ov.style.display='block'; ov.removeAttribute('hidden'); return; } }catch(_){}
      let p=document.getElementById('gg-diag-fallback'); if(!p){ p=document.createElement('div'); p.id='gg-diag-fallback';
        p.setAttribute('role','dialog'); Object.assign(p.style,{position:'fixed',right:'12px',bottom:'60px',maxWidth:'420px',maxHeight:'50vh',overflow:'auto',background:'#0b0b0c',border:'1px solid #444',borderRadius:'12px',padding:'12px',boxShadow:'0 4px 22px rgba(0,0,0,0.5)',color:'#fff',zIndex:'9999'});
        p.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px"><strong style="font:600 14px system-ui">Diagnostics</strong><button id="gg-diag-close" style="padding:6px 8px;border-radius:8px;border:1px solid #444;background:#161618;color:#fff">Close</button></div><pre id="gg-diag-log" style="white-space:pre-wrap;font:12px ui-monospace;margin:0"></pre>';
        document.body.appendChild(p); const c=document.getElementById('gg-diag-close'); c&&c.addEventListener('click',()=>{p.style.display='none';});
        const L=[]; L.push('UA: '+(navigator.userAgent||'')); L.push('PixelRatio: '+(window.devicePixelRatio||1)); L.push('Viewport: '+window.innerWidth+'x'+window.innerHeight); L.push('Time: '+new Date().toISOString()); try{L.push('Path: '+location.pathname+location.search);}catch(_){}
        document.getElementById('gg-diag-log').textContent=L.join('\n');
      } else { p.style.display='block'; }
    };
  };
  onReady(()=>{ removeDup(); guard(); wire();
    // ensure upgrades script present
    if(!document.querySelector('script[src*="diag-upgrades.js"]')){ 
      const s=document.createElement('script'); s.src='../common/diag-upgrades.js'; s.defer=true;
      const slug=((document.currentScript&& (document.currentScript.dataset.slug||document.currentScript.dataset.game))||'')|| (location.pathname.match(/\/games\/([^\/?#]+)/i)||[])[1] || '';
      if(slug) s.dataset.slug=slug;
      document.head.appendChild(s);
    }
  });
})();
