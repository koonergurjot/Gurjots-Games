// Arcade-wide player preferences, stored on this device under one key.
// Pages call applyPrefs() on load so the choices take effect everywhere;
// shared/juice/audio.js reads the same record for sound and volume.

export const PREFS_KEY = 'gg:prefs';
export const PREFS_EVENT = 'gg:prefs';

export const DEFAULT_PREFS = Object.freeze({
  sound: true,
  volume: 0.8,
  motion: 'system', // 'system' | 'reduce' | 'full'
  contrast: 'normal', // 'normal' | 'high'
  textSize: 'normal', // 'normal' | 'large' | 'xlarge'
});

const CHOICES = {
  motion: ['system', 'reduce', 'full'],
  contrast: ['normal', 'high'],
  textSize: ['normal', 'large', 'xlarge'],
};

function clean(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = { ...DEFAULT_PREFS };
  if (typeof src.sound === 'boolean') out.sound = src.sound;
  const vol = Number(src.volume);
  if (Number.isFinite(vol)) out.volume = Math.min(1, Math.max(0, vol));
  for (const key of Object.keys(CHOICES)) {
    if (CHOICES[key].includes(src[key])) out[key] = src[key];
  }
  return out;
}

export function getPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return clean(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setPref(key, value) {
  const next = clean({ ...getPrefs(), [key]: value });
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* storage may be blocked; the change still applies for this page view */
  }
  applyPrefs(next);
  try {
    window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next }));
  } catch { /* older browsers */ }
  return next;
}

export function resetPrefs() {
  try { localStorage.removeItem(PREFS_KEY); } catch { /* ignore */ }
  const next = { ...DEFAULT_PREFS };
  applyPrefs(next);
  try { window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next })); } catch { /* ignore */ }
  return next;
}

/** Reflect preferences onto <html> so CSS can react without any JS in the way. */
export function applyPrefs(prefs = getPrefs()) {
  if (typeof document === 'undefined') return prefs;
  const root = document.documentElement;
  root.dataset.motion = prefs.motion;
  root.dataset.contrast = prefs.contrast;
  root.dataset.textSize = prefs.textSize;
  return prefs;
}

/** True when animation should be minimised, honouring the player's override first. */
export function prefersReducedMotion(prefs = getPrefs()) {
  if (prefs.motion === 'reduce') return true;
  if (prefs.motion === 'full') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

applyPrefs();
