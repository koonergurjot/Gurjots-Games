// Home page interactions: pointer-reactive hero, tilting cards, "/" to search,
// game of the day and Surprise me. Pure progressive enhancement: the page works
// without it, and every effect is skipped for reduced-motion / touch-only users.
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const canHover = window.matchMedia?.('(hover: hover)').matches;

function gameHref(game) {
  const params = new URLSearchParams({ slug: game.slug, id: game.id || game.slug });
  return `game.html?${params.toString()}`;
}

function thumbOf(game) {
  return game.thumbnailPath || game.thumbnail || 'assets/placeholder-thumb.png';
}

// Same game for everyone on a given UTC day, so "game of the day" is honest.
function gameOfTheDay(games) {
  const day = Math.floor(Date.now() / 86400000);
  return games[day % games.length];
}

function fillFeature(games) {
  if (!games.length) return;
  const pick = gameOfTheDay(games);
  const others = games.filter(g => g.slug !== pick.slug);
  const card = document.querySelector('[data-feature-card]');
  if (card) {
    card.href = gameHref(pick);
    card.setAttribute('aria-label', `Play ${pick.title}, game of the day`);
    const img = card.querySelector('[data-feature-img]');
    if (img) { img.src = thumbOf(pick); img.alt = ''; }
    const title = card.querySelector('[data-feature-title]');
    if (title) title.textContent = pick.title;
    const desc = card.querySelector('[data-feature-desc]');
    if (desc) desc.textContent = pick.description || '';
  }
  const play = document.querySelector('[data-featured-play]');
  if (play) play.href = gameHref(pick);
  const label = document.querySelector('[data-featured-label]');
  if (label) label.textContent = `Play ${pick.title}`;
  document.querySelectorAll('[data-float-img]').forEach((img, i) => {
    const g = others[(i * 4 + 1) % others.length];
    if (g) img.src = thumbOf(g);
  });
}

function surprise(games) {
  if (!games.length) return;
  const last = sessionStorage.getItem('gg:surprise');
  const pool = games.length > 1 ? games.filter(g => g.slug !== last) : games;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  try { sessionStorage.setItem('gg:surprise', pick.slug); } catch {}
  location.href = gameHref(pick);
}

let games = window.__boltGames || [];
function onGames(list) {
  games = list;
  fillFeature(list);
}
if (games.length) onGames(games);
window.addEventListener('bolt:games', e => onGames(e.detail || []));

document.querySelectorAll('[data-surprise]').forEach(btn => btn.addEventListener('click', () => surprise(games)));

// "/" focuses search from anywhere that is not already a text field.
window.addEventListener('keydown', e => {
  const t = e.target;
  const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const input = document.getElementById('bolt-search');
    input?.focus();
    input?.select();
  } else if (e.key === 'Escape' && t?.id === 'bolt-search') {
    t.value = '';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.blur();
  }
});

if (!reduceMotion && canHover) {
  const hero = document.querySelector('[data-hero]');
  let raf = 0;
  hero?.addEventListener('pointermove', e => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', ((e.clientX - r.left) / r.width).toFixed(3));
      hero.style.setProperty('--my', ((e.clientY - r.top) / r.height).toFixed(3));
    });
  });
  hero?.addEventListener('pointerleave', () => {
    hero.style.setProperty('--mx', '.5');
    hero.style.setProperty('--my', '.5');
  });

  // Card spotlight + tilt. One delegated listener; cards are re-rendered often.
  const grids = document.querySelectorAll('.bolt-grid, .bolt-history-grid');
  grids.forEach(grid => {
    grid.addEventListener('pointermove', e => {
      const card = e.target.closest?.('.bolt-card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--cx', ((e.clientX - r.left) / r.width).toFixed(3));
      card.style.setProperty('--cy', ((e.clientY - r.top) / r.height).toFixed(3));
    });
    grid.addEventListener('pointerout', e => {
      const card = e.target.closest?.('.bolt-card');
      if (!card || card.contains(e.relatedTarget)) return;
      card.style.removeProperty('--cx');
      card.style.removeProperty('--cy');
    });
  });
}
