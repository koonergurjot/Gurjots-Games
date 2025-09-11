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

export function injectHelpButton(opts) {
  // ensure styles are injected once
  if (!document.head.querySelector('style[data-help-btn]')) {
    const style = document.createElement('style');
    style.setAttribute('data-help-btn', '');
    style.textContent = `
      .help-btn {
        position: fixed;
        top: 10px;
        right: 10px;
        width: 32px;
        height: 32px;
        padding: 0;
        background: var(--button-bg);
        color: var(--fg);
        border-radius: 50%;
        border: 1px solid var(--button-border);
        z-index: 1000;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);
  }

  let btn = document.querySelector('.help-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'help-btn';
    btn.textContent = '?';
    document.body.appendChild(btn);
  }

  let overlay;
  btn.onclick = () => {
    overlay = overlay || attachHelpOverlay(opts || { gameId: 'unknown', steps: [] });
    overlay.show();
  };
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
      <h3 style="margin:0 0 12px 0; font: 700 18px Inter,system-ui">${t('paused')}</h3>
      <div style="display:flex; gap:10px; justify-content:center">
        <button id="resumeBtn" class="btn">${t('resume')}</button>
        <button id="restartBtn" class="btn">${t('restart')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const show = () => overlay.classList.remove('hidden');
  const hide = () => overlay.classList.add('hidden');
  overlay.querySelector('#resumeBtn').onclick = () => { hide(); onResume?.(); };
  overlay.querySelector('#restartBtn').onclick = () => { hide(); onRestart?.(); };
  return { show, hide };
}

export function attachHelpOverlay({ gameId, steps }) {
  const overlay = document.createElement('div');
  overlay.className = 'help-overlay hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="panel">
      <div class="step-content"></div>
      <div class="footer">
        <span class="step-indicator"></span>
        <div class="actions">
          <button class="btn next-btn">Next</button>
          <button class="btn close-btn">Close</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let index = 0;

  const render = () => {
    const step = steps[index] || {};
    overlay.querySelector('.step-content').innerHTML = `
      <section><h4>Objective</h4><p>${step.objective || ''}</p></section>
      <section><h4>Controls</h4><p>${step.controls || ''}</p></section>
      <section><h4>Tips</h4><p>${step.tips || ''}</p></section>`;
    overlay.querySelector('.step-indicator').textContent = `${index + 1}/${steps.length}`;
  };

  const hide = () => overlay.classList.add('hidden');
  const show = () => {
    index = 0;
    render();
    overlay.classList.remove('hidden');
    try {
      const raw = localStorage.getItem('seenHints') || '{}';
      const obj = JSON.parse(raw);
      obj[gameId] = true;
      localStorage.setItem('seenHints', JSON.stringify(obj));
    } catch {}
  };

  overlay.querySelector('.next-btn').onclick = () => {
    if (index < steps.length - 1) {
      index++;
      render();
    } else {
      hide();
    }
  };
  overlay.querySelector('.close-btn').onclick = hide;

  let seen = false;
  try {
    const raw = localStorage.getItem('seenHints');
    const obj = raw ? JSON.parse(raw) : {};
    seen = !!obj[gameId];
  } catch {}
  if (!seen) show();

  return { show, hide };
}

export function toggleFullscreen(el = document.documentElement) {
  if (!document.fullscreenElement) return el.requestFullscreen?.();
  return document.exitFullscreen?.();
}

export async function shareScore(slug, score) {
  const url = `${location.origin}/game.html?slug=${encodeURIComponent(slug)}`;
  let text = `I scored ${score} in ${slug}!`;
  try {
    // Attempt to grab a nicer title from games.json
    const res = await fetch(new URL('../games.json', import.meta.url));
    const data = await res.json();
    const game = (data.games || data).find?.(g => g.slug === slug);
    if (game?.title) text = `I scored ${score} in ${game.title}!`;
  } catch {}
  const shareData = { title: 'My High Score', text, url };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard?.writeText(`${text} ${url}`);
      alert('Share link copied to clipboard');
    }
  } catch {}
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
