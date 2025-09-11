(function () {
  const $ = (sel) => document.querySelector(sel);
  const params = new URLSearchParams(location.search);
  const id = params.get('id');

  const ui = {
    error(title, details) {
      try {
        const box = document.createElement('div');
        box.setAttribute('role', 'alert');
        box.style.cssText = [
          'position:fixed',
          'left:1rem',
          'right:1rem',
          'bottom:1rem',
          'maxHeight:40vh',
          'overflow:auto',
          'background:#2b1d1d',
          'color:#fff',
          'border:2px solid #ff6b6b',
          'borderRadius:12px',
          'padding:12px',
          'font:14px/1.4 system-ui,Segoe UI,Roboto,Arial',
          'zIndex:999999'
        ].join(';');
        box.innerHTML = [
          `<strong style="color:#ffb3b3;font-size:16px">${title}</strong>`,
          `<pre style="white-space:pre-wrap;margin:.5rem 0 0;color:#ffdede">${details}</pre>`
        ].join('');
        document.body.appendChild(box);
      } catch (e) {
        console.error("Failed to render error box:", e, title, details);
      }
    }
  };

  async function loadJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
    return await res.json();
  }

  function ensure(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  async function main() {
    try {
      ensure(id, 'Missing ?id= in URL (e.g., /game.html?id=pong)');
      const list = await loadJSON('/games.json');
      const game = Array.isArray(list) ? list.find(g => g.slug === id) : (list[id] || null);
      ensure(game, `Game with slug "${id}" not found in games.json`);

      const { title, slug, entry, module } = game;
      ensure(typeof title === 'string' && title, 'games.json: "title" is required');
      ensure(typeof slug === 'string' && slug, 'games.json: "slug" is required');
      ensure(typeof entry === 'string' && entry, 'games.json: "entry" is required (path to JS)');

      // Preflight HEAD
      const head = await fetch(entry, { method: 'HEAD', cache: 'no-store' });
      if (!head.ok) {
        // Some static hosts may block HEAD; try GET with range 0
        try {
          const probe = await fetch(entry, { method: 'GET', headers: { 'Range': 'bytes=0-0' }, cache: 'no-store' });
          ensure(probe.ok, `Entry not found: ${entry} (${head.status})`);
        } catch (_e) {
          ensure(head.ok, `Entry not found: ${entry} (${head.status})`);
        }
      }

      // Load the game script
      if (module) {
        const mod = await import(entry + `?t=${Date.now()}`);
        if (typeof mod.default === 'function') mod.default({ mount: '#game-root', meta: game });
        else if (typeof mod.init === 'function') mod.init({ mount: '#game-root', meta: game });
        else if (typeof mod.start === 'function') mod.start({ mount: '#game-root', meta: game });
        else console.warn('Module loaded but no default/init/start export found.');
      } else {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = entry + `?t=${Date.now()}`;
          s.onload = resolve;
          s.onerror = () => reject(new Error(`Failed to load script: ${s.src}`));
          document.head.appendChild(s);
        });
        // Conventional globals
        const boot = window.GameInit || window.init || window.startGame || window.start;
        ensure(typeof boot === 'function',
          'Loaded script did not expose a boot function (expected GameInit/init/startGame/start)');
        boot({ mount: '#game-root', meta: game });
      }
    } catch (err) {
      ui.error('Game failed to start', String(err && (err.stack || err.message || err)));
      console.error(err);
    }
  }

  window.addEventListener('DOMContentLoaded', main);
})();