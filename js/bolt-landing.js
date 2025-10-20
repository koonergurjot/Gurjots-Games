// bolt-landing v2 — 1:1 hero + games grid, auto-adapts to game.html
import { loadGameCatalog } from '../shared/game-catalog.js';
import { registerSW, cacheGameAssets, precacheAssets } from '../shared/sw.js';
import { getLastPlayed } from '../shared/ui.js';
import { getAchievements } from '../shared/achievements.js';
import { whenReady as missionsReady, subscribe as subscribeToMissions } from '../shared/missions.js';

const GRID = document.getElementById('bolt-grid');
const STATUS = document.getElementById('bolt-status');
const SEARCH = document.getElementById('bolt-search');
const CLEAR = document.getElementById('bolt-clear');
const FILTERS = document.getElementById('bolt-filters');
const GAME_COUNT = document.getElementById('bolt-game-count');

let allGames = [];
const PRIMARY_QUERY_KEY = 'slug';
const GAME_LOOKUP = new Map();
const PREFETCHED = new Set();
let CARD_OBSERVER = undefined;
let activeTag = 'All';
let lastRenderedGames = [];
let achievementProgressBySlug = new Map();
let missionProgressBySlug = new Map();
let missionCountdowns = computeCountdowns();
let countdownTimerId = null;
let gamesReady = false;

const CLOCK_ICON =
  '<svg class="bolt-icon-clock" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.333A6.667 6.667 0 1 0 8 14.667 6.667 6.667 0 0 0 8 1.333Zm0 1.334a5.333 5.333 0 1 1 0 10.666 5.333 5.333 0 0 1 0-10.666Zm-.667 1.333v3.73l2.886 1.728.662-1.106-2.215-1.327V4Z" fill="currentColor"/></svg>';

const toSlug = s => (s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
const prettyTag = t => t?.charAt(0).toUpperCase() + t?.slice(1);
const toQuery = s => (s||'').trim().toLowerCase();
function esc(value){
  return String(value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/\"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

const HISTORY_SECTION = document.createElement('section');
HISTORY_SECTION.className = 'bolt-history';
HISTORY_SECTION.setAttribute('hidden', '');
HISTORY_SECTION.setAttribute('aria-labelledby', 'bolt-history-heading');
HISTORY_SECTION.innerHTML = `
  <h2 id="bolt-history-heading" class="bolt-section-title bolt-history-title">Recently Played</h2>
  <div class="bolt-grid bolt-history-grid"></div>
`;

const HISTORY_GRID = HISTORY_SECTION.querySelector('.bolt-history-grid');
GRID?.parentElement?.insertBefore(HISTORY_SECTION, GRID);

const lastPlayedSlugs = getLastPlayed();

registerSW();

missionsReady()
  .then(snapshot => {
    updateMissionProgress(snapshot);
    if (snapshot && snapshot.loaded) {
      updateCountdownDisplays();
      refreshCards();
    }
  })
  .catch(err => console.error('[bolt-landing] missions init failed', err));

subscribeToMissions(snapshot => {
  updateMissionProgress(snapshot);
  updateCountdownDisplays();
  refreshCards();
});

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (!event || typeof event.key !== 'string') return;
    if (!event.key.startsWith('achievements:') && !event.key.startsWith('achstats:')) return;
    updateAchievementProgress();
    refreshCards();
  });
}

function placeholderSVG(label='GG'){
  return `
  <svg viewBox="0 0 512 288" role="img" aria-label="${esc(label)}">
    <defs>
      <linearGradient id="cardGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7dd3fc"/>
        <stop offset="1" stop-color="#a78bfa"/>
      </linearGradient>
      <linearGradient id="lines" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="rgba(255,255,255,.7)"/>
        <stop offset="1" stop-color="rgba(255,255,255,.3)"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="512" height="288" fill="#0f1020"/>
    <g opacity="0.2" stroke="url(#lines)">
      ${Array.from({length:18}).map((_,i)=>`<path d="M0 ${i*16} H 512" />`).join('')}
      ${Array.from({length:9}).map((_,i)=>`<path d="M${i*56} 0 V 288" />`).join('')}
    </g>
    <g>
      <rect x="24" y="24" rx="24" width="180" height="180" fill="url(#cardGrad)"/>
      <g fill="white" transform="translate(58,62)">
        <rect x="-10" y="0" rx="6" width="56" height="14"/>
        <rect x="-10" y="24" rx="6" width="56" height="14"/>
        <rect x="-10" y="48" rx="6" width="56" height="14"/>
      </g>
      <text x="220" y="160" fill="#cbd5e1" font-family="Poppins, Arial" font-size="28" font-weight="800">${esc(label)}</text>
    </g>
  </svg>`;
}

function computeCountdowns(){
  const now = new Date();
  return {
    daily: formatDurationUntil(nextUtcMidnight(now), now),
    weekly: formatDurationUntil(nextIsoWeekStart(now), now),
  };
}

function nextUtcMidnight(now = new Date()){
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next;
}

function nextIsoWeekStart(now = new Date()){
  const day = now.getUTCDay() || 7;
  const daysUntilNextMonday = 8 - day;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilNextMonday));
}

function formatDurationUntil(targetDate, reference = new Date()){
  if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) return '—';
  const ms = Math.max(0, targetDate.getTime() - reference.getTime());
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds <= 0) return 'Ready';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  const seconds = totalSeconds % 60;
  return `${seconds}s`;
}

function updateCountdownDisplays(){
  missionCountdowns = computeCountdowns();
  if (typeof document === 'undefined') return;
  const timers = document.querySelectorAll('[data-mission-timer]');
  timers.forEach(el => {
    const kind = el.dataset.missionTimer;
    const value = missionCountdowns[kind] || '—';
    const labelPrefix = kind === 'weekly' ? 'Weekly missions reset in ' : 'Daily missions reset in ';
    const textTarget = el.querySelector('[data-timer-value]');
    if (textTarget) textTarget.textContent = value;
    el.setAttribute('aria-label', `${labelPrefix}${value}`);
  });
}

function ensureCountdownTimer(){
  if (countdownTimerId != null) return;
  if (typeof window === 'undefined' || typeof window.setInterval !== 'function') return;
  countdownTimerId = window.setInterval(updateCountdownDisplays, 60000);
}

function updateAchievementProgress(){
  try {
    const achievements = getAchievements();
    const map = new Map();
    achievements.forEach(achievement => {
      if (!achievement || typeof achievement.id !== 'string') return;
      const [slug] = achievement.id.split('_');
      if (!slug) return;
      if (!map.has(slug)) {
        map.set(slug, { total: 0, unlocked: 0, achievements: [] });
      }
      const entry = map.get(slug);
      entry.total += 1;
      entry.achievements.push(achievement);
      if (achievement.unlocked) entry.unlocked += 1;
    });
    map.forEach(entry => {
      entry.next = entry.achievements.find(a => !a.unlocked) || null;
      entry.progress = entry.total > 0 ? entry.unlocked / entry.total : 0;
    });
    achievementProgressBySlug = map;
  } catch (err) {
    console.error('[bolt-landing] failed to compute achievement progress', err);
  }
}

function getAchievementDetails(slug){
  if (!slug) return { total: 0, unlocked: 0, progress: 0, next: null };
  const entry = achievementProgressBySlug.get(slug);
  if (!entry) return { total: 0, unlocked: 0, progress: 0, next: null };
  return entry;
}

function updateMissionProgress(snapshot){
  if (!snapshot || snapshot.loaded === false) {
    missionProgressBySlug = new Map();
    return;
  }
  const map = new Map();
  const missions = Array.isArray(snapshot.missions) ? snapshot.missions : [];
  missions.forEach(mission => {
    if (!mission || typeof mission.slug !== 'string') return;
    if (!map.has(mission.slug)) {
      map.set(mission.slug, {
        daily: { total: 0, completed: 0 },
        weekly: { total: 0, completed: 0 }
      });
    }
    if (mission.kind !== 'daily' && mission.kind !== 'weekly') return;
    const bucket = map.get(mission.slug)[mission.kind];
    bucket.total += 1;
    if (mission.completed) bucket.completed += 1;
  });
  missionProgressBySlug = map;
}

function getMissionDetails(slug){
  if (!slug) {
    return {
      daily: { total: 3, completed: 0 },
      weekly: { total: 3, completed: 0 }
    };
  }
  const entry = missionProgressBySlug.get(slug);
  if (!entry) {
    return {
      daily: { total: 3, completed: 0 },
      weekly: { total: 3, completed: 0 }
    };
  }
  return {
    daily: { total: entry.daily.total || 3, completed: entry.daily.completed || 0 },
    weekly: { total: entry.weekly.total || 3, completed: entry.weekly.completed || 0 }
  };
}

function renderMissionChip(kind, data){
  if (!data) return '';
  const label = kind === 'weekly' ? 'Weekly' : 'Daily';
  const total = Number.isFinite(Number(data.total)) && Number(data.total) > 0 ? Number(data.total) : 3;
  const completedRaw = Number.isFinite(Number(data.completed)) ? Number(data.completed) : 0;
  const completed = Math.min(Math.max(0, completedRaw), total);
  const time = missionCountdowns[kind] || '—';
  const isComplete = total > 0 && completed >= total;
  const accessible = `${label} missions ${completed} of ${total}. Resets in ${time}.`;
  return `
    <span class="bolt-card-mission${isComplete ? ' is-complete' : ''}" data-kind="${kind}" aria-label="${esc(accessible)}">
      <span class="bolt-card-mission-kind">${label}</span>
      <span class="bolt-card-mission-count">${completed}/${total}</span>
      <span class="bolt-card-mission-clock" data-mission-timer="${kind}">
        ${CLOCK_ICON}<span data-timer-value>${esc(time)}</span>
      </span>
    </span>`;
}

function card(game){
  const id = game.id || game.slug || toSlug(game.name);
  const slug = game.slug || game.id || toSlug(game.name);
  const title = game.title || game.name || id;
  const tags = game.tags || game.genres || [];
  const short = game.description || '';
  const badge = Array.isArray(tags) && tags[0] ? prettyTag(tags[0]) : 'Game';
  const thumb = game.thumbnailPath || game.thumbnail || game.image || game.cover || null;
  const params = new URLSearchParams();
  if (slug) params.set(PRIMARY_QUERY_KEY, slug);
  if (id) params.set('id', id);
  const href = `game.html?${params.toString()}`;
  const achievement = getAchievementDetails(slug);
  const mission = getMissionDetails(slug);
  const achTotal = achievement.total || 0;
  const achUnlocked = achievement.unlocked || 0;
  const achRatio = achTotal > 0 ? Math.min(1, Math.max(0, achievement.progress || 0)) : 0;
  const achPct = Math.round(achRatio * 100);
  const nextTitle = achievement.next && achievement.next.title ? achievement.next.title : '';
  const achLabelText = achTotal === 0
    ? 'Achievements coming soon'
    : nextTitle
      ? `Next: ${nextTitle}`
      : 'All achievements unlocked';
  const achSummary = achTotal > 0 ? `${achUnlocked}/${achTotal}` : '0/0';
  const missionDaily = renderMissionChip('daily', mission.daily);
  const missionWeekly = renderMissionChip('weekly', mission.weekly);
  const missionMarkup = missionDaily || missionWeekly
    ? `${missionDaily}${missionWeekly}`
    : '<span class="bolt-card-mission is-empty">Missions rotate soon</span>';

  return `
  <article class="bolt-card" tabindex="0" role="article" aria-label="${esc(title)} card" data-slug="${esc(slug)}">
    <div class="bolt-shot">
      <div class="bolt-badge">${esc(badge)}</div>
      ${thumb ? `<img loading="lazy" decoding="async" alt="${esc(title)} thumbnail" src="${thumb}">` : placeholderSVG(String(title).slice(0, 14))}
    </div>
    <div class="bolt-card-body">
      <div class="bolt-card-title">${esc(title)}</div>
      <div class="bolt-card-meta">
        ${Array.isArray(tags) ? tags.slice(0,3).map(t=>`<span>${esc(prettyTag(t))}</span>`).join('') : ''}
      </div>
      ${short ? `<div class="bolt-card-desc">${esc(short)}</div>` : ''}
      <div class="bolt-card-insight">
        <div class="bolt-card-ach">
          <div class="bolt-card-progress-head">
            <span class="bolt-card-progress-label">${esc(achLabelText)}</span>
            <span class="bolt-card-progress-count">${esc(achSummary)}</span>
          </div>
          <div class="bolt-card-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${achPct}" aria-label="${esc(title)} achievement progress">
            <span class="bolt-card-progress-fill" style="width:${achPct}%"></span>
          </div>
        </div>
        <div class="bolt-card-missions" role="group" aria-label="${esc(title)} mission progress">
          ${missionMarkup}
        </div>
      </div>
      <div class="bolt-card-actions">
        <a class="bolt-btn bolt-primary" href="${href}" aria-label="Play ${esc(title)} now">▶ Play</a>
        <a class="bolt-btn" href="${href}#about" aria-label="Open ${esc(title)} details">ℹ Details</a>
      </div>
    </div>
  </article>`;
}

function render(list){
  if (!Array.isArray(list)) list = [];
  lastRenderedGames = list.slice();
  updateAchievementProgress();
  if (GRID) {
    GRID.innerHTML = list.map(card).join('');
    wirePrefetch(GRID);
  }
  const countText = `${list.length} game${list.length === 1 ? '' : 's'} available`;
  if (STATUS) STATUS.textContent = countText;
  if (GAME_COUNT) GAME_COUNT.textContent = list.length + '+';
  updateCountdownDisplays();
  if (typeof window !== 'undefined') ensureCountdownTimer();
}

function renderHistory(slugs = []){
  if (!HISTORY_SECTION) return;
  if (!Array.isArray(slugs) || !slugs.length) {
    HISTORY_SECTION.setAttribute('hidden', '');
    HISTORY_GRID.innerHTML = '';
    return;
  }
  const lookup = new Map(allGames.map(g => [g.slug, g]));
  const items = slugs.map(slug => lookup.get(slug)).filter(Boolean);
  if (!items.length) {
    HISTORY_SECTION.setAttribute('hidden', '');
    HISTORY_GRID.innerHTML = '';
    return;
  }
  HISTORY_GRID.innerHTML = items.map(card).join('');
  HISTORY_SECTION.removeAttribute('hidden');
  wirePrefetch(HISTORY_GRID);
  updateCountdownDisplays();
}

function refreshCards(){
  if (!gamesReady) return;
  render(lastRenderedGames);
  renderHistory(lastPlayedSlugs);
}

function filterAndSearch(){
  const q = toQuery(SEARCH?.value || '');
  const filtered = allGames.filter(g => {
    const inTag = activeTag === 'All' || (g.tags||g.genres||[]).map(toQuery).includes(toQuery(activeTag));
    if (!inTag) return false;
    if (!q) return true;
    const blob = [g.id, g.slug, g.title, g.name, g.description, ...(g.tags||g.genres||[])].join(' ').toLowerCase();
    return blob.includes(q);
  });
  render(filtered);
}

function buildFilterChips(tags){
  const unique = Array.from(new Set(['All', ...tags.filter(Boolean)]));
  FILTERS.innerHTML = unique.map(t => {
    const label = prettyTag(t);
    return `<button class="bolt-chip" role="tab" aria-selected="${t==='All'}" data-tag="${esc(t)}">${esc(label)}</button>`;
  }).join('');
  FILTERS.addEventListener('click', (e)=>{
    const btn = e.target.closest('.bolt-chip'); if (!btn) return;
    activeTag = btn.dataset.tag;
    document.querySelectorAll('.bolt-chip').forEach(b=>b.setAttribute('aria-selected', String(b===btn)));
    filterAndSearch();
  }, {passive:true});
}

function ensureObserver(){
  if (CARD_OBSERVER !== undefined) return CARD_OBSERVER;
  if (!('IntersectionObserver' in window)) {
    CARD_OBSERVER = null;
    return CARD_OBSERVER;
  }
  CARD_OBSERVER = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if (!entry.isIntersecting) return;
      CARD_OBSERVER?.unobserve(entry.target);
      const slug = entry.target?.dataset?.slug;
      if (slug) schedulePrefetch(slug);
    });
  }, { rootMargin: '200px 0px' });
  return CARD_OBSERVER;
}

function collectManifest(slug){
  const record = GAME_LOOKUP.get(slug);
  if (!record) return [];
  const assets = new Set();
  const playPath = record.playPath || record.path;
  if (playPath) assets.add(playPath);
  const thumb = record.thumbnailPath || record.thumbnail || record.image || record.cover;
  if (thumb) assets.add(thumb);
  const assetHints = record.assetHints;
  if (assetHints && typeof assetHints === 'object') {
    Object.values(assetHints).forEach(value => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(item => {
          if (typeof item === 'string') assets.add(item);
          else if (item && typeof item === 'object' && typeof item.url === 'string') assets.add(item.url);
        });
      } else if (typeof value === 'string') {
        assets.add(value);
      } else if (typeof value === 'object' && typeof value.url === 'string') {
        assets.add(value.url);
      }
    });
  }
  return Array.from(assets).filter(Boolean);
}

function schedulePrefetch(slug){
  if (!slug || PREFETCHED.has(slug)) return;
  PREFETCHED.add(slug);
  cacheGameAssets(slug);
  const manifest = collectManifest(slug);
  if (manifest.length) {
    precacheAssets(manifest);
  }
}

function wirePrefetch(root){
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const observer = ensureObserver();
  root.querySelectorAll('.bolt-card').forEach(card => {
    const slug = card?.dataset?.slug;
    if (!slug || card.dataset.prefetchWired === 'true') return;
    card.dataset.prefetchWired = 'true';

    const hover = () => schedulePrefetch(slug);
    card.addEventListener('mouseenter', hover, { once: true, passive: true });
    card.addEventListener('focus', hover, { once: true });
    card.addEventListener('touchstart', hover, { once: true, passive: true });

    if (observer) observer.observe(card);
  });
}

async function boot(){
  try {
    const { games } = await loadGameCatalog();
    const list = Array.isArray(games) ? games : [];
    GAME_LOOKUP.clear();
    allGames = list.map(g => {
      const slug = g.slug || g.id || toSlug(g.name);
      const record = {
        id: g.id || g.slug || toSlug(g.name),
        slug,
        title: g.title || g.name || (g.id || g.slug || 'Game'),
        description: g.description || g.short || '',
        tags: g.tags || g.genres || [],
        thumbnail: g.thumbnail || g.image || g.cover || null,
        playPath: g.playPath || g.playUrl || g.path || null,
        thumbnailPath: g.thumbnailPath || g.thumbnail || g.image || g.cover || null,
        assetHints: g.assets || g.firstFrame || g.initialAssets || null
      };
      if (slug) {
        GAME_LOOKUP.set(slug, record);
      }
      return record;
    }).filter(g => g.id && g.title);

    const tags = allGames.flatMap(g => g.tags).map(t => t && (t[0].toUpperCase()+t.slice(1)));
    buildFilterChips(tags);

    render(allGames);
    renderHistory(lastPlayedSlugs);
    STATUS?.setAttribute('tabindex', '-1');
    STATUS.focus?.();
    gamesReady = true;
    if (missionProgressBySlug.size) refreshCards();
  } catch(err) {
    console.error(err);
    STATUS.textContent = 'Could not load games. Check games.json format.';
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.className = 'bolt-btn';
    retry.onclick = boot;
    STATUS.appendChild(retry);
  }
}

SEARCH?.addEventListener('input', filterAndSearch);
CLEAR?.addEventListener('click', ()=>{ SEARCH.value=''; filterAndSearch(); });

boot();
