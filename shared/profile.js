import { getAchievements } from './achievements.js';

const PROFILE_KEY = 'gg:profile';
const PROFILE_LIST_KEY = 'gg:profiles';

export const PROFILE_EVENT = 'profile:changed';

function sanitizeProfile(input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const avatar = typeof input.avatar === 'string' ? input.avatar.trim() : '';
  const safeName = name || 'Guest';
  return { name: safeName.slice(0, 60), avatar };
}

function readProfileList() {
  try {
    const raw = localStorage.getItem(PROFILE_LIST_KEY);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Map();
    for (const entry of parsed) {
      const profile = sanitizeProfile(entry);
      if (!profile.name) continue;
      if (profile.name.toLowerCase() === 'guest' && !profile.avatar) continue;
      seen.set(profile.name, profile);
    }
    return Array.from(seen.values());
  } catch {
    return [];
  }
}

function writeProfileList(list) {
  const safeList = Array.isArray(list) ? list.map(sanitizeProfile).filter(p => p.name && (p.name.toLowerCase() !== 'guest' || p.avatar)) : [];
  try {
    if (!safeList.length) {
      localStorage.removeItem(PROFILE_LIST_KEY);
    } else {
      localStorage.setItem(PROFILE_LIST_KEY, JSON.stringify(safeList));
    }
  } catch {}
}

function dispatchProfileChange(detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  let event = null;
  if (typeof window.CustomEvent === 'function') {
    event = new window.CustomEvent(PROFILE_EVENT, { detail });
  } else if (typeof document !== 'undefined' && typeof document.createEvent === 'function') {
    event = document.createEvent('CustomEvent');
    event.initCustomEvent(PROFILE_EVENT, false, false, detail);
  }
  if (event) window.dispatchEvent(event);
}

export function getProfile() {
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (stored && typeof stored === 'object') {
      return sanitizeProfile(stored);
    }
  } catch {}
  return { name: 'Guest', avatar: '' };
}

export function login(name, avatar = '') {
  const profile = sanitizeProfile({ name, avatar });
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    localStorage.setItem('profile', profile.name);
  } catch {}

  const entries = readProfileList().filter(item => item.name !== profile.name);
  if (profile.name.toLowerCase() !== 'guest' || profile.avatar) {
    entries.push(profile);
  }
  writeProfileList(entries);

  dispatchProfileChange({ profile, profiles: listProfiles() });
  return profile;
}

export function listProfiles() {
  const current = sanitizeProfile(getProfile());
  const entries = readProfileList();
  const map = new Map();
  for (const entry of entries) {
    map.set(entry.name, entry);
  }
  map.set(current.name, current);
  if (!map.has('Guest')) {
    map.set('Guest', { name: 'Guest', avatar: '' });
  }

  const items = Array.from(map.values());
  items.sort((a, b) => {
    if (a.name === current.name && b.name !== current.name) return -1;
    if (b.name === current.name && a.name !== current.name) return 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

export function removeProfile(name) {
  const target = typeof name === 'string' ? name.trim() : '';
  if (!target) return listProfiles();

  const saved = readProfileList().filter(entry => entry.name !== target);
  writeProfileList(saved);

  const current = getProfile();
  if (current.name === target) {
    const fallback = saved[0] || { name: 'Guest', avatar: '' };
    login(fallback.name, fallback.avatar);
  } else {
    dispatchProfileChange({ profile: current, profiles: listProfiles() });
  }
  return listProfiles();
}

export function getAggregatedStats() {
  let xp = 0, plays = 0;
  try {
    const s = JSON.parse(localStorage.getItem('gg:xp') || '{"xp":0,"plays":0}');
    xp = s.xp || 0;
    plays = s.plays || 0;
  } catch {}
  const achievements = getAchievements().filter(a => a.unlocked);
  return { xp, plays, achievements };
}

export function initProfileUI(container) {
  if (!container) return;

  const render = () => {
    const { name, avatar } = getProfile();
    const { achievements } = getAggregatedStats();
    container.innerHTML = `
      <img src="${avatar || 'assets/favicon.png'}" alt="avatar" class="avatar" style="width:24px;height:24px;border-radius:50%;">
      <span class="name">${name}</span>
      <span class="ach-count">🏆 ${achievements.length}</span>
    `;
  };

  render();

  if (typeof window !== 'undefined') {
    const handler = () => render();
    window.addEventListener(PROFILE_EVENT, handler);
    return {
      destroy() {
        window.removeEventListener(PROFILE_EVENT, handler);
      }
    };
  }
}

export function onConnectionChange(cb) {
  const handler = () => cb(navigator.onLine);
  window.addEventListener('online', handler);
  window.addEventListener('offline', handler);
  handler();
}

export function syncAchievements() {
  // Placeholder for future server sync; currently just returns local stats
  return getAggregatedStats();
}
