(async function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || params.get('slug');
  if (!id) { console.error("No game id/slug provided"); return; }

  // Fetch catalogue
  const res = await fetch('games.json');
  const list = await res.json();
  let game = list.find(g => g.slug === id);
  if (!game) { console.error('Game not found for id/slug:', id); return; }

  // Route chess3d to its own page so it gets #stage/#hud/etc.
  if (game.slug === 'chess3d' && !game.page) {
    game.page = '/games/chess3d/index.html';
  }
  if (game.page) {
    location.replace(game.page);
    return;
  }

  // Utility to load a script and await it
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Ensure shim globals that many games expect
  // THREE for 3D games; GG for legacy helpers
  const needsThree = ['maze3d','box3d','chess3d'].includes(game.slug);
  try {
    if (needsThree && typeof window.THREE === 'undefined') {
      await loadScript('/js/three-global-shim.js');
    }
  } catch (e) {
    console.warn('[loader] failed to load three-global-shim.js:', e);
  }
  try {
    if (typeof window.GG === 'undefined') {
      await loadScript('/shared/gg-shim.js');
      if (typeof window.GG === 'undefined') {
        // Minimal stub if shim unavailable
        window.GG = { log: (...a)=>console.log('[GG]',...a) };
      }
    }
  } catch (e) {
    console.warn('[loader] failed to load gg-shim.js:', e);
    if (typeof window.GG === 'undefined') {
      window.GG = { log: (...a)=>console.log('[GG]',...a) };
    }
  }

  // --- Expanded per-game DOM scaffolding ------------------------------------
  const REQUIRED_IDS = {
    // canvases
    tetris: ['t','status','level','lives','score','pauseBtn','restartBtn'],
    snake: ['c','score','status','sizeSel','wrapSel','snakeSkin','fruitSkin','boardSkin','dailyToggle','dailyScores','pauseBtn','restartBtn','hud'],
    pong:  ['game','status','lScore','rScore','lWins','rWins','pauseBtn','restartBtn','shareBtn','modeSel','diffSel','seriesSel','sndSel','hud'],
    breakout: ['game','status','score','lives','level','pauseBtn','restartBtn','hud'],
    asteroids: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    chess: ['board','status','turn','moves','restartBtn','hud'], // chess 2D common ids
    platformer: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    shooter: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    runner: ['game','status','score','pauseBtn','restartBtn','hud'],
    box3d: ['game','status','pauseBtn','restartBtn','hud'],
    maze3d: ['game','status','pauseBtn','restartBtn','hud']
  };

  function ensureScaffold(ids){
    if (!ids || !ids.length) return;
    let root = document.getElementById('game-root');
    if (!root){
      root = document.createElement('main');
      root.id='game-root';
      root.setAttribute('aria-live','polite');
      document.body.appendChild(root);
    }
    for (const id of ids){
      if (document.getElementById(id)) continue;
      let el;
      if (id==='t'||id==='c'||id==='game'||id==='board'||id==='chess'){
        el = document.createElement('canvas');
        el.width = 960; el.height = 540;
      } else if (id.endsWith('Btn')) {
        el = document.createElement('button');
        el.type = 'button';
        el.textContent = id.replace(/Btn$/,'');
      } else if (id === 'hud') {
        el = document.createElement('div');
        el.className = 'hud';
      } else {
        el = document.createElement('div');
      }
      el.id = id;
      root.appendChild(el);
    }
  }
  ensureScaffold(REQUIRED_IDS[id] || REQUIRED_IDS[game.slug]);
  // --------------------------------------------------------------------------

  try {
    if (game.module) {
      const mod = await import(`./${game.entry}?t=${Date.now()}`);
      const boot = mod && (mod.default || mod.init || mod.start || mod.boot);
      if (typeof boot === 'function') {
        boot({ mount: '#game-root', meta: game });
      } else if (typeof window.boot === 'function') {
        // Some modules attach a global boot
        window.boot({ mount: '#game-root', meta: game });
      } else {
        console.warn('[loader] no boot export; assuming self-boot', game.slug);
      }
    } else {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `./${game.entry}`;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      const boot = window.GameInit || window.init || window.startGame || window.start || window.boot;
      if (typeof boot === 'function') {
        boot({ mount: '#game-root', meta: game });
      } else {
        console.warn('[loader] no global boot; assuming classic self-boot', game.slug);
      }
    }
    window.parent?.postMessage?.({ type: 'GAME_READY', slug: game.slug }, '*');
  } catch (err) {
    console.error('Failed to boot game:', game.slug, err);
    window.parent?.postMessage?.({ type: 'GAME_ERROR', slug: game.slug, message: String(err && err.message || err) }, '*');
  }
})();