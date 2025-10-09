(function(){
  const DEFAULT_ALLOW = 'autoplay; fullscreen; gamepad; xr-spatial-tracking';
  const DEFAULT_SANDBOX = 'allow-scripts allow-same-origin allow-modals allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-downloads';
  const DEFAULT_TIMEOUT = 20000;

  function log(...args){ console.log('[loader]', ...args); }
  function warn(...args){ console.warn('[loader]', ...args); }
  function error(...args){ console.error('[loader]', ...args); }

  function sendToParent(payload){
    try {
      window.parent?.postMessage?.(payload, '*');
    } catch (err) {
      console.warn('[loader] failed to post to parent', err);
    }
  }

  function getSlugFromLocation(){
    try {
      const params = new URLSearchParams(location.search);
      return params.get('id') || params.get('slug') || '';
    } catch (err) {
      warn('unable to parse slug from location', err);
      return '';
    }
  }

  function dedupe(list){
    const seen = new Set();
    const result = [];
    for (const item of list){
      const key = item ? String(item) : '';
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(key);
    }
    return result;
  }

  function toAbsolute(url){
    if (!url) return null;
    try {
      return new URL(url, location.origin).toString();
    } catch (err) {
      return url;
    }
  }

  function isHtmlPath(path){
    return typeof path === 'string' && /\.html?(?:$|[?#])/i.test(path);
  }

  async function probe(url){
    if (!url) return false;
    if (typeof fetch !== 'function') return true;
    try {
      const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (head?.ok || head?.status === 304) return true;
      if (head && (head.status === 405 || head.status === 501)) {
        const res = await fetch(url, { method: 'GET', cache: 'no-store' });
        return !!(res?.ok);
      }
    } catch (err) {
      return false;
    }
    return false;
  }

  async function findFirstReachable(candidates){
    for (const candidate of candidates){
      const ok = await probe(candidate);
      if (ok) return candidate;
    }
    return null;
  }

  async function resolveGameInfo(slug){
    const info = {
      slug,
      basePath: `/games/${slug}`,
      playPath: `/games/${slug}/index.html`,
      entry: null,
      preferredMode: null,
      title: slug
    };

    try {
      const mod = await import('/shared/game-paths.js');
      if (mod?.resolveGamePaths){
        const resolved = await mod.resolveGamePaths(slug);
        if (resolved?.basePath) info.basePath = resolved.basePath;
        if (resolved?.playPath) info.playPath = resolved.playPath;
      }
    } catch (err) {
      warn('unable to resolve game directory', err);
    }

    try {
      const catalog = await import('/shared/game-catalog.js');
      if (catalog?.getGameById){
        const record = await catalog.getGameById(slug);
        if (record){
          if (record.basePath) info.basePath = record.basePath;
          if (record.playPath) info.playPath = record.playPath;
          if (record.entry) info.entry = record.entry;
          if (record.title) info.title = record.title;
          if (record.launchMode) info.preferredMode = record.launchMode;
          else if (record.mode) info.preferredMode = record.mode;
        }
      }
    } catch (err) {
      warn('unable to load game catalog entry', err);
    }

    return info;
  }

  async function planLoad(slug){
    const info = await resolveGameInfo(slug);
    const base = info.basePath || `/games/${slug}`;
    const title = info.title || slug;

    const moduleCandidates = dedupe([
      !isHtmlPath(info.entry) ? toAbsolute(info.entry) : null,
      toAbsolute(`${base}/main.js`),
      toAbsolute(`${base}/main.mjs`),
      toAbsolute(`${base}/${slug}.js`),
      toAbsolute(`${base}/${slug}.mjs`),
      toAbsolute(`${base}/index.js`),
      toAbsolute(`${base}/index.mjs`),
      toAbsolute(`${base}/game.js`),
      toAbsolute(`${base}/game.mjs`),
      toAbsolute(`${base}/engine.js`),
      toAbsolute(`${base}/engine.mjs`),
      toAbsolute(`${base}/app.js`),
      toAbsolute(`${base}/app.mjs`),
      toAbsolute(`${base}/bundle.js`),
      toAbsolute(`${base}/bundle.mjs`)
    ].filter(Boolean));

    const hasPreferredMode = typeof info.preferredMode === 'string' && info.preferredMode.length > 0;
    const shouldPreferModule = info.preferredMode === 'module' || info.preferredMode === 'script';
    const shouldPreferIframe = info.preferredMode === 'iframe';
    if (!shouldPreferIframe && (shouldPreferModule || (!hasPreferredMode && moduleCandidates.length))){
      const moduleEntry = await findFirstReachable(moduleCandidates);
      if (moduleEntry){
        return { mode: 'module', entry: moduleEntry, info: { ...info, title } };
      }
    }

    const iframeCandidates = dedupe([
      toAbsolute(info.playPath),
      isHtmlPath(info.entry) ? toAbsolute(info.entry) : null,
      toAbsolute(`${base}/index.html`),
      toAbsolute(`${base}/${slug}.html`),
      toAbsolute(`${base}/game.html`),
      toAbsolute(`${base}/play.html`)
    ].filter(Boolean));

    const iframeEntry = await findFirstReachable(iframeCandidates);
    return {
      mode: 'iframe',
      entry: iframeEntry || iframeCandidates[0] || toAbsolute(`${base}/index.html`),
      info: { ...info, title }
    };
  }

  function ensurePauseCleared(){
    try {
      window.gameUI?.forceClearPause?.();
    } catch (err) {
      // ignore
    }
  }

  function createLoader(){
    const state = {
      slug: null,
      sandbox: null,
      readyPromise: null,
      mode: null,
      entry: null
    };

    async function init(options = {}){
      const slug = options.slug || state.slug || getSlugFromLocation();
      if (!slug){
        throw new Error('Missing ?id= or ?slug= parameter');
      }
      state.slug = slug;

      const plan = await planLoad(slug);
      state.mode = plan.mode;
      state.entry = plan.entry;

      const sandboxFactory = await import('/shared/game-sandbox.js');
      if (state.sandbox){
        await state.sandbox.dispose();
      }
      state.sandbox = sandboxFactory.createGameSandbox({
        slug,
        target: options.mount || '#game-root',
        allow: options.allow || DEFAULT_ALLOW,
        sandbox: options.sandbox || options.sandboxAttributes || DEFAULT_SANDBOX,
        className: options.frameClass || (plan.mode === 'iframe' ? 'gg-game-frame' : 'gg-game-sandbox'),
        timeoutMs: Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT,
        onEvent(event){
          if (!event || typeof event !== 'object') return;
          if (!event.slug) event.slug = slug;
          if (event.type === 'GAME_READY') {
            ensurePauseCleared();
          }
          sendToParent(event);
        }
      });

      const initResult = await state.sandbox.init({
        slug,
        mode: plan.mode,
        entry: plan.entry,
        title: plan.info?.title || slug,
        timeoutMs: Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT
      });

      state.readyPromise = initResult.ready;
      initResult.ready
        .then(() => {
          log(`ready (${plan.mode})`, plan.entry);
        })
        .catch((err) => {
          const detail = err?.message || String(err);
          error('game failed to signal ready', detail);
          sendToParent({ type: 'GAME_ERROR', slug, error: detail, message: detail });
        });

      return {
        mode: plan.mode,
        entry: plan.entry,
        ready: initResult.ready
      };
    }

    function pause(){
      state.sandbox?.pause();
    }

    function resume(){
      ensurePauseCleared();
      state.sandbox?.resume();
    }

    async function dispose(){
      if (state.sandbox){
        await state.sandbox.dispose();
        state.sandbox = null;
        state.readyPromise = null;
        state.mode = null;
        state.entry = null;
      }
    }

    return {
      init,
      pause,
      resume,
      dispose,
      get slug(){ return state.slug; },
      get mode(){ return state.mode; },
      get entry(){ return state.entry; },
      get ready(){ return state.readyPromise; }
    };
  }

  const loader = createLoader();
  window.GGGameLoader = loader;

  const slug = getSlugFromLocation();
  if (!slug){
    error('missing slug');
    return;
  }

  loader.init({ slug }).catch(err => {
    const detail = err?.message || String(err);
    error('failed to initialize loader', err);
    sendToParent({ type: 'GAME_ERROR', slug, error: detail, message: detail });
  });
})();
