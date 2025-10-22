const SLUG = 'tetris';

function postReady(detail = {}) {
  try {
    window.parent?.postMessage({ type: 'GAME_READY', slug: SLUG, mode: 'lobby', ...detail }, '*');
  } catch (_) {
    /* ignore */
  }
}

function buildPlayUrl(options = {}) {
  const target = new URL('./play.html', window.location.href);
  const params = target.searchParams;

  if (options && typeof options === 'object') {
    if (options.spectate) {
      params.set('spectate', '1');
    } else {
      params.delete('spectate');
    }

    if (options.replay) {
      params.set('replay', String(options.replay));
    }

    if (options.seed != null) {
      params.set('seed', String(options.seed));
    }

    if (options.randomizer) {
      params.set('randomizer', String(options.randomizer));
    }
  }

  return target.toString();
}

function launch(options = {}) {
  const href = buildPlayUrl(options);
  try {
    window.location.assign(href);
  } catch (_) {
    window.location.href = href;
  }
}

function handleAnchorClick(event, options) {
  if (!event || event.defaultPrevented) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (event.button !== 0) return;
  event.preventDefault();
  launch(options);
}

function hydrateLinks() {
  const playLink = document.querySelector('[data-launch="play"]');
  if (playLink) {
    playLink.href = buildPlayUrl();
    playLink.addEventListener('click', (event) => handleAnchorClick(event, {}));
  }

  const spectateLink = document.querySelector('[data-launch="spectate"]');
  if (spectateLink) {
    spectateLink.href = buildPlayUrl({ spectate: true });
    spectateLink.addEventListener('click', (event) => handleAnchorClick(event, { spectate: true }));
  }
}

const MESSAGE_TYPES = new Set([
  'GAME_LAUNCH',
  'GG_LAUNCH',
  'GG:LAUNCH',
  'LAUNCH',
  'LAUNCH_GAME',
  'PLAY',
  'PLAY_GAME',
]);

function handleMessage(event) {
  const data = event && typeof event.data === 'object' ? event.data : null;
  if (!data) return;
  if (data.slug && data.slug !== SLUG) return;
  const type = typeof data.type === 'string' ? data.type.toUpperCase() : '';
  const action = typeof data.action === 'string' ? data.action.toUpperCase() : '';
  const mode = typeof data.mode === 'string' ? data.mode.toLowerCase() : '';

  if (MESSAGE_TYPES.has(type) || MESSAGE_TYPES.has(action) || mode === 'play' || data.play === true) {
    launch(data);
    return;
  }

  if (type === 'GAME_READY_REQUEST') {
    postReady({ synthetic: true });
  }
}

function exposeLauncher() {
  const api = window.GGShellLauncher || {};
  api.launch = launch;
  api.ready = postReady;
  api.buildPlayUrl = buildPlayUrl;
  window.GGShellLauncher = api;
}

function init() {
  exposeLauncher();
  hydrateLinks();
  postReady();
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init, { once: true });
}

window.addEventListener('message', handleMessage, { passive: true });
window.addEventListener('pageshow', (event) => {
  if (event?.persisted) {
    postReady({ resumed: true });
  }
});
