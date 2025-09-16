(async function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || params.get('slug'); // accept legacy slug too
  if (!id) {
    console.error("No game id/slug provided");
    return;
  }

  const res = await fetch('games.json');
  const list = await res.json();
  const game = list.find(g => g.slug === id);
  if (!game) {
    console.error('Game not found for id/slug:', id);
    return;
  }

  // Pre-create per-game DOM scaffolding
  const REQUIRED_IDS = {
    tetris: ['t'],
    snake: ['c','score','status','sizeSel','wrapSel','snakeSkin','fruitSkin','boardSkin','dailyToggle','dailyScores'],
    pong:  ['game','status','lScore','rScore','lWins','rWins','pauseBtn','restartBtn','shareBtn','modeSel','diffSel','seriesSel','sndSel'],
    asteroids:['game'], breakout:['game'], chess:['game'], platformer:['game'],
    shooter:['game'], runner:['game'], box3d:['game'], maze3d:['game']
  };
  function scaffold(ids){
    if (!ids || !ids.length) return;
    let root = document.getElementById('game-root');
    if (!root){
      root = document.createElement('main');
      root.id='game-root';
      document.body.appendChild(root);
    }
    for (const id of ids){
      if (document.getElementById(id)) continue;
      const el = (id==='t'||id==='c'||id==='game')
        ? Object.assign(document.createElement('canvas'), {width:960,height:540})
        : document.createElement('div');
      el.id = id;
      root.appendChild(el);
    }
  }
  scaffold(REQUIRED_IDS[game.slug]);

  try {
    if (game.module) {
      const mod = await import(`./${game.entry}?t=${Date.now()}`);
      const boot = mod.default || mod.init || mod.start;
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
      const boot = window.GameInit || window.init || window.startGame || window.start;
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