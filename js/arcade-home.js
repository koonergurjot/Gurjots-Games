// Homepage behaviour: catalog shelf, game of the day, coin-slot launch, progress, missions.
import { loadGameCatalog } from '../shared/game-catalog.js';
import { getLastPlayed } from '../shared/ui.js';
import { getState } from '../shared/progression.js';
import { whenReady as missionsReady, subscribe as subscribeMissions } from '../shared/missions.js';
import { registerSW } from '../shared/sw.js';
import { prefersReducedMotion } from '../shared/prefs.js';
import { mountChrome } from './site-chrome.js';

mountChrome('games');
try { registerSW(); } catch { /* offline support is a bonus */ }

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pretty = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
const reduceMotion = prefersReducedMotion();

function hueFor(slug) {
  let h = 0;
  for (const ch of String(slug)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}

function playHref(game) {
  const slug = game.slug || game.id;
  const id = game.id || slug;
  return `game.html?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(id)}`;
}

/* Same game for everyone on a given UTC day, so "today's pick" means something. */
function gameOfTheDay(games) {
  if (!games.length) return null;
  const day = Math.floor(Date.now() / 86400000);
  return games[day % games.length];
}

let games = [];
let activeTag = 'All';
let query = '';

function cabinet(game, { wide = false } = {}) {
  const slug = game.slug || game.id;
  const title = game.title || game.name || slug;
  const tags = (game.tags || []).slice(0, 3);
  const thumb = game.thumbnailPath || game.thumbnail || '';
  const best = getBestSafe(slug);
  const shot = thumb
    ? `<img loading="lazy" decoding="async" alt="" src="${esc(thumb)}">`
    : `<span class="cab__fallback" aria-hidden="true">${esc(String(title).slice(0, 2))}</span>`;
  return `
  <a class="cab${wide ? ' cab--wide' : ''}" data-hue="${hueFor(slug)}" href="${playHref(game)}" aria-label="Play ${esc(title)}">
    <div class="cab__screen">${shot}</div>
    <div class="cab__body">
      <div class="cab__marquee">${esc(title)}</div>
      <p class="cab__desc">${esc(game.description || game.short || '')}</p>
      ${best ? `<p class="cab__best">Your best: ${esc(best)}</p>` : ''}
      <div class="cab__tags">${tags.map(t => `<span>${esc(pretty(t))}</span>`).join('')}${game.difficulty ? `<span>${esc(pretty(game.difficulty))}</span>` : ''}</div>
    </div>
  </a>`;
}

function getBestSafe(slug) {
  try {
    const raw = localStorage.getItem(`gg:bests`);
    const map = raw ? JSON.parse(raw) : {};
    const v = map?.[slug];
    const n = typeof v === 'object' ? v?.score : v;
    return Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n).toLocaleString() : '';
  } catch { return ''; }
}

function renderShelf() {
  const shelf = $('#shelf');
  const status = $('#shelf-status');
  if (!shelf) return;
  const q = query.trim().toLowerCase();
  const list = games.filter(g => {
    const tags = (g.tags || []).map(t => String(t).toLowerCase());
    const tagOk = activeTag === 'All' || tags.includes(activeTag.toLowerCase());
    const text = `${g.title || ''} ${g.description || ''} ${tags.join(' ')}`.toLowerCase();
    return tagOk && (!q || text.includes(q));
  });
  if (!list.length) {
    shelf.innerHTML = `<p class="shelf__empty">No games match "${esc(query)}"${activeTag !== 'All' ? ` in ${esc(activeTag)}` : ''}. Clear the search or pick another genre.</p>`;
  } else {
    shelf.innerHTML = list.map((g, i) => cabinet(g, { wide: i === 0 && !q && activeTag === 'All' })).join('');
  }
  if (status) status.textContent = `${list.length} ${list.length === 1 ? 'game' : 'games'} shown`;
}

function renderChips() {
  const host = $('#chips');
  if (!host) return;
  const counts = new Map();
  games.forEach(g => (g.tags || []).forEach(t => counts.set(pretty(String(t)), (counts.get(pretty(String(t))) || 0) + 1)));
  const tags = ['All', ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)].slice(0, 9);
  host.innerHTML = tags.map(t => `<button type="button" class="chip" aria-pressed="${t === activeTag}" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
  host.addEventListener('click', e => {
    const btn = e.target.closest('[data-tag]');
    if (!btn) return;
    activeTag = btn.dataset.tag;
    host.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === btn)));
    renderShelf();
  });
}

function renderRecent() {
  const host = $('#recent');
  if (!host) return;
  const slugs = getLastPlayed(4);
  const picks = slugs.map(s => games.find(g => (g.slug || g.id) === s)).filter(Boolean);
  if (!picks.length) { host.hidden = true; return; }
  host.hidden = false;
  host.querySelector('.shelf').innerHTML = picks.map(g => cabinet(g)).join('');
}

function renderToday() {
  const pick = gameOfTheDay(games);
  const pickName = $('#today-game');
  if (pick && pickName) {
    pickName.innerHTML = `<a class="btn" href="${playHref(pick)}">Play ${esc(pick.title || pick.slug)}</a>`;
    $('#today-game-name').textContent = pick.title || pick.slug;
    $('#today-game-desc').textContent = pick.description || '';
    const slotPick = $('#slot-pick');
    if (slotPick) slotPick.innerHTML = `Today's pick: <b>${esc(pick.title || pick.slug)}</b>`;
  }
  try {
    const s = getState();
    $('#today-level').textContent = `Level ${s.level}`;
    $('#today-xp').textContent = s.plays > 0 ? `${s.remaining} XP to level ${s.level + 1}` : 'Play a game to earn your first XP';
    const bar = $('#today-bar');
    if (bar) bar.style.width = `${Math.round(s.ratio * 100)}%`;
    $('#today-plays').textContent = String(s.plays);
  } catch { /* leave defaults */ }
  const last = getLastPlayed(1)[0];
  const lastGame = games.find(g => (g.slug || g.id) === last);
  const cont = $('#today-continue');
  if (cont) {
    cont.innerHTML = lastGame
      ? `<a href="${playHref(lastGame)}">Pick up ${esc(lastGame.title || last)} again</a>`
      : 'No games played on this device yet';
  }
}

function wireSlot() {
  const btn = $('#coin-btn');
  const token = $('#token');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const pick = gameOfTheDay(games);
    if (!pick) { location.hash = '#games'; return; }
    const go = () => { location.href = playHref(pick); };
    if (reduceMotion || !token) { go(); return; }
    btn.disabled = true;
    token.classList.add('is-dropping');
    setTimeout(go, 650);
  });
}

function wireSearch() {
  const input = $('#finder-input');
  if (!input) return;
  input.addEventListener('input', () => { query = input.value; renderShelf(); });
}

/* Missions panel, reusing the existing mission engine. */
function wireMissions() {
  const list = $('#missions-list');
  const tabs = [...document.querySelectorAll('[data-mission-tab]')];
  if (!list || !tabs.length) return;
  let snapshot = null;
  let kind = 'daily';
  const name = slug => (slug || '').split(/[-_]/).filter(Boolean).map(pretty).join(' ');
  function paint() {
    tabs.forEach(t => t.setAttribute('aria-pressed', String(t.dataset.missionTab === kind)));
    if (!snapshot || snapshot.loaded === false) { list.innerHTML = '<p class="shelf__empty">Loading missions...</p>'; return; }
    const items = snapshot.missions.filter(m => m.kind === kind);
    if (!items.length) { list.innerHTML = `<p class="shelf__empty">No ${kind} missions right now. New ones appear after the next reset.</p>`; return; }
    list.innerHTML = items.map(m => {
      const pct = Math.min(100, Math.max(0, m?.progress?.percentage ?? 0));
      return `<article class="mission${m.completed ? ' is-complete' : ''}">
        <div class="mission__meta"><span>${esc(name(m.slug))}</span>${m.completed ? '<span class="mission__done">Completed</span>' : `<span>${pct}%</span>`}</div>
        <h3>${esc(m.title)}</h3><p>${esc(m.desc)}</p>
        <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(m.title)} progress"><i style="width:${pct}%"></i></div>
      </article>`;
    }).join('');
  }
  tabs.forEach(t => t.addEventListener('click', () => { kind = t.dataset.missionTab; paint(); }));
  const take = s => { snapshot = s; paint(); };
  subscribeMissions(take);
  missionsReady().then(take).catch(() => { list.innerHTML = '<p class="shelf__empty">Missions could not load. Reload the page to try again.</p>'; });
  paint();
}

async function init() {
  wireSearch();
  wireMissions();
  try {
    const catalog = await loadGameCatalog();
    // catalog.games carries tags, thumbnails and descriptions; normalizedList is only slug/title/path.
    games = (catalog.games || []).filter(g => g && (g.slug || g.id));
    const count = $('#game-count');
    if (count) count.textContent = String(games.length);
    renderChips();
    renderRecent();
    renderShelf();
    renderToday();
    wireSlot();
  } catch (err) {
    console.error('[arcade-home] catalog failed', err);
    const shelf = $('#shelf');
    if (shelf) shelf.innerHTML = '<p class="shelf__empty">The game list could not load. Check your connection and reload.</p>';
  }
}

init();
