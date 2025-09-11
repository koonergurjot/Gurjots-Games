(function(){
  const tbody = document.querySelector('#report tbody');
  const summary = document.querySelector('#summary');
  const now = Date.now();

  function tr(cells){ const tr=document.createElement('tr'); cells.forEach(td=>tr.appendChild(td)); return tr; }
  function td(html){ const td=document.createElement('td'); td.innerHTML=html; return td; }
  function esc(s){ return (s+'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  async function fetchJSON(url) {
    const r = await fetch(url, { cache:'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function scan() {
    try {
      const list = await fetchJSON('/games.json?t=' + now);
      const arr = Array.isArray(list) ? list : Object.keys(list).map(k => ({ slug:k, ...list[k] }));
      let ok=0, bad=0, warn=0;
      for (const game of arr) {
        if (!game.slug || !game.entry) {
          bad++; tbody.appendChild(tr([td(game.title||''), td(game.slug||''), td(game.entry||''), td('FAIL'), td('Missing required fields')]));
          continue;
        }
        ok++; tbody.appendChild(tr([td(game.title), td(game.slug), td(game.entry), td('OK'), td('Ready')]));
      }
      summary.innerHTML = `<strong>Scan complete.</strong> ${ok} OK, ${warn} warnings, ${bad} failures`;
    } catch (e) {
      summary.innerHTML = `<strong style="color:#ff6b6b">Health check failed:</strong> ${e.message}`;
    }
  }

  window.addEventListener('DOMContentLoaded', scan);
})();