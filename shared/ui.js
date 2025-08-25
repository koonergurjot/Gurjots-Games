// === Recently Played helpers ===
export function getLastPlayed(limit = 10) {
  try {
    const raw = localStorage.getItem('lastPlayed');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, limit) : [];
  } catch { return []; }
}

// === Best Score helpers ===
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

// === Pause / Restart overlay ===
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

// === Fullscreen helper ===
export function toggleFullscreen(el = document.documentElement) {
  if (!document.fullscreenElement) return el.requestFullscreen?.();
  return document.exitFullscreen?.();
}
