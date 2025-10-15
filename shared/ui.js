// Shared UI helpers — fresh build
import { t } from './i18n.js';
function esc(value){
  return String(value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

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
  btn.setAttribute('aria-label', t('help'));
  btn.title = t('help');

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

// Convenience helper to render the best score for a game
// Accepts the game slug and an optional DOM element whose
// textContent will be updated with the retrieved score.
// Returns the numeric best score (or null if none stored).
export function showBestScore(slug, el) {
  const best = getBestScore(slug);
  if (el && best !== null) el.textContent = String(best);
  else if (el) el.textContent = '0';
  return best;
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
    <div class="pixel-panel pixel-panel--pause" role="document">
      <div class="pixel-panel__header">
        <span class="pixel-panel__icon pixel-panel__icon--star" aria-hidden="true"></span>
        <h3 class="pixel-panel__title">${t('paused')}</h3>
        <span class="pixel-panel__icon pixel-panel__icon--shield" aria-hidden="true"></span>
      </div>
      <div class="pixel-panel__actions">
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

export function attachHelpOverlay({ gameId, steps = [], objective = '', controls = '', tips = [] }) {
  const hasContent = Boolean(
    objective ||
    controls ||
    (tips && tips.length) ||
    (steps && steps.length)
  );
  const overlay = document.createElement('div');
  overlay.className = 'help-overlay hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="pixel-panel pixel-panel--help" role="document">
      <button class="close-icon" aria-label="${t('close')}">\u00d7</button>
      <div class="pixel-panel__header">
        <span class="pixel-panel__icon pixel-panel__icon--star" aria-hidden="true"></span>
        <h3 class="pixel-panel__title">${t('help')}</h3>
        <span class="pixel-panel__icon pixel-panel__icon--shield" aria-hidden="true"></span>
      </div>
      <div class="pixel-panel__body">
        <div class="step-wrapper">
          <div class="walkthrough" aria-hidden="true">
            <div class="walkthrough__viewport">
              <div class="walkthrough__board">
                <div class="walkthrough__grid"></div>
                <div class="walkthrough__glow"></div>
                <div class="walkthrough__piece walkthrough__piece--white"></div>
                <div class="walkthrough__piece walkthrough__piece--black"></div>
              </div>
              <div class="walkthrough__camera"></div>
              <div class="walkthrough__difficulty">
                <div class="walkthrough__difficulty-track">
                  <div class="walkthrough__difficulty-fill"></div>
                  <div class="walkthrough__difficulty-thumb"></div>
                </div>
              </div>
            </div>
            <div class="walkthrough__progress"><span></span></div>
          </div>
          <div class="step-content"></div>
        </div>
        <div class="footer">
          <span class="step-indicator"></span>
          <div class="actions">
            <button class="btn next-btn">${t('next')}</button>
            <button class="btn close-btn">${t('close')}</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const normalizedSteps = Array.isArray(steps)
    ? steps.map((step, idx) => normalizeStep(step, idx))
    : [];

  const progressEl = overlay.querySelector('.walkthrough__progress span');
  const walkthroughEl = overlay.querySelector('.walkthrough');
  const boardEl = overlay.querySelector('.walkthrough__board');
  const glowEl = overlay.querySelector('.walkthrough__glow');
  const whitePieceEl = overlay.querySelector('.walkthrough__piece--white');
  const blackPieceEl = overlay.querySelector('.walkthrough__piece--black');
  const cameraEl = overlay.querySelector('.walkthrough__camera');
  const difficultyFillEl = overlay.querySelector('.walkthrough__difficulty-fill');
  const difficultyThumbEl = overlay.querySelector('.walkthrough__difficulty-thumb');

  let index = 0;
  let autoplayTimer = null;

  const resetWalkthrough = () => {
    if (boardEl) boardEl.style.transform = 'rotateX(16deg) rotateZ(-10deg)';
    if (glowEl) {
      glowEl.style.opacity = '0.18';
      glowEl.style.transform = 'scale(0.7)';
    }
    if (whitePieceEl) whitePieceEl.style.transform = 'translate(14px, 74px) scale(1)';
    if (blackPieceEl) blackPieceEl.style.transform = 'translate(78px, 24px) scale(1)';
    if (cameraEl) cameraEl.style.transform = 'rotate(0deg)';
    if (difficultyFillEl) {
      difficultyFillEl.style.transformOrigin = 'left center';
      difficultyFillEl.style.transform = 'scaleX(0.35)';
    }
    if (difficultyThumbEl) difficultyThumbEl.style.transform = 'translateX(0)';
  };

  const activeAnimations = [];
  const clearAnimations = () => {
    while (activeAnimations.length) {
      const anim = activeAnimations.pop();
      try { anim.cancel?.(); } catch {}
    }
  };

  const animateElement = (el, keyframes, options) => {
    if (!el?.animate) return null;
    const animation = el.animate(keyframes, options);
    activeAnimations.push(animation);
    return animation;
  };

  const applyScene = (scene) => {
    resetWalkthrough();
    clearAnimations();
    if (!walkthroughEl) return;
    const sceneKey = scene || 'summary';
    walkthroughEl.setAttribute('data-scene', sceneKey);
    switch (sceneKey) {
      case 'difficulty': {
        animateElement(difficultyFillEl, [
          { transform: 'scaleX(0.3)' },
          { transform: 'scaleX(0.95)', offset: 0.65 },
          { transform: 'scaleX(0.6)' }
        ], { duration: 2200, fill: 'forwards', easing: 'ease-in-out' });
        animateElement(difficultyThumbEl, [
          { transform: 'translateX(0)' },
          { transform: 'translateX(68px)', offset: 0.65 },
          { transform: 'translateX(32px)' }
        ], { duration: 2200, fill: 'forwards', easing: 'ease-in-out' });
        animateElement(glowEl, [
          { opacity: 0.2, transform: 'scale(0.7)' },
          { opacity: 0.35, transform: 'scale(0.9)' },
          { opacity: 0.18, transform: 'scale(0.7)' }
        ], { duration: 2000, fill: 'forwards' });
        break;
      }
      case 'camera': {
        animateElement(boardEl, [
          { transform: 'rotateX(14deg) rotateZ(-14deg)' },
          { transform: 'rotateX(24deg) rotateZ(12deg)', offset: 0.55 },
          { transform: 'rotateX(18deg) rotateZ(-6deg)' }
        ], { duration: 2400, fill: 'forwards', easing: 'ease-in-out' });
        animateElement(cameraEl, [
          { transform: 'rotate(0deg)' },
          { transform: 'rotate(360deg)' }
        ], { duration: 2400, fill: 'forwards', easing: 'ease-in-out' });
        animateElement(glowEl, [
          { opacity: 0.16, transform: 'scale(0.6)' },
          { opacity: 0.3, transform: 'scale(1)' },
          { opacity: 0.2, transform: 'scale(0.7)' }
        ], { duration: 2200, fill: 'forwards' });
        break;
      }
      case 'move':
      default: {
        animateElement(whitePieceEl, [
          { transform: 'translate(14px, 74px) scale(1)' },
          { transform: 'translate(60px, 30px) scale(1.15)', offset: 0.55 },
          { transform: 'translate(86px, 8px) scale(1)' }
        ], { duration: 2200, fill: 'forwards', easing: 'ease-in-out' });
        animateElement(blackPieceEl, [
          { transform: 'translate(78px, 24px) scale(1)' },
          { transform: 'translate(78px, 20px) scale(1.1)', offset: 0.5 },
          { transform: 'translate(78px, 24px) scale(1)' }
        ], { duration: 1800, fill: 'forwards', easing: 'ease-out' });
        animateElement(glowEl, [
          { opacity: 0.16, transform: 'scale(0.6)' },
          { opacity: 0.45, transform: 'scale(1)', offset: 0.55 },
          { opacity: 0.18, transform: 'scale(0.7)' }
        ], { duration: 2200, fill: 'forwards' });
        break;
      }
    }
  };

  const scheduleAutoplay = () => {
    clearTimeout(autoplayTimer);
    if (normalizedSteps.length < 2) return;
    autoplayTimer = setTimeout(() => {
      if (overlay.classList.contains('hidden')) return;
      index = (index + 1) % normalizedSteps.length;
      render();
    }, 4800);
  };

  const render = () => {
    const step = normalizedSteps[index]?.text || '';
    overlay.querySelector('.step-content').innerHTML = `
      ${objective ? `<section><h4>${t('objective')}</h4><p>${esc(objective)}</p></section>` : ''}
      ${controls ? `<section><h4>${t('controls')}</h4><p>${esc(controls)}</p></section>` : ''}
      ${tips && tips.length ? `<section><h4>${t('tips')}</h4><ul>${tips.map(tip => `<li>${esc(tip)}</li>`).join('')}</ul></section>` : ''}
      ${step ? `<section><p>${esc(step)}</p></section>` : ''}`;
    overlay.querySelector('.step-indicator').textContent = normalizedSteps.length ? `${index + 1}/${normalizedSteps.length}` : '';
    if (progressEl) {
      if (normalizedSteps.length) {
        const ratio = ((index + 1) / normalizedSteps.length) * 100;
        progressEl.style.width = `${ratio}%`;
      } else {
        progressEl.style.width = '0%';
      }
    }
    applyScene(normalizedSteps[index]?.scene || null);
    scheduleAutoplay();
  };

  const onKeyDown = e => { if (e.key === 'Escape') hide(); };
  const hide = () => {
    overlay.classList.add('hidden');
    document.removeEventListener('keydown', onKeyDown);
    document.querySelector('.help-btn')?.focus();
    clearTimeout(autoplayTimer);
    clearAnimations();
  };
  const show = () => {
    index = 0;
    render();
    overlay.classList.remove('hidden');
    document.addEventListener('keydown', onKeyDown);
    scheduleAutoplay();
    try {
      const raw = localStorage.getItem('seenHints') || '{}';
      const obj = JSON.parse(raw);
      obj[gameId] = true;
      localStorage.setItem('seenHints', JSON.stringify(obj));
    } catch {}
  };

  overlay.addEventListener('click', e => { if (e.target === overlay) hide(); });
  overlay.querySelector('.next-btn').onclick = () => {
    if (index < normalizedSteps.length - 1) {
      index++;
      render();
    } else {
      hide();
    }
  };
  overlay.querySelector('.close-btn').onclick = hide;
  overlay.querySelector('.close-icon').onclick = hide;

  let seen = false;
  try {
    const raw = localStorage.getItem('seenHints');
    const obj = raw ? JSON.parse(raw) : {};
    seen = !!obj[gameId];
  } catch {}
  if (!seen && hasContent) show();

  return { show, hide };
}

function normalizeStep(step, index) {
  if (step && typeof step === 'object') {
    const text = typeof step.text === 'string' ? step.text : '';
    const scene = typeof step.scene === 'string' ? step.scene : inferScene(text, index);
    return { text, scene };
  }
  const text = typeof step === 'string' ? step : '';
  return { text, scene: inferScene(text, index) };
}

function inferScene(text, index) {
  const value = (text || '').toLowerCase();
  if (value.includes('difficult') || value.includes('level') || value.includes('depth')) return 'difficulty';
  if (value.includes('camera') || value.includes('rotate') || value.includes('view')) return 'camera';
  if (value.includes('move') || value.includes('piece') || value.includes('checkmate') || value.includes('attack')) return 'move';
  if (index === 0) return 'difficulty';
  if (index === 1) return 'camera';
  return 'move';
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
    const catalogPaths = ['../games.json', '../public/games.json'];
    let data = null;
    for (const rel of catalogPaths) {
      try {
        const res = await fetch(new URL(rel, import.meta.url), { cache: 'no-store' });
        if (!res?.ok) throw new Error(`bad status ${res?.status}`);
        data = await res.json();
        break;
      } catch (_) {
        data = null;
      }
    }
    if (!data) throw new Error('catalog unavailable');
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
