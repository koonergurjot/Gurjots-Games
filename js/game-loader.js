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

  // Provide window.GG with needed stubs
  async function ensureGG() {
    if (typeof window.GG === 'undefined') {
      try { await loadScript('/shared/gg-shim.js'); } catch {}
    }
    if (typeof window.GG === 'undefined') window.GG = {};
    window.GG.incPlays = window.GG.incPlays || function(){};
    window.GG.playSnd  = window.GG.playSnd  || function(){};
    window.GG.log      = window.GG.log      || function(){};
  }

  // Global helpers some classics call
  function ensureGlobalHelpers() {
    // Canvas fit helper
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
    // Some classics reference Replay() globally (e.g., Tetris)
    if (typeof window.Replay !== 'function') {
      window.Replay = function(){ /* no-op */ };
    }
  }

  async function ensureTHREE() {
    if (typeof window.THREE !== 'undefined') return;
    try { await loadScript('/js/three-global-shim.js'); } catch {}
    if (typeof window.THREE === 'undefined') {
      const cdns = [
        'https://unpkg.com/three@0.158.0/build/three.min.js',
        'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js'
      ];
      for (const url of cdns) {
        try { await loadScript(url); if (typeof window.THREE !== 'undefined') break; } catch {}
      }
      if (typeof window.THREE === 'undefined') {
        console.error('[loader] THREE still undefined after attempts');
      }
    }
  }

  const REQUIRED_IDS = {
    tetris: ['t','status','level','lives','score','pauseBtn','restartBtn','hud'],
    snake: ['c','score','status','sizeSel','wrapSel','snakeSkin','fruitSkin','boardSkin','dailyToggle','dailyScores','pauseBtn','restartBtn','hud'],
    pong:  ['game','status','lScore','rScore','lWins','rWins','pauseBtn','restartBtn','shareBtn','modeSel','diffSel','seriesSel','sndSel','hud'],
    breakout: ['game','canvas','gameCanvas','status','score','lives','level','pauseBtn','restartBtn','hud'],
    asteroids: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    chess: ['board','fx','status','difficulty','puzzle-select','lobby','find-match','lobby-status','rankings','hud'],
    platformer: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    shooter: ['game','status','score','lives','pauseBtn','restartBtn','hud'],
    runner: ['game','status','score','pauseBtn','restartBtn','hud'],
    box3d: ['game','status','pauseBtn','restartBtn','hud'],
    maze3d: ['game','status','pauseBtn','restartBtn','hud'],
    chess3d: ['stage','hud','coords','thinking','difficulty']
  };

  function ensureRoot(){
    let root = document.getElementById('game-root');
    if (!root){
      root = document.createElement('main');
      root.id='game-root';
      root.setAttribute('aria-live','polite');
      document.body.appendChild(root);
    }
    return root;
  }

  function ensureElementOfType(id, tagName, parent, init){
    const desired = tagName.toUpperCase();
    let el = document.getElementById(id);
    let created = false;
    if (!el || el.tagName !== desired){
      const replacement = document.createElement(tagName);
      replacement.id = id;
      const currentParent = el && el.parentElement ? el.parentElement : (parent || ensureRoot());
      if (el && el.parentElement){
        el.parentElement.replaceChild(replacement, el);
      } else if (el && typeof el.replaceWith === 'function'){
        el.replaceWith(replacement);
      } else if (currentParent){
        currentParent.appendChild(replacement);
      }
      el = replacement;
      created = true;
    }
    const targetParent = parent || el.parentElement || ensureRoot();
    if (!el.parentElement){
      targetParent.appendChild(el);
    } else if (parent && el.parentElement !== parent && (!parent.contains(el) || el.parentElement === document.body)){
      parent.appendChild(el);
    }
    if (typeof init === 'function') init(el, created);
    return el;
  }

  function ensureCanvasElement(id, parent, options={}){
    return ensureElementOfType(id, 'canvas', parent, (el, created) => {
      if (options.width && (created || !el.width || el.width === 300)) el.width = options.width;
      if (options.height && (created || !el.height || el.height === 150)) el.height = options.height;
      if (options.attrs){
        for (const [key, value] of Object.entries(options.attrs)){
          if (created || !el.hasAttribute(key)) el.setAttribute(key, value);
        }
      }
      if (options.style){
        for (const [key, value] of Object.entries(options.style)){
          if (created || !el.style[key]) el.style[key] = value;
        }
      }
    });
  }

  function ensureSelectElement(id, parent, options=[]){
    return ensureElementOfType(id, 'select', parent, (el) => {
      if (options.length && el.options.length === 0){
        for (const opt of options){
          const optionEl = document.createElement('option');
          optionEl.value = opt.value;
          optionEl.textContent = opt.label;
          if (opt.selected) optionEl.selected = true;
          el.appendChild(optionEl);
        }
      }
    });
  }

  function ensureButtonElement(id, parent, text){
    return ensureElementOfType(id, 'button', parent, (el) => {
      el.type = el.type || 'button';
      if (text && !el.textContent) el.textContent = text;
    });
  }

  function ensureIsCanvas(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName !== 'CANVAS') {
      const c = document.createElement('canvas');
      c.id = id;
      c.width = 960; c.height = 540;
      el.replaceWith(c);
      if (typeof window.fitCanvasToParent === 'function') window.fitCanvasToParent(c);
    }
  }

  function ensureScaffold(ids){
    if (!ids) return;
    const root = ensureRoot();

    let chessBoardStack = null;
    if (ids.includes('board') && ids.includes('fx')){
      const boardEl = document.getElementById('board');
      const fxEl = document.getElementById('fx');
      if (boardEl && fxEl && boardEl.parentElement && boardEl.parentElement === fxEl.parentElement && boardEl.parentElement !== root){
        chessBoardStack = boardEl.parentElement;
      } else if (boardEl && boardEl.parentElement && boardEl.parentElement !== root){
        chessBoardStack = boardEl.parentElement;
      } else if (fxEl && fxEl.parentElement && fxEl.parentElement !== root){
        chessBoardStack = fxEl.parentElement;
      } else {
        chessBoardStack = document.createElement('div');
        chessBoardStack.className = 'chess-board-stack';
        chessBoardStack.style.position = 'relative';
        chessBoardStack.style.display = 'inline-block';
        root.appendChild(chessBoardStack);
        if (boardEl && boardEl.parentElement === root) chessBoardStack.appendChild(boardEl);
        if (fxEl && fxEl.parentElement === root) chessBoardStack.appendChild(fxEl);
      }
    }

    let lobbySection = null;

    for (const id of ids){
      switch (id){
        case 'board':
          ensureCanvasElement('board', chessBoardStack || root, {
            width: 480,
            height: 480,
            attrs: { 'aria-label': 'Chess board' },
            style: { border: '1px solid #243047', borderRadius: '12px', background: '#0f172a', display: 'block' }
          });
          continue;
        case 'fx':
          ensureCanvasElement('fx', chessBoardStack || root, {
            width: 480,
            height: 480,
            attrs: { 'aria-hidden': 'true' },
            style: { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' }
          });
          continue;
        case 'status':
          ensureElementOfType('status', 'div', root, (el) => {
            if (!el.hasAttribute('role')) el.setAttribute('role','status');
            if (!el.hasAttribute('aria-live')) el.setAttribute('aria-live','polite');
          });
          continue;
        case 'difficulty':
          ensureSelectElement('difficulty', root, [
            { value: '1', label: 'Easy' },
            { value: '2', label: 'Medium', selected: true },
            { value: '3', label: 'Hard' },
            { value: '4', label: 'Expert' }
          ]);
          continue;
        case 'puzzle-select':
          ensureSelectElement('puzzle-select', root, [
            { value: '-1', label: 'Free Play', selected: true }
          ]);
          continue;
        case 'lobby':
          lobbySection = ensureElementOfType('lobby', 'section', root, (el) => {
            if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label','Online play');
          });
          continue;
        case 'find-match':
          ensureButtonElement('find-match', lobbySection || root, 'Find Match');
          continue;
        case 'lobby-status':
          ensureElementOfType('lobby-status', 'div', lobbySection || root);
          continue;
        case 'rankings':
          ensureElementOfType('rankings', 'ol', lobbySection || root);
          continue;
        default:
          break;
      }

      if (document.getElementById(id)) continue;
      let el;
      if (['t','c','game','board','canvas','gameCanvas','fx'].includes(id)){
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
    // If these IDs already existed but weren't canvases, upgrade them
    ['c','board','game','canvas','gameCanvas','fx'].forEach(ensureIsCanvas);
  }

  if (['maze3d','box3d','chess3d'].includes(id)) await ensureTHREE();
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