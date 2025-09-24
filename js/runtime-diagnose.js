(function(){
  const tbody = document.querySelector('#report tbody');
  const containers = document.querySelector('#containers');
  const now = Date.now();
  const esc = (s)=> (s+'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  function tr(cells){ const tr=document.createElement('tr'); cells.forEach(td=>tr.appendChild(td)); return tr; }
  function td(html){ const td=document.createElement('td'); td.innerHTML=html; return td; }

  async function fetchJSON(url){ const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
  async function head(url){ try{ const r=await fetch(url,{method:'HEAD',cache:'no-store'}); return r.ok; }catch(e){ return false; } }

  function addRow(g, status, details){
    tbody.appendChild(tr([
      td(`<strong>${esc(g.title||'(no title)')}</strong>`),
      td(esc(g.slug||'')),
      td(`<span class="mono">${esc(g.entry||'')}</span>`),
      td(`<span class="${status==='OK'?'ok':status==='WARN'?'warn':'bad'}">${esc(status)}</span>`),
      td(`<div class="mono">${esc(details||'')}</div>`)
    ]));
  }

  async function bootModule(entry, ctx){
    const mod = await import(entry + `?t=${now}`);
    const boot = mod && (mod.default || mod.init || mod.start);
    if (typeof boot !== 'function') throw new Error('Module loaded, but no default/init/start export');
    await boot(ctx);
  }

  async function bootClassic(entry, ctx){
    // Load into a temporary iframe to avoid polluting globals
    const ifr = document.createElement('iframe');
    ifr.style.cssText = 'width:1px;height:1px;position:relative;opacity:.01;border:0;';
    containers.appendChild(ifr);
    const doc = ifr.contentDocument;
    doc.open(); doc.write('<!doctype html><meta charset="utf-8"><div id="game-root"></div>'); doc.close();
    await new Promise((resolve, reject)=>{
      const s = doc.createElement('script');
      s.src = entry + `?t=${now}`;
      s.onload = resolve;
      s.onerror = ()=> reject(new Error('Failed to load classic script'));
      doc.head.appendChild(s);
    });
    const w = ifr.contentWindow;
    const boot = w.GameInit || w.init || w.startGame || w.start;
    if (typeof boot !== 'function') throw new Error('Classic script loaded but no GameInit/init/startGame/start found');
    await boot({ mount: '#game-root', meta: { title: 'probe' }});
    // Cleanup to avoid runaway loops
    setTimeout(()=>{ ifr.remove(); }, 50);
  }

  async function scan(){
    const { list, src } = await (async ()=>{
      const url = `/public/games.json?t=${now}`;
      return { list: await fetchJSON(url), src: '/public/games.json' };
    })();

    const arr = Array.isArray(list) ? list : Object.keys(list).map(k => ({ slug:k, ...list[k] }));
    for (const g of arr){
      try {
        if (!g.entry) { addRow(g,'FAIL','Missing entry'); continue; }
        const reachable = await head(g.entry);
        if (!reachable) { addRow(g,'FAIL','Entry not reachable (HEAD 404)'); continue; }
        if (g.module) await bootModule(g.entry, { mount:'#game-root', meta:g });
        else await bootClassic(g.entry, { mount:'#game-root', meta:g });
        addRow(g,'OK','Booted successfully');
      } catch(e) {
        addRow(g,'FAIL', e.message || String(e));
      }
    }
  }

  window.addEventListener('DOMContentLoaded', ()=>{
    scan().catch(e=>{
      tbody.appendChild(tr([td(''), td(''), td(''), td('<span class="bad">FAIL</span>'), td(esc(e.message))]));
    });
  });
})();