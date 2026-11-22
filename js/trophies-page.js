// Trophies page: level, achievements, level rewards and personal bests, all from existing modules.
import { getState, getBest, UNLOCKS, PROGRESSION_EVENT } from '../shared/progression.js';
import { getAchievements } from '../shared/achievements.js';
import { loadGameCatalog } from '../shared/game-catalog.js';
import { leaderboard } from '../shared/cloud.js';
import { mountChrome } from './site-chrome.js';

mountChrome('trophies');

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let games = [];

function paintSummary() {
  const s = getState();
  $('#sum-level').textContent = String(s.level);
  $('#sum-xp').textContent = s.xp.toLocaleString();
  $('#sum-xp-note').textContent = `Total XP, ${s.remaining.toLocaleString()} to level ${s.level + 1}`;
  $('#sum-plays').textContent = s.plays.toLocaleString();
}

function paintAchievements() {
  let list = [];
  try { list = getAchievements(); } catch { /* leave empty */ }
  const done = list.filter(a => a.unlocked).length;
  $('#sum-ach').textContent = `${done}/${list.length}`;
  const host = $('#achievements');
  if (!list.length) { host.innerHTML = '<p class="shelf__empty">No achievements are available yet.</p>'; return; }
  // Unlocked first so the case opens on what you have earned.
  const sorted = [...list].sort((a, b) => Number(b.unlocked) - Number(a.unlocked));
  host.innerHTML = sorted.map(a => `
    <article class="trophy ${a.unlocked ? 'is-unlocked' : 'is-locked'}">
      <span class="trophy__icon" aria-hidden="true">${esc(a.icon || '🏆')}</span>
      <h3>${esc(a.title)}</h3>
      <p>${esc(a.desc)}${a.unlocked ? '' : ' <span class="sr-only">(locked)</span>'}</p>
    </article>`).join('');
}

function paintLadder() {
  const s = getState();
  $('#ladder').innerHTML = UNLOCKS.map(u => {
    const open = s.level >= u.level;
    return `<li class="${open ? 'is-open' : ''}"><span class="ladder__lvl">Level ${u.level}</span><div><b>${esc(u.title)}</b><span>${esc(u.desc)} ${open ? 'Unlocked.' : `Reach level ${u.level} to unlock.`}</span></div></li>`;
  }).join('');
}

function paintBests() {
  const host = $('#bests-host');
  const rows = games
    .map(g => ({ g, best: getBest(g.slug || g.id) }))
    .filter(r => Number.isFinite(Number(r.best)) && Number(r.best) > 0);
  if (!rows.length) {
    host.innerHTML = '<p class="shelf__empty">No scores saved yet. <a href="index.html#games">Pick a game</a> and set your first best.</p>';
    return;
  }
  host.innerHTML = `<table class="bests"><thead><tr><th scope="col">Game</th><th scope="col">Best score</th></tr></thead><tbody>${
    rows.sort((a, b) => Number(b.best) - Number(a.best)).map(({ g, best }) =>
      `<tr><td><a href="game.html?slug=${encodeURIComponent(g.slug || g.id)}&amp;id=${encodeURIComponent(g.id || g.slug)}">${esc(g.title)}</a></td><td>${Number(best).toLocaleString()}</td></tr>`).join('')
  }</tbody></table>`;
}

async function paintBoard() {
  const sel = $('#lb-game');
  const host = $('#lb-host');
  if (!sel.options.length && games.length) {
    sel.innerHTML = games.map(g => `<option value="${esc(g.slug || g.id)}">${esc(g.title)}</option>`).join('');
    sel.addEventListener('change', paintBoard);
  }
  if (!sel.value) return;
  try {
    const rows = await leaderboard(sel.value);
    host.innerHTML = rows.length
      ? `<table class="bests"><thead><tr><th scope="col">Player</th><th scope="col">Best score</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}. ${esc(r.username)}</td><td>${Number(r.best).toLocaleString()}</td></tr>`).join('')}</tbody></table>`
      : '<p class="shelf__empty">No scores here yet. Be the first.</p>';
  } catch { host.innerHTML = '<p class="shelf__empty">Leaderboards could not load. Try again in a moment.</p>'; }
}

function paintAll() { paintSummary(); paintAchievements(); paintLadder(); paintBests(); }

paintAll();
loadGameCatalog().then(c => { games = c.games || []; paintBests(); paintBoard(); }).catch(() => paintBests());
window.addEventListener(PROGRESSION_EVENT, paintAll);
window.addEventListener('storage', paintAll);
