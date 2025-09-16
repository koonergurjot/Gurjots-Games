(async function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || params.get('slug');
  if (!id) { console.error("No game id/slug provided"); return; }

  const res = await fetch('games.json');
  const list = await res.json();
  let game = list.find(g => g.slug === id);
  if (!game) { console.error('Game not found for id/slug:', id); return; }

  // chess3d: ensure dedicated page
  if (game.slug === 'chess3d' && !game.page) game.page = '/games/chess3d/index.html';
  if (game.page) { location.replace(game.page); return; }

  // helpers
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const needsThree = ['maze3d','box3d','chess3d'].includes(game.slug);
  try { if (needsThree && typeof window.THREE === 'undefined') await loadScript('/js/three-global-shim.js'); } catch {}
  try {
    if (typeof window.GG === 'undefined') {
      await loadScript('/shared/gg-shim.js');
      if (typeof window.GG === 'undefined') window.GG = { log: (...a)=>console.log('[GG]',...a) };
    }
  } catch { if (typeof window.GG === 'undefined') window.GG = { log: (...a)=>console.log('[GG]',...a) }; }

  // scaffold (short version)
  const REQUIRED_IDS = { tetris:['t'], snake:['c','score','status'], pong:['game','status'], platformer:['game'], shooter:['game'], runner:['game'], box3d:['game'], maze3d:['game'], chess:['board','status'] };
  function scaffold(ids){ if(!ids) return; let root = document.getElementById('game-root'); if(!root){ root=document.createElement('main'); root.id='game-root'; document.body.appendChild(root);} for(const id of ids){ if(document.getElementById(id)) continue; const el=(id==='t'||id==='c'||id==='game'||id==='board')?document.createElement('canvas'):document.createElement('div'); if(el.tagName==='CANVAS'){ el.width=960; el.height=540;} el.id=id; root.appendChild(el);} }
  scaffold(REQUIRED_IDS[id] || REQUIRED_IDS[game.slug]);

  try {
    const entryUrl = game.entry.startsWith('/') ? game.entry : `/${game.entry}`;
    if (game.module) {
      const mod = await import(`${entryUrl}?t=${Date.now()}`);
      const boot = mod && (mod.default || mod.init || mod.start || mod.boot);
      if (typeof boot === 'function') boot({ mount: '#game-root', meta: game });
      else if (typeof window.boot === 'function') window.boot({ mount: '#game-root', meta: game });
      else console.warn('[loader] no boot export; assuming self-boot', game.slug);
    } else {
      await loadScript(entryUrl);
      const boot = window.GameInit || window.init || window.startGame || window.start || window.boot;
      if (typeof boot === 'function') boot({ mount: '#game-root', meta: game });
      else console.warn('[loader] no global boot; assuming classic self-boot', game.slug);
    }
    window.parent?.postMessage?.({ type: 'GAME_READY', slug: game.slug }, '*');
  } catch (err) {
    console.error('Failed to boot game:', game.slug, err);
    window.parent?.postMessage?.({ type: 'GAME_ERROR', slug: game.slug, message: String(err && err.message || err) }, '*');
  }
})();