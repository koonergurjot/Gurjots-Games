// Shared UI helpers — fresh build

export function injectBackButton(href = '../../') {
  let link = document.querySelector('a.back-to-hub');
  if (!link) {
    link = document.createElement('a');
    link.className = 'back-to-hub';
    link.textContent = '← Back to Hub';
    document.body.appendChild(link);
  }
  link.setAttribute('href', href);

  if (!document.head.querySelector('style[data-back-to-hub]')) {
    const style = document.createElement('style');
    style.dataset.backToHub = '';
    style.textContent = '.back-to-hub{position:fixed;top:10px;left:10px;padding:6px 10px;background:#111;color:#fff;border-radius:8px;text-decoration:none;z-index:1000;border:1px solid #2a2a36}';
    document.head.appendChild(style);
  }
}

export function recordLastPlayed(slug) {
  try {
    const raw = localStorage.getItem('lastPlayed');
    const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    const next = [slug, ...arr.filter(s => s !== slug)].slice(0, 10);
    localStorage.setItem('lastPlayed', JSON.stringify(next));
  } catch {
    localStorage.setItem('lastPlayed', JSON.stringify([slug]));
  }
  try {
    const key = `plays:${slug}`;
    const prev = Number(localStorage.getItem(key) || '0');
    localStorage.setItem(key, String(prev + 1));
  } catch {}
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
    const prev = Number(localStorage.getItem(key) || '-Infinity');
    if (Number(score) > prev) localStorage.setItem(key, String(score));
  } catch {}
}

export function getBestScore(slug) {
  try { return Number(localStorage.getItem(`bestScore:${slug}`) || ''); }
  catch { return null; }
}

export function getPlayCount(slug) {
  try { return Number(localStorage.getItem(`plays:${slug}`) || '0'); }
  catch { return 0; }
}

export function attachPauseOverlay({ onResume, onRestart }) {
  const overlay = document.createElement('div');
  overlay.className = 'pause-overlay hidden';
  overlay.innerHTML = `
    <div class="panel">
      <h3>Paused</h3>
      <button id="resumeBtn">Resume</button>
      <button id="restartBtn">Restart</button>
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
