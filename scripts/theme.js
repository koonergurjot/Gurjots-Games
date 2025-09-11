const THEME_KEY = 'gg.theme';
const MOTION_KEY = 'gg.motion';

// expose app state bucket
window.gg = window.gg || {};

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');

function applyTheme(theme) {
  let t = theme || localStorage.getItem(THEME_KEY) || 'system';
  const mode = t === 'system' ? (darkQuery.matches ? 'dark' : 'light') : t;
  document.documentElement.dataset.theme = mode;
  // keep track of user preference
  window.gg.theme = t;
  return t;
}

function applyMotion(motion) {
  let m = motion || localStorage.getItem(MOTION_KEY) || 'system';
  const reduced = m === 'system' ? reduceQuery.matches : m === 'reduced';
  document.documentElement.dataset.motion = reduced ? 'reduced' : 'normal';
  return m;
}

export function toggleTheme() {
  const current = localStorage.getItem(THEME_KEY) || 'system';
  const next = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  return next;
}

export function toggleMotion() {
  const current = localStorage.getItem(MOTION_KEY) || 'system';
  const next = current === 'reduced' ? 'system' : 'reduced';
  localStorage.setItem(MOTION_KEY, next);
  applyMotion(next);
  return next;
}

applyTheme();
applyMotion();

darkQuery.addEventListener('change', () => {
  if ((localStorage.getItem(THEME_KEY) || 'system') === 'system') applyTheme('system');
});

reduceQuery.addEventListener('change', () => {
  if ((localStorage.getItem(MOTION_KEY) || 'system') === 'system') applyMotion('system');
});
