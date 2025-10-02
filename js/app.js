const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const PREFS_KEY = 'gg:landing:prefs';
const FAVORITES_KEY = 'gg:favorites:v1';
const playableCache = new Map();

const defaultPrefs = { activeTag: null, search: '', sort: 'az', showFavoritesOnly: false };

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...defaultPrefs };
    const parsed = JSON.parse(raw);
    const sort = parsed?.sort === 'za' || parsed?.sort === 'new' ? parsed.sort : 'az';
    return {
      activeTag: typeof parsed?.activeTag === 'string' && parsed.activeTag.trim() ? parsed.activeTag : null,
      search: typeof parsed?.search === 'string' ? parsed.search.trim() : '',
      sort,
      showFavoritesOnly: !!parsed?.showFavoritesOnly,
    };
  } catch {
    return { ...defaultPrefs };
  }
}

function persistPrefs() {
  const payload = {
    activeTag: state.activeTag,
    search: state.search,
    sort: state.sort,
    showFavoritesOnly: state.showFavoritesOnly,
  };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
  } catch {}
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return new Set();
    return new Set(list.filter(id => typeof id === 'string' && id));
  } catch {
    return new Set();
  }
}

function persistFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  } catch {}
}

const prefs = loadPrefs();

const state = {
  games: [],
  tags: new Set(),
  activeTag: prefs.activeTag,
  search: prefs.search,
  sort: prefs.sort,
  showFavoritesOnly: prefs.showFavoritesOnly,
  favorites: loadFavorites(),
};

function deriveComparableTimestamp(game) {
  if (!game || typeof game !== 'object') return 0;
  const candidates = [
    game.addedAt,
    game.added_at,
    game.released,
    game.releaseDate,
    game.release_date,
    game.publishedAt,
    game.published_at,
    game.updatedAt,
    game.updated_at,
    game.createdAt,
    game.created_at,
    game.date,
  ];
  for (const value of candidates) {
    const stamp = normalizeTimestamp(value);
    if (stamp) return stamp;
  }
  return 0;
}

function normalizeTimestamp(value) {
  if (value == null) return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    if (Math.abs(value) >= 1e12) return value;
    if (Math.abs(value) >= 1e9) return value * 1000;
    if (Math.abs(value) >= 1e6) return value * 1000;
    return 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return normalizeTimestamp(asNumber);
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function setTheme(name) {
  document.body.classList.remove('theme-retro', 'theme-neon', 'theme-minimal');
  if (name === 'retro') document.body.classList.add('theme-retro');
  if (name === 'neon') document.body.classList.add('theme-neon');
  if (name === 'minimal') document.body.classList.add('theme-minimal');
  localStorage.setItem('gg:theme', name);
}

function hydrateUI() {
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const savedTheme = localStorage.getItem('gg:theme') || 'default';
  const themeSel = $('#theme');
  if (themeSel) {
    themeSel.value = savedTheme;
    setTheme(savedTheme);
    themeSel.addEventListener('change', e => setTheme(e.target.value));
  }

  const searchInput = $('#search');
  if (searchInput) {
    searchInput.value = state.search;
    searchInput.addEventListener('input', e => {
      state.search = e.target.value.trim();
      persistPrefs();
      render();
    });
  }

  const sortSel = $('#sort');
  if (sortSel) {
    if (!['az', 'za', 'new'].includes(sortSel.value)) sortSel.value = 'az';
    sortSel.value = state.sort;
    sortSel.addEventListener('change', e => {
      const val = e.target.value;
      state.sort = val === 'za' || val === 'new' ? val : 'az';
      persistPrefs();
      render();
    });
  }
}

function buildTagChips() {
  const wrap = $('#tagChips');
  if (!wrap) return;
  wrap.innerHTML = '';

  const all = document.createElement('button');
  const allActive = !state.activeTag;
  all.className = 'chip' + (allActive ? ' active' : '');
  all.textContent = 'All';
  all.setAttribute('aria-pressed', allActive ? 'true' : 'false');
  all.onclick = () => {
    state.activeTag = null;
    persistPrefs();
    buildTagChips();
    render();
  };
  wrap.appendChild(all);

  const favoritesBtn = document.createElement('button');
  const favoritesActive = !!state.showFavoritesOnly;
  favoritesBtn.className = 'chip favorites' + (favoritesActive ? ' active' : '');
  const favCount = state.favorites.size;
  favoritesBtn.textContent = favCount ? `Favorites (${favCount})` : 'Favorites';
  favoritesBtn.setAttribute('aria-pressed', favoritesActive ? 'true' : 'false');
  const disableFavorites = !favCount && !favoritesActive;
  if (disableFavorites) {
    favoritesBtn.disabled = true;
    favoritesBtn.setAttribute('aria-disabled', 'true');
  }
  favoritesBtn.onclick = () => {
    state.showFavoritesOnly = !state.showFavoritesOnly;
    persistPrefs();
    buildTagChips();
    render();
  };
  wrap.appendChild(favoritesBtn);

  [...state.tags].sort().forEach(tag => {
    const btn = document.createElement('button');
    const active = state.activeTag === tag;
    btn.className = 'chip' + (active ? ' active' : '');
    btn.textContent = tag;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.onclick = () => {
      const willActivate = state.activeTag !== tag;
      state.activeTag = willActivate ? tag : null;
      persistPrefs();
      buildTagChips();
      render();
    };
    wrap.appendChild(btn);
  });
}

function skeletonCards(n = 6) {
  const grid = $('#gamesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const card = document.createElement('article');
    card.className = 'card';
    const thumb = document.createElement('div');
    thumb.className = 'thumb skeleton';
    card.appendChild(thumb);
    const title = document.createElement('div');
    title.className = 'skeleton';
    title.style.cssText = 'height:18px;width:60%;margin:10px 0 8px;border-radius:6px;';
    card.appendChild(title);
    const line = document.createElement('div');
    line.className = 'skeleton';
    line.style.cssText = 'height:14px;width:90%;border-radius:6px;';
    card.appendChild(line);
    grid.appendChild(card);
  }
}

function particleBG() {
  const prefersReduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduce) return;
  const cvs = document.createElement('canvas');
  cvs.id = 'bgParticles';
  Object.assign(cvs.style, { position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' });
  document.body.prepend(cvs);
  let ctx;
  try {
    ctx = cvs.getContext('2d');
  } catch (_) {
    ctx = null;
  }
  if (!ctx || typeof ctx.clearRect !== 'function') return;
  let w, h, dpr, dots = [];
  function resize() {
    dpr = window.devicePixelRatio || 1;
    w = cvs.width = innerWidth * dpr;
    h = cvs.height = innerHeight * dpr;
    cvs.style.width = innerWidth + 'px';
    cvs.style.height = innerHeight + 'px';
    dots = new Array(80).fill(0).map(() => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4 * dpr,
      vy: (Math.random() - 0.5) * 0.4 * dpr,
      r: (0.6 + Math.random() * 1.6) * dpr,
    }));
  }
  resize();
  addEventListener('resize', resize);
  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    dots.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  draw();
}

function getGameMetaText(id) {
  return localStorage.getItem('gg:meta:' + id) || '';
}

function getGameBadges(id) {
  const v = localStorage.getItem('gg:ach:' + id) || '';
  return v ? v.split(',').filter(Boolean) : [];
}

let lastFocus = null;

function ensureModal() {
  const existing = $('#playerModal');
  if (existing) return existing;
  const wrap = document.createElement('div');
  wrap.id = 'playerModal';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  Object.assign(wrap.style, {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  });
  const inner = document.createElement('div');
  inner.id = 'playerModalInner';
  inner.tabIndex = -1;
  Object.assign(inner.style, {
    width: 'min(1000px,94vw)',
    height: 'min(720px,84vh)',
    borderRadius: '16px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'var(--bg-soft)',
    position: 'relative',
    boxShadow: 'var(--shadow)',
  });
  const close = document.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close modal');
  Object.assign(close.style, {
    position: 'absolute',
    top: '8px',
    right: '8px',
    zIndex: 2,
    background: 'var(--bg)',
    color: 'var(--text)',
    border: '1px solid var(--card-border)',
    borderRadius: '10px',
    padding: '6px 10px',
    cursor: 'pointer',
  });
  const frame = document.createElement('iframe');
  Object.assign(frame, { id: 'playerFrame' });
  Object.assign(frame.style, { width: '100%', height: '100%', border: '0' });
  function closeModal() {
    wrap.style.display = 'none';
    frame.src = 'about:blank';
    if (lastFocus) lastFocus.focus();
  }
  close.onclick = closeModal;
  wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
  wrap.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
    if (e.key === 'Tab') {
      const fcs = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', inner);
      if (!fcs.length) return;
      const first = fcs[0], last = fcs[fcs.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === inner) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  inner.appendChild(close);
  inner.appendChild(frame);
  wrap.appendChild(inner);
  document.body.appendChild(wrap);
  return wrap;
}

async function ensurePlayable(url) {
  if (!url) return false;
  if (playableCache.has(url)) return playableCache.get(url);
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res?.ok) throw new Error('bad status');
    playableCache.set(url, true);
    return true;
  } catch {
    playableCache.set(url, false);
    return false;
  }
}

async function playInModal(url, id) {
  const modal = ensureModal();
  const frame = $('#playerFrame', modal);
  const inner = $('#playerModalInner', modal);
  try {
    const ok = await ensurePlayable(url);
    if (!ok) throw 0;
    lastFocus = document.activeElement;
    modal.style.display = 'flex';
    frame.src = url;
    inner.focus();
    recordPlay(5);
  } catch {
    alert('Game not found. It may be missing or the path is wrong.');
  }
}

async function shareGame(game) {
  const url = new URL(location.href);
  url.hash = game.id;
  const data = {
    title: game.title,
    text: `Play ${game.title} on Gurjot's Games`,
    url: url.toString(),
  };
  try {
    if (navigator.share) {
      await navigator.share(data);
    } else {
      await navigator.clipboard.writeText(data.url);
      alert('Link copied!');
    }
  } catch {}
}

function readStat() {
  try {
    const parsed = JSON.parse(localStorage.getItem('gg:xp') || '{"xp":0,"plays":0}');
    return {
      xp: Number.isFinite(parsed.xp) ? parsed.xp | 0 : 0,
      plays: Number.isFinite(parsed.plays) ? parsed.plays | 0 : 0,
    };
  } catch {
    return { xp: 0, plays: 0 };
  }
}

function writeStat(stats) {
  const clean = {
    xp: Number.isFinite(stats.xp) ? Math.max(0, stats.xp | 0) : 0,
    plays: Number.isFinite(stats.plays) ? Math.max(0, stats.plays | 0) : 0,
  };
  try {
    localStorage.setItem('gg:xp', JSON.stringify(clean));
  } catch {}
  return clean;
}

function updateStat(mutator) {
  const next = mutator(readStat());
  return writeStat(next);
}

let xpBadgeEl = null;

function refreshXPBadge() {
  if (!xpBadgeEl) return;
  const { xp, plays } = readStat();
  xpBadgeEl.textContent = `Your XP: ${xp} • Plays: ${plays}`;
}

function addXP(n) {
  updateStat(stats => {
    stats.xp += n | 0;
    return stats;
  });
  refreshXPBadge();
}

function recordPlay(xpReward = 0) {
  updateStat(stats => {
    stats.plays += 1;
    stats.xp += xpReward | 0;
    return stats;
  });
  refreshXPBadge();
}

function xpBadge() {
  if (xpBadgeEl) return xpBadgeEl;
  xpBadgeEl = document.createElement('div');
  xpBadgeEl.className = 'status info';
  xpBadgeEl.style.margin = '6px 0 0';
  refreshXPBadge();
  return xpBadgeEl;
}

function render() {
  const grid = $('#gamesGrid');
  const status = $('#status');
  if (!grid || !status) return;
  let list = [...state.games];
  if (state.activeTag) list = list.filter(g => g.tags.includes(state.activeTag));
  if (state.showFavoritesOnly) list = list.filter(g => state.favorites.has(g.id));
  const query = state.search.toLowerCase();
  if (query) list = list.filter(g => g.title.toLowerCase().includes(query) || (g.description || g.desc || '').toLowerCase().includes(query));
  if (state.sort === 'az') list.sort((a, b) => a.title.localeCompare(b.title));
  if (state.sort === 'za') list.sort((a, b) => b.title.localeCompare(a.title));
  if (state.sort === 'new') list.sort((a, b) => deriveComparableTimestamp(b) - deriveComparableTimestamp(a));
  if (list.length) {
    status.textContent = `${list.length} game${list.length > 1 ? 's' : ''} ready to play`;
  } else if (state.showFavoritesOnly) {
    status.textContent = 'No favorites yet. Tap ★ Favorite on a game to save it here.';
  } else {
    status.textContent = 'No matches. Try a different search or tag.';
  }
  grid.innerHTML = '';
  list.forEach(game => {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.favorite = state.favorites.has(game.id) ? 'true' : 'false';

    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = game.new ? 'NEW' : 'PLAY';
    card.appendChild(badge);

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (game.thumb) {
      const img = document.createElement('img');
      img.src = game.thumb;
      img.alt = game.title + ' thumbnail';
      img.loading = 'lazy';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      thumb.appendChild(img);
    } else {
      thumb.textContent = game.emoji || '🎮';
    }
    card.appendChild(thumb);

    const h3 = document.createElement('h3');
    h3.textContent = game.title;
    card.appendChild(h3);

    const desc = document.createElement('p');
    desc.textContent = game.description || game.desc;
    card.appendChild(desc);

    const meta = getGameMetaText(game.id);
    if (meta) {
      const metaEl = document.createElement('p');
      metaEl.style.margin = '6px 0 0';
      metaEl.style.fontSize = '.85rem';
      metaEl.style.opacity = '.85';
      metaEl.textContent = meta;
      card.appendChild(metaEl);
    }

    const badges = getGameBadges(game.id);
    if (badges.length) {
      const row = document.createElement('div');
      row.style.margin = '8px 0 0';
      row.style.display = 'flex';
      row.style.gap = '6px';
      badges.forEach(b => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = b;
        row.appendChild(chip);
      });
      card.appendChild(row);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';

    const fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'btn favorite-toggle';
    const updateFavState = () => {
      const isFav = state.favorites.has(game.id);
      fav.textContent = 'Favorite';
      fav.setAttribute('aria-pressed', isFav ? 'true' : 'false');
      fav.setAttribute('aria-label', `${isFav ? 'Remove' : 'Add'} ${game.title} ${isFav ? 'from' : 'to'} favorites`);
      fav.classList.toggle('is-active', isFav);
    };
    updateFavState();
    fav.onclick = () => {
      if (state.favorites.has(game.id)) {
        state.favorites.delete(game.id);
      } else {
        state.favorites.add(game.id);
      }
      persistFavorites();
      persistPrefs();
      buildTagChips();
      render();
    };
    actions.appendChild(fav);

    const play = document.createElement('button');
    play.className = 'btn primary';
    play.textContent = 'Play';
    play.onclick = () => playInModal(game.path, game.id);
    actions.appendChild(play);

    const share = document.createElement('button');
    share.className = 'btn';
    share.textContent = 'Share';
    share.onclick = () => shareGame(game);
    actions.appendChild(share);

    const open = document.createElement('a');
    open.href = game.path;
    open.className = 'btn';
    open.textContent = 'Open Tab';
    open.target = '_blank';
    open.setAttribute('rel', 'noopener');
    actions.appendChild(open);

    card.appendChild(actions);
    grid.appendChild(card);
  });
}

function adaptGameForLanding(raw) {
  if (!raw) return null;
  const description = raw.description || raw.short || raw.desc || '';
  const tags = Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [];
  let path = raw.playPath || raw.path || raw.playUrl || raw.url || null;
  if (!path && raw.basePath) {
    const base = String(raw.basePath).replace(/\/+$/, '');
    path = base && base !== '/' ? `${base}/index.html` : '/index.html';
  }
  return { ...raw, description, desc: description, tags, path };
}

async function loadGames() {
  skeletonCards();
  try {
    const { loadGameCatalog } = await import('../shared/game-catalog.js');
    const catalog = await loadGameCatalog();
    state.games = catalog.games.map(adaptGameForLanding).filter(Boolean);
  } catch (e) {
    import('../tools/reporters/console-signature.js').then(({ warn }) => warn('app', '[games] catalog unavailable', e));
    state.games = [];
  }
  state.tags = new Set(state.games.flatMap(g => g.tags || []));
  if (state.activeTag && !state.tags.has(state.activeTag)) state.activeTag = null;
  buildTagChips();
  render();
  persistPrefs();
}

document.addEventListener('DOMContentLoaded', () => {
  particleBG();
  const status = document.getElementById('status');
  if (status?.parentElement) status.parentElement.insertBefore(xpBadge(), status.nextSibling);
});

hydrateUI();
loadGames();
