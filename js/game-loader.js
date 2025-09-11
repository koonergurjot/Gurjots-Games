(function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');

  const ui = {
    error(title, details) {
      const box = document.createElement('div');
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:fixed;left:1rem;right:1rem;bottom:1rem;maxHeight:40vh;overflow:auto;background:#2b1d1d;color:#fff;border:2px solid #ff6b6b;borderRadius:12px;padding:12px;font:14px/1.4 system-ui,Segoe UI,Roboto,Arial;zIndex:999999';
      box.innerHTML = `<strong style="color:#ffb3b3;font-size:16px">${title}</strong><pre style="white-space:pre-wrap;margin:.5rem 0 0;color:#ffdede">${details}</pre>`;
      document.body.appendChild(box);
    }
  };

  async function loadJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
    return await res.json();
  }

  function ensure(cond, msg) { if (!cond) throw new Error(msg); }

  async function main() {
    try {
      ensure(id, 'Missing ?id= in URL (e.g., /game.html?id=pong)');
      const list = await loadJSON(`/games.json?t=${Date.now()}`);
      const game = Array.isArray(list) ? list.find(g => g.slug === id) : (list[id] || null);
      ensure(game, `Game with slug "${id}" not found in games.json`);
      const { entry, module } = game;
      ensure(entry, 'games.json: "entry" is required');
      // Load the game script
      if (module) {
        const mod = await import(entry + `?t=${Date.now()}`);
        const boot = mod.default || mod.init || mod.start;
        ensure(typeof boot === 'function', 'No boot export found');
        boot({ mount: '#game-root', meta: game });
      } else {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = entry + `?t=${Date.now()}`;
          s.onload = resolve;
          s.onerror = () => reject(new Error(`Failed to load script: ${s.src}`));
          document.head.appendChild(s);
        });
        const boot = window.GameInit || window.init || window.startGame || window.start;
        ensure(typeof boot === 'function', 'No boot function found');
        boot({ mount: '#game-root', meta: game });
      }
    } catch (err) {
      ui.error('Game failed to start', String(err?.stack || err));
      console.error(err);
    }
  }
  window.addEventListener('DOMContentLoaded', main);
})();