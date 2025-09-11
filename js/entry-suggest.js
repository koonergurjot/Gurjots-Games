(async function(){
  const out = document.getElementById('out');
  const now = Date.now();
  const candidates = (slug) => [
    `/games/${slug}/main.js`,
    `/games/${slug}/index.js`,
    `/games/${slug}/game.js`,
    `/games/${slug}/app.js`,
    `/games/${slug}/${slug}.js`,
    `/games/${slug}/${slug}.mjs`,
    `/games/${slug}/Main.js`,
    `/games/${slug}/Index.js`,
    `/games/${slug}/src/main.js`,
    `/games/${slug}/src/index.js`
  ];

  const isOK = async (url) => {
    try {
      const r = await fetch(url, { method:'HEAD', cache:'no-store' });
      return r.ok;
    } catch(e){ return false; }
  };

  async function fetchJSON(url){
    const r = await fetch(url, { cache:'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function el(html){ const d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild; }
  function esc(s){ return (s+'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  async function run(){
    const list = await fetchJSON('/games.json?t=' + now);
    const games = Array.isArray(list) ? list : Object.keys(list).map(k => ({ slug:k, ...list[k] }));
    const missing = [];
    for (const g of games){
      if (!g.entry){
        missing.push(g);
        continue;
      }
      const r = await fetch(g.entry, { method:'HEAD', cache:'no-store' });
      if (!r.ok) missing.push(g);
    }

    if (!missing.length){
      out.appendChild(el(`<div class="card"><strong>Everything looks reachable.</strong> No 404s detected for existing entries.</div>`));
      return;
    }

    for (const g of missing){
      const wrap = el(`<div class="card"></div>`);
      wrap.appendChild(el(`<div class="row"><strong>${esc(g.title || g.slug)}</strong><span class="pill">${esc(g.slug)}</span></div>`));
      if (g.entry) wrap.appendChild(el(`<div class="small">Current entry: <span class="mono">${esc(g.entry)}</span></div>`));

      let found = null;
      for (const url of candidates(g.slug)){
        // add cache-bust
        const u = url + `?t=${now}`;
        if (await isOK(u)){
          found = url; break;
        }
      }

      if (found){
        wrap.appendChild(el(`<div class="ok">Suggested entry:</div>`));
        const code = el(`<div class="code mono">${esc(found)}</div>`);
        wrap.appendChild(code);
        const btn = el(`<div class="row"><button>Copy JSON snippet</button></div>`);
        btn.querySelector('button').addEventListener('click', ()=>{
          const snippet = JSON.stringify({ slug:g.slug, entry:found }, null, 2);
          navigator.clipboard.writeText(snippet);
          btn.querySelector('button').textContent = 'Copied!';
        });
        wrap.appendChild(btn);
      } else {
        wrap.appendChild(el(`<div class="bad">No common filename found via HEAD. Try checking the folder for the correct file/casing.</div>`));
      }

      out.appendChild(wrap);
    }
  }

  run().catch(e=>{
    out.appendChild(el(`<div class="card bad">Failed to run: ${esc(e.message)}</div>`));
    console.error(e);
  });
})();