// v1.1 Landing boot
const GRID = document.getElementById('gg-grid');
const STATUS = document.getElementById('gg-status');
const SEARCH = document.getElementById('gg-search');
const CLEAR = document.getElementById('gg-clear');
const FILTERS = document.getElementById('gg-filters');

let allGames = [];
let activeTag = 'All';

// derive build version from script tag for cache-busting fetches
const VERSION = new URL(import.meta.url).searchParams.get('v') || '';

const prettyTag = (t) => t?.charAt(0).toUpperCase() + t?.slice(1);
const toQuery = (s) => (s||'').trim().toLowerCase();

function slugify(str){
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function placeholderSVG(label='GG'){
  return `
  <svg viewBox="0 0 512 288" role="img" aria-label="${label}">
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
      <text x="220" y="160" fill="#cbd5e1" font-family="Poppins, Arial" font-size="28" font-weight="800">${label}</text>
    </g>
  </svg>`;
}

function card(game){
  const normalizedId = game.slug || game.id || slugify(game.name);
  const title = game.title || game.name || normalizedId;
  const tags = game.tags || game.genres || [];
  const short = game.description || '';
  const badge = Array.isArray(tags) && tags[0] ? prettyTag(tags[0]) : 'Game';
  const thumb = game.thumbnail || game.image || game.cover || null;
  const href = `game.html?slug=${encodeURIComponent(normalizedId)}`;

  return `
  <article class="gg-card" tabindex="0" role="article" aria-label="${title} card">
    <div class="gg-shot">
      <div class="gg-badge">${badge}</div>
      ${thumb ? `<img loading="lazy" decoding="async" alt="${title} thumbnail" src="${thumb}">` : placeholderSVG(title.slice(0, 14))}
    </div>
    <div class="gg-card-body">
      <div class="gg-card-title">${title}</div>
      <div class="gg-card-meta">
        ${Array.isArray(tags) ? tags.slice(0,3).map(t=>`<span>${prettyTag(t)}</span>`).join('') : ''}
      </div>
      ${short ? `<div class="gg-card-desc">${short}</div>` : ''}
      <div class="gg-card-actions">
        <a class="gg-btn gg-primary" href="${href}" aria-label="Play ${title} now">▶ Play</a>
        <a class="gg-btn" href="${href}#about" aria-label="Open ${title} details">ℹ Details</a>
      </div>
    </div>
  </article>`;
}

function render(list){
  GRID.innerHTML = list.map(card).join('');
  STATUS.textContent = `${list.length} game${list.length===1?'':'s'} available`;
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
  FILTERS.innerHTML = unique.map(t => `<button class="gg-chip" role="tab" aria-selected="${t==='All'}" data-tag="${t}">${prettyTag(t)}</button>`).join('');
  FILTERS.addEventListener('click', (e)=>{
    const btn = e.target.closest('.gg-chip'); if (!btn) return;
    activeTag = btn.dataset.tag;
    document.querySelectorAll('.gg-chip').forEach(b=>b.setAttribute('aria-selected', String(b===btn)));
    filterAndSearch();
  }, {passive:true});
}

async function loadGamesJson(){
  const url = `./games.json?v=${VERSION}`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Failed to load games.json');
  const data = await res.json();
  const list = Array.isArray(data) ? data : (Array.isArray(data.games) ? data.games : []);
  allGames = list.map(g => ({
      id: g.id || g.slug || g.name,
      slug: g.slug || null,
      name: g.name || null,
      title: g.title || g.name,
      description: g.description || g.desc || '', // fallback for legacy desc
      tags: g.tags || g.genres || [],
      thumbnail: g.thumbnail || g.image || g.cover || null
  })).filter(g => g.id && g.title);
  const tags = allGames.flatMap(g => g.tags).map(t => t && (t[0].toUpperCase()+t.slice(1)));
  buildFilterChips(tags);
  render(allGames);
}

function showError(msg){
  STATUS.textContent = msg + ' ';
  const btn = document.createElement('button');
  btn.textContent = 'Retry';
  btn.className = 'gg-btn';
  btn.onclick = boot;
  STATUS.appendChild(btn);
}

async function boot(){
  try {
    await loadGamesJson();
    STATUS.focus?.();
  } catch (err) {
    console.error(err);
    showError('Could not load games. Check games.json in the repo root.');
  }
}

SEARCH?.addEventListener('input', filterAndSearch);
CLEAR?.addEventListener('click', ()=>{ SEARCH.value=''; filterAndSearch(); });

boot();
