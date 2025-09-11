(function(){
  const $ = (sel) => document.querySelector(sel);
  const tbody = document.querySelector('#report tbody');
  const summary = document.querySelector('#summary');
  const now = Date.now();

  function tr(cells){ const tr=document.createElement('tr'); cells.forEach(td=>tr.appendChild(td)); return tr; }
  function td(html){ const td=document.createElement('td'); td.innerHTML=html; return td; }
  function esc(s){ return (s+'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function rowFor(game, status, note, tag) {
    const a = document.createElement('a');
    a.href = `/game.html?id=${encodeURIComponent(game.slug||'')}`;
    a.target = '_blank';
    a.rel = 'noopener';

    const trEl = tr([
      td(`<strong>${esc(game.title||'(no title)')}</strong>`),
      td(`<span class="slug">${esc(game.slug||'')}</span>`),
      td(`<span class="mono">${esc(game.entry||'')}</span>`),
      td(`<span class="${status==='OK'?'ok':(status==='WARN'?'warn':'bad')}">${esc(status)}</span>`),
      td(`<span class="mono">${esc(note||'')}</span>`),
    ]);
    trEl.style.cursor='pointer';
    trEl.addEventListener('click', ()=> a.click());
    tbody.appendChild(trEl);

    const pill = tag ? `<span class="pill">${esc(tag)}</span>` : '';
    return pill;
  }

  async function fetchJSON(url) {
    const r = await fetch(url, { cache:'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function headOrRange(url) {
    const head = await fetch(url, { method:'HEAD', cache:'no-store' });
    if (head.ok) return head;
    // fallback try range GET 0-0
    const get0 = await fetch(url, { method:'GET', headers:{ 'Range':'bytes=0-0' }, cache:'no-store' });
    return get0;
  }

  function isModule(game){ return !!game.module; }

  async function scan() {
    try {
      const list = await fetchJSON('/games.json');
      const arr = Array.isArray(list) ? list : Object.keys(list).map(k => ({ slug:k, ...list[k] }));
      let ok=0, bad=0, warn=0;

      // Basic schema check
      for (const game of arr) {
        if (!game.slug || !game.entry || !game.title) {
          bad++; rowFor(game,'FAIL','Missing required fields: title/slug/entry','SCHEMA');
          continue;
        }
        try {
          const probe = await headOrRange(game.entry);
          if (!probe.ok) {
            bad++; rowFor(game,'FAIL',`Cannot fetch entry (${probe.status})`,'FETCH');
            continue;
          }
        } catch (e) {
          bad++; rowFor(game,'FAIL',`Network error fetching entry`,'FETCH');
          continue;
        }

        // Try to dynamically load (module only as a quick boot test)
        if (isModule(game)) {
          try {
            const mod = await import(game.entry + `?t=${now}`);
            const boot = mod && (mod.default || mod.init || mod.start);
            if (typeof boot !== 'function') {
              warn++; rowFor(game,'WARN','Module loaded but no default/init/start export','BOOT');
            } else {
              ok++; rowFor(game,'OK','Module export looks good', 'OK');
            }
          } catch (e) {
            bad++; rowFor(game,'FAIL',`Module import failed: ${e.message.split('\n')[0]}`,'BOOT');
          }
        } else {
          // Non-module: we can only mark fetch OK here; boot tested by clicking the row
          warn++; rowFor(game,'WARN','Script fetch OK — click to test runtime boot','FETCH');
        }
      }

      const total = ok+bad+warn;
      summary.innerHTML = `<strong>Scan complete.</strong> ${ok} OK, ${warn} warnings, ${bad} failures (of ${total} games)`;
    } catch (e) {
      summary.innerHTML = `<strong style="color:#ff6b6b">Health check failed:</strong> ${e.message}`;
      console.error(e);
    }
  }

  window.addEventListener('DOMContentLoaded', scan);
})();