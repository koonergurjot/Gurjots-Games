const THEME_KEY = 'gg.theme';
const MOTION_KEY = 'gg.motion';

// expose app state bucket
window.gg = window.gg || {};

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');

export function applyTheme(theme) {
  const t = theme ?? localStorage.getItem(THEME_KEY) ?? (darkQuery.matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  window.gg.theme = t;
  updateToggle(t);
  return t;
}

export function toggleTheme() {
  const next = (window.gg.theme === 'dark') ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  return applyTheme(next);
}

function updateToggle(t) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isDark = t === 'dark';
  btn.setAttribute('aria-pressed', String(isDark));
  btn.textContent = isDark ? '🌞' : '🌙';
}

function applyMotion(motion) {
  const m = motion ?? localStorage.getItem(MOTION_KEY) ?? (reduceQuery.matches ? 'reduced' : 'normal');
  document.documentElement.dataset.motion = m;
  return m;
}

export function toggleMotion() {
  const next = document.documentElement.dataset.motion === 'reduced' ? 'normal' : 'reduced';
  localStorage.setItem(MOTION_KEY, next);
  return applyMotion(next);
}

applyTheme();
applyMotion();

darkQuery.addEventListener('change', () => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme();
});

reduceQuery.addEventListener('change', () => {
  if (!localStorage.getItem(MOTION_KEY)) applyMotion();
});

const themeBtn = document.getElementById('theme-toggle');
if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
