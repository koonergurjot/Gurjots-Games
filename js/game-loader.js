(async function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || params.get('slug');
  if (!id) { console.error("No game id/slug provided"); return; }
  console.log("[loader] repo-alignment v4.0 slug=", id);

  // fresh catalog to avoid SW caching
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

  function ensureGlobalHelpers() {
    if (typeof window.fitCanvasToParent !== 'function') {
      window.fitCanvasToParent = function(canvas) {
        if (!canvas || !canvas.getContext) return;
        function fit() {
          const parent = canvas.parentElement || document.body;
          const w = parent.clientWidth || 800;
          const h = parent.clientHeight || 600;
          const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          canvas.width = Math.max(1, w * dpr);
          canvas.height = Math.max(1, h * dpr);
          const ctx = canvas.getContext('2d');
          if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        window.addEventListener('resize', fit);
        setTimeout(fit, 0);
        fit();
      };
    }
    if (typeof window.SFX !== 'object') {
      window.SFX = { load(){}, play(){}, mute(){}, unmute(){}, stop(){} };
    }
    if (typeof window.Replay !== 'object') {
      window.Replay = { recordPiece(){}, reset(){}, start(){}, export(){ return ''; } };
    }
  }

  function ensureImportMapForThree() {
    if (document.querySelector('script[type=\"importmap\"]')) return;
    const map = {
      imports: {
        "three": "https://unpkg.com/three@0.158.0/build/three.module.js",
        "three/addons/": "https://unpkg.com/three@0.158.0/examples/jsm/"
      }
    };
    const s = document.createElement('script');
    s.type = 'importmap';
    s.textContent = JSON.stringify(map);
    document.head.appendChild(s);
    console.log('[loader] added importmap for three');
  }

  async function ensureTHREE() {
    ensureImportMapForThree();
    if (typeof window.THREE !== 'undefined') return;
    const cdns = [
      'https://unpkg.com/three@0.158.0/build/three.min.js',
      'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js'
    ];
    for (const url of cdns) {
      try { await loadScript(url); if (typeof window.THREE !== 'undefined') break; } catch {}
    }
    if (typeof window.THREE === 'undefined') {
      console.error('[loader] THREE still undefined after attempts');
    } else {
      const plcCDNs = [
        'https://unpkg.com/three@0.158.0/examples/js/controls/PointerLockControls.js',
        'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/js/controls/PointerLockControls.js'
      ];
      for (const url of plcCDNs) {
        try { await loadScript(url); if (window.THREE.PointerLockControls) break; } catch {}
      }
      if (!window.THREE.PointerLockControls) {
        console.warn('[loader] PointerLockControls not available; if using jsm, importmap handles it.');
      }
    }
  }

  const REQUIRED_IDS = {
    tetris: ['t','status','level','lives','score','pauseBtn','restartBtn','hud'],
    snake: ['c','score','status','sizeSel','wrapSel','snakeSkin','fruitSkin','boardSkin','dailyToggle','dailyScores','pauseBtn','restartBtn','hud'],
    pong:  ['game','status','lScore','rScore','lWins','rWins','pauseBtn','restartBtn','shareBtn','modeSel','diffSel','seriesSel','sndSel','hud'],
    breakout: ['b','canvas','gameCanvas','game','status','score','lives','level','pauseBtn','restartBtn','hud'],
    asteroids: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    chess: ['c','board','fx','difficulty','puzzle-select','rankings','lobby','status','turn','moves','startBtn','resignBtn','undoBtn','restartBtn','hud'],
    platformer: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    shooter: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    runner: ['game','status','score','pauseBtn','restartBtn','hud'],
    maze3d: ['game','status','pauseBtn','restartBtn','hud'],
    chess3d: ['stage','hud','coords','thinking','difficulty']
  };

  function ensureIsCanvas(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName !== 'CANVAS') {
      const c = document.createElement('canvas');
      c.id = id; c.width = 960; c.height = 540;
      el.replaceWith(c);
      if (typeof window.fitCanvasToParent === 'function') window.fitCanvasToParent(c);
      console.log('[loader] upgraded #' + id + ' to <canvas>');
    }
  }

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
      if (['t','c','game','board','b','canvas','gameCanvas'].includes(id)){
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
      if (el.tagName === 'CANVAS' && typeof window.fitCanvasToParent === 'function') {
        window.fitCanvasToParent(el);
      }
    }
    ['c','board','game','b','canvas','gameCanvas'].forEach(ensureIsCanvas);
  }

  if (['maze3d','chess3d'].includes(id)) await ensureTHREE();
  await ensureGG();
  ensureGlobalHelpers();
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