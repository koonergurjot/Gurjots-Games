// Shared UI helpers — fresh build

export function injectBackButton(href = '/') {
  if (document.querySelector('.back-to-hub')) return;
  const a = document.createElement('a');
  a.className = 'back-to-hub';
  a.href = href;
  a.textContent = '← Back to Hub';
  Object.assign(a.style, { position:'fixed', top:'10px', left:'10px', padding:'6px 10px', background:'#111', color:'#fff', borderRadius:'8px', textDecoration:'none', zIndex:1000, border:'1px solid #2a2a36' });
  document.body.appendChild(a);
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
}

export function getLastPlayed(limit = 10) {
  try {
    const raw = localStorage.getItem('lastPlayed');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, limit) : [];
  } catch { return []; }
}

export function getFavorites() {
  try {
    const raw = localStorage.getItem('favorites');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function toggleFavorite(slug) {
  const favs = new Set(getFavorites());
  if (favs.has(slug)) favs.delete(slug);
  else favs.add(slug);
  localStorage.setItem('favorites', JSON.stringify(Array.from(favs)));
  return Array.from(favs);
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
