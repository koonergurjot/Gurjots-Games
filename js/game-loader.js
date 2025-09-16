(async function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || params.get('slug'); // accept both
  if (!id) { console.error("No game id/slug provided"); return; }

  // Fetch catalogue
  const res = await fetch('games.json');
  const list = await res.json();
  let game = list.find(g => g.slug === id);
  if (!game) { console.error('Game not found for id/slug:', id); return; }

  // Runtime override: ensure chess3d opens its own HTML page
  if (game.slug === 'chess3d' && !game.page) {
    game.page = '/games/chess3d/index.html';
  }
  if (game.page) {
    // Navigate out to a dedicated page when provided (used by chess3d)
    location.replace(game.page);
    return;
  }

  // --- Expanded per-game DOM scaffolding (HUD + canvases) --------------------
  const REQUIRED_IDS = {
    // Core canvas targets
    tetris: ['t', 'status', 'level', 'lives', 'score', 'pauseBtn', 'restartBtn'],
    snake: ['c','score','status','sizeSel','wrapSel','snakeSkin','fruitSkin','boardSkin','dailyToggle','dailyScores','pauseBtn','restartBtn'],
    pong:  ['game','status','lScore','rScore','lWins','rWins','pauseBtn','restartBtn','shareBtn','modeSel','diffSel','seriesSel','sndSel'],
    breakout: ['game','status','score','lives','level','pauseBtn','restartBtn'],
    asteroids: ['game','status','score','lives','pauseBtn','restartBtn'],
    chess: ['game','status','turn','moves','restartBtn'],
    platformer: ['game','status','score','lives','pauseBtn','restartBtn'],
    shooter: ['game','status','score','lives','pauseBtn','restartBtn'],
    runner: ['game','status','score','pauseBtn','restartBtn'],
    box3d: ['game','status','pauseBtn','restartBtn'],
    maze3d: ['game','status','pauseBtn','restartBtn']
  };

  function scaffold(ids){
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
      if (id==='t'||id==='c'||id==='game'){
        el = document.createElement('canvas');
        el.width = 960; el.height = 540;
      } else if (id.endsWith('Btn') || id.endsWith('Sel')) {
        el = document.createElement('button');
        el.type = 'button';
        el.textContent = id.replace(/Btn|Sel/g,'');
      } else {
        el = document.createElement('div');
      }
      el.id = id;
      root.appendChild(el);
    }
  }
  scaffold(REQUIRED_IDS[id] || REQUIRED_IDS[game.slug]);
  // ---------------------------------------------------------------------------

  try {
    if (game.module) {
      const mod = await import(`./${game.entry}?t=${Date.now()}`);
      const boot = mod && (mod.default || mod.init || mod.start);
      if (typeof boot === 'function') {
        boot({ mount: '#game-root', meta: game });
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