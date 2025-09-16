(function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || params.get('slug'); // accept both

  const ui = {
    error(title, details) {
      const box = document.createElement('div');
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:fixed;left:1rem;right:1rem;bottom:1rem;maxHeight:40vh;overflow:auto;background:#2b1d1d;color:#fff;border:2px solid #ff6b6b;borderRadius:12px;padding:12px;font:14px/1.4 system-ui,Segoe UI,Roboto,Arial;zIndex:999999';
      box.innerHTML = `<strong style="color:#ffb3b3;font-size:16px">${title}</strong><pre style="white-space:pre-wrap;margin:.5rem 0 0;color:#ffdede">${details}</pre>`;
      document.body.appendChild(box);
    }
  };

  async function fetchJSON(url){
    const res = await fetch(url, { cache:'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  async function loadGamesList(){
    const bases = [
      '/games.json',
      '/public/games.json',
      (location.pathname.replace(/[^\/]+$/, '') + 'games.json')
    ];
    const tried = [];
    for (const b of bases){
      const url = b + (b.includes('?') ? '&' : '?') + 't=' + Date.now();
      try {
        const j = await fetchJSON(url);
        return { j, src:b };
      } catch(e){ tried.push(`${b} → ${e.message}`); }
    }
    throw new Error('Unable to fetch games.json from any known location:\n' + tried.join('\n'));
  }

  // --- Pre-create per-game DOM scaffolding ----------------------------------
  const REQUIRED_IDS = {
    tetris: ['t'], // <canvas id="t">
    snake: ['c', 'score', 'status', 'sizeSel', 'wrapSel', 'snakeSkin', 'fruitSkin', 'boardSkin', 'dailyToggle', 'dailyScores'],
    pong:  ['game', 'status', 'lScore', 'rScore', 'lWins', 'rWins', 'pauseBtn', 'restartBtn', 'shareBtn', 'modeSel', 'diffSel', 'seriesSel', 'sndSel'],
    asteroids: ['game'],
    breakout: ['game'],
    chess: ['game'],
    platformer: ['game'],
    shooter: ['game'],
    runner: ['game'],
    box3d: ['game'],
    maze3d: ['game']
  };

  function scaffold(ids){
    if (!ids || !ids.length) return;
    let root = document.getElementById('game-root');
    if (!root){
      root = document.createElement('main');
      root.id = 'game-root';
      document.body.appendChild(root);
    }
    for (const id of ids){
      if (document.getElementById(id)) continue;
      const el = (id === 't' || id === 'c' || id === 'game')
        ? Object.assign(document.createElement('canvas'), { width: 960, height: 540 })
        : document.createElement('div');
      el.id = id;
      root.appendChild(el);
    }
  }
  // --------------------------------------------------------------------------
  function ensure(cond, msg){ if (!cond) throw new Error(msg); }

  async function main(){
    try {
      ensure(id, 'Missing ?id= in URL (e.g., /game.html?id=pong)');
      const { j:list, src } = await loadGamesList();
      const games = Array.isArray(list) ? list : Object.keys(list).map(k => ({ slug:k, ...list[k] }));
      const game = games.find(g => g && g.slug === id);
      ensure(game, `Game "${id}" not found in ${src}`);
      const { entry, module } = game; 
      // Create expected DOM for this game before loading 
      scaffold(REQUIRED_IDS[game.slug]);
      ensure(entry, `games.json at ${src} has no "entry" for slug "${id}"`);

      if (module) {
        const mod = await import(entry + `?t=${Date.now()}`);
        const boot = mod.default || mod.init || mod.start;
        if (typeof boot === 'function') {
          boot({ mount: '#game-root', meta: game });
        } else {
          console.warn('[loader] no boot export; assuming self-boot', game.slug);
        }
      } else {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = entry + `?t=${Date.now()}`;
          s.onload = resolve;
          s.onerror = () => reject(new Error(`Failed to load script: ${s.src}`));
          document.head.appendChild(s);
        });
        const boot = window.GameInit || window.init || window.startGame || window.start;
        if (typeof boot === 'function') {
          boot({ mount: '#game-root', meta: game });
        } else {
          console.warn('[loader] no global boot; assuming classic self-boot', game.slug);
        }
      }
    } catch(e){
      ui.error('Game failed to start', String(e && (e.stack || e.message || e)));
      console.error(e);
    }
  }

  window.addEventListener('DOMContentLoaded', main);
})();
