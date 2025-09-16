(async function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || params.get('slug');
  if (!id) { console.error("No game id/slug provided"); return; }

  // Fetch catalogue fresh
  const res = await fetch('/games.json?cb=' + Date.now(), { cache: 'no-store' });
  const list = await res.json();
  const game = list.find(g => g.slug === id);
  if (!game) { console.error('Game not found for id/slug:', id); return; }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function ensureGG() {
    if (typeof window.GG === 'undefined') {
      try { await loadScript('/shared/gg-shim.js'); } catch {}
    }
    if (typeof window.GG === 'undefined') window.GG = {};
    window.GG.incPlays = window.GG.incPlays || function(){};
    window.GG.playSnd  = window.GG.playSnd  || function(){};
    window.GG.log      = window.GG.log      || function(){};
  }

  async function ensureTHREE() {
    if (typeof window.THREE !== 'undefined') return;
    try { await loadScript('/js/three-global-shim.js'); } catch {}
    if (typeof window.THREE === 'undefined') {
      try { await loadScript('https://unpkg.com/three@0.158.0/build/three.min.js'); } catch {}
    }
  }

  const REQUIRED_IDS = {
    tetris: ['t','status','level','lives','score','pauseBtn','restartBtn','hud'],
    snake: ['c','score','status','sizeSel','wrapSel','snakeSkin','fruitSkin','boardSkin','dailyToggle','dailyScores','pauseBtn','restartBtn','hud'],
    pong:  ['game','status','lScore','rScore','lWins','rWins','pauseBtn','restartBtn','shareBtn','modeSel','diffSel','seriesSel','sndSel','hud'],
    breakout: ['game','status','score','lives','level','pauseBtn','restartBtn','hud'],
    asteroids: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    chess: ['c','board','status','turn','moves','restartBtn','hud'],
    platformer: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    shooter: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    runner: ['game','status','score','pauseBtn','restartBtn','hud'],
    box3d: ['game','status','pauseBtn','restartBtn','hud'],
    maze3d: ['game','status','pauseBtn','restartBtn','hud'],
    chess3d: ['stage','hud','coords','thinking','difficulty']
  };

  function ensureScaffold(ids){
    if (!ids) return;
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
      if (['t','c','game','board'].includes(id)){
        el = document.createElement('canvas');
        el.width = 960; el.height = 540;
      } else if (id === 'hud') {
        el = document.createElement('div'); el.id='hud'; el.className='hud'; root.appendChild(el); continue;
      } else if (id.endsWith('Btn')) {
        el = document.createElement('button'); el.type='button'; el.textContent=id.replace(/Btn$/,''); 
      } else {
        el = document.createElement('div');
      }
      el.id = id;
      root.appendChild(el);
    }
  }

  if (['maze3d','box3d','chess3d'].includes(id)) await ensureTHREE();
  await ensureGG();
  ensureScaffold(REQUIRED_IDS[id]);

  try {
    const entryUrl = game.entry.startsWith('/') ? game.entry : `/${game.entry}`;
    if (game.module) {
      const mod = await import(`${entryUrl}?t=${Date.now()}`);
      const boot = mod && (mod.default || mod.init || mod.start || mod.boot);
      if (typeof boot === 'function') {
        boot({ mount: '#game-root', meta: game });
      } else if (typeof window.boot === 'function') {
        window.boot({ mount: '#game-root', meta: game });
      } else {
        console.warn('[loader] no boot export; assuming self-boot');
      }
    } else {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = entryUrl; s.onload=resolve; s.onerror=reject; document.head.appendChild(s);
      });
      const boot = window.GameInit || window.init || window.startGame || window.start || window.boot;
      if (typeof boot === 'function') {
        boot({ mount: '#game-root', meta: game });
      } else {
        console.warn('[loader] no global boot; assuming self-boot');
      }
    }
    window.parent?.postMessage?.({ type: 'GAME_READY', slug: game.slug }, '*');
  } catch (err) {
    console.error('Failed to boot game:', game.slug, err);
    window.parent?.postMessage?.({ type: 'GAME_ERROR', slug: game.slug, message: String(err && err.message || err) }, '*');
  }
})();