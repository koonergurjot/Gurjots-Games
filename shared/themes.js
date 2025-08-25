
// Theme pack manager (local-only unlocks)
const THEME_KEY = 'skin:current';
const UNLOCKS_KEY = 'skin:unlocks';
// thresholds by total plays
const THRESHOLDS = { neon: 5, retro: 10, minimal: 0 };

export function totalPlays(){
  let sum = 0;
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('plays:')) sum += Number(localStorage.getItem(k) || 0);
  }
  return sum;
}

export function getUnlocks(){
  let u = {};
  try { u = JSON.parse(localStorage.getItem(UNLOCKS_KEY) || '{}'); } catch {}
  // recompute from threshold + total plays
  const t = totalPlays();
  u.minimal = true;
  u.neon = u.neon || t >= THRESHOLDS.neon;
  u.retro = u.retro || t >= THRESHOLDS.retro;
  localStorage.setItem(UNLOCKS_KEY, JSON.stringify(u));
  return u;
}

export function applyTheme(name){
  const valid = ['minimal','neon','retro'];
  const skin = valid.includes(name) ? name : 'minimal';
  document.documentElement.classList.remove('skin-minimal','skin-neon','skin-retro');
  document.documentElement.classList.add(`skin-${skin}`);
  localStorage.setItem(THEME_KEY, skin);
  return skin;
}

export function currentTheme(){
  return localStorage.getItem(THEME_KEY) || 'minimal';
}
