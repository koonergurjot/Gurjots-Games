// Shared UI helpers — fresh build
import { t } from './i18n.js';

export function applyTheme(theme) {
  let t = theme;
  if (!t) {
    try { t = localStorage.getItem('theme') || 'dark'; }
    catch { t = 'dark'; }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = t;
  }
  return t;
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem('theme', next); } catch {}
  return next;
}

applyTheme();

export function injectBackButton(href = '../../') {
  // ensure styles are injected once
  if (!document.head.querySelector('style[data-back-to-hub]')) {
    const style = document.createElement('style');
    style.setAttribute('data-back-to-hub', '');
    style.textContent = `
      .back-to-hub {
        position: fixed;
        top: 10px;
        left: 10px;
        padding: 6px 10px;
        background: var(--button-bg);
        color: var(--fg);
        border-radius: 8px;
        text-decoration: none;
        z-index: 1000;
        border: 1px solid var(--button-border);
      }
    `;
    document.head.appendChild(style);
  }

  let a = document.querySelector('.back-to-hub');
  if (!a) {
    a = document.createElement('a');
    a.className = 'back-to-hub';
    a.textContent = t('backToHub');
    document.body.appendChild(a);
  }
  a.href = href;
}

export function recordLastPlayed(slug) {
  try {
    const raw = localStorage.getItem('lastPlayed');
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [];
    const next = [slug, ...arr.filter(s => s !== slug)].slice(0, 10);
    localStorage.setItem('lastPlayed', JSON.stringify(next));
  } catch {
    localStorage.setItem('lastPlayed', JSON.stringify([slug]));
  }
}

export function getLastPlayed(limit = 10) {
  try {
    const raw = localStorage.getItem('lastPlayed');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, limit) : [];
  } catch { return []; }
}

export function saveBestScore(slug, score) {
  try {
    const key = `bestScore:${slug}`;
    let prev = Number(localStorage.getItem(key));
    if (!Number.isFinite(prev)) prev = -Infinity;
    if (Number(score) > prev) localStorage.setItem(key, String(score));
  } catch {}
}

export function getBestScore(slug) {
  try {
    const raw = localStorage.getItem(`bestScore:${slug}`);
    const num = Number(raw);
    return raw !== null && Number.isFinite(num) ? num : null;
  } catch {
    return null;
  }
}

// Retrieve a sorted array of local leaderboard entries
// Each entry is { name: string, score: number }
// Data is stored in localStorage under `leaderboard:${slug}`
export function getLocalLeaderboard(slug, limit = 10) {
  try {
    const raw = localStorage.getItem(`leaderboard:${slug}`);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(e => e && typeof e.name === 'string' && Number.isFinite(Number(e.score)))
      .map(e => ({ name: e.name, score: Number(e.score) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function attachPauseOverlay({ onResume, onRestart }) {
  const overlay = document.createElement('div');
  overlay.className = 'pause-overlay hidden';
  overlay.innerHTML = `
    <div class="panel">
      <h3>${t('paused')}</h3>
      <button id="resumeBtn">${t('resume')}</button>
      <button id="restartBtn">${t('restart')}</button>
    </div>`;
  document.body.appendChild(overlay);
  const show = () => overlay.classList.remove('hidden');
  const hide = () => overlay.classList.add('hidden');
  overlay.querySelector('#resumeBtn').onclick = () => { hide(); onResume?.(); };
  overlay.querySelector('#restartBtn').onclick = () => { hide(); onRestart?.(); };
  return { show, hide };
}

export function toggleFullscreen(el = document.documentElement) {
  if (!document.fullscreenElement) return el.requestFullscreen?.();
  return document.exitFullscreen?.();
}

export function filterGames(games, query = '', tags = []) {
  const q = query.trim().toLowerCase();
  const tagSet = tags.map(t => t.toLowerCase());
  return games.filter(g => {
    const title = (g.title || g.slug || '').toLowerCase();
    const gameTags = (g.tags || []).map(t => t.toLowerCase());
    const matchQuery = !q || title.includes(q) || gameTags.some(t => t.includes(q));
    const matchTags = !tagSet.length || tagSet.every(t => gameTags.includes(t));
    return matchQuery && matchTags;
  });
}
