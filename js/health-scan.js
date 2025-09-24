(function(){
  const tbody = document.querySelector('#report tbody');
  const summary = document.querySelector('#summary');
  const now = Date.now();

  function tr(cells){ const tr=document.createElement('tr'); cells.forEach(td=>tr.appendChild(td)); return tr; }
  function td(html){ const td=document.createElement('td'); td.innerHTML=html; return td; }
  function esc(s){ return (s+'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  async function fetchJSON(url){
    const r = await fetch(url, { cache:'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
  }

  async function getList(){
    const url = `/public/games.json?t=${now}`;
    return { j: await fetchJSON(url), src: '/public/games.json' };
  }

  async function scan(){
    try {
      const { j:list, src } = await getList();
      const arr = Array.isArray(list) ? list : Object.keys(list).map(k => ({ slug:k, ...list[k] }));
      let ok=0, bad=0, warn=0;
      for (const game of arr){
        if (!game || !game.slug || !game.entry){
          bad++; tbody.appendChild(tr([td(esc(game && game.title || '(no title)')), td(esc(game && game.slug || '')), td(esc(game && game.entry || '')), td('<span class="bad">FAIL</span>'), td('Missing required fields: title/slug/entry')]));
          continue;
        }
        // Just probe fetchability
        try {
          const head = await fetch(game.entry, { method:'HEAD', cache:'no-store' });
          if (!head.ok) throw new Error('HTTP '+head.status);
          ok++; tbody.appendChild(tr([td(esc(game.title)), td(esc(game.slug)), td(`<span class="mono">${esc(game.entry)}</span>`), td('<span class="ok">OK</span>'), td(esc('Found in ' + src))]));
        } catch(e){
          warn++; tbody.appendChild(tr([td(esc(game.title)), td(esc(game.slug)), td(`<span class="mono">${esc(game.entry)}</span>`), td('<span class="warn">WARN</span>'), td(esc('Entry not reachable yet: ' + (e.message||'')))]));
        }
      }
      summary.innerHTML = `<strong>Scan complete.</strong> ${ok} OK, ${warn} warnings, ${bad} failures`;
    } catch(e){
      summary.innerHTML = `<strong style="color:#ff6b6b">Health check failed:</strong> ${esc(e.message).replace(/\n/g,'<br>')}`;
      console.error(e);
    }
  }

  window.addEventListener('DOMContentLoaded', scan);
})();