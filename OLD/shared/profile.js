import { getAchievements } from './achievements.js';

const PROFILE_KEY = 'gg:profile';

export function getProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || { name: 'Guest', avatar: '' };
  } catch {
    return { name: 'Guest', avatar: '' };
  }
}

export function login(name, avatar = '') {
  const profile = { name, avatar };
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    // also set profile name for achievement storage
    localStorage.setItem('profile', name);
  } catch {}
  return profile;
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
  const { name, avatar } = getProfile();
  const { achievements } = getAggregatedStats();
  container.innerHTML = `
    <img src="${avatar || 'assets/favicon.png'}" alt="avatar" class="avatar" style="width:24px;height:24px;border-radius:50%;"> 
    <span class="name">${name}</span>
    <span class="ach-count">🏆 ${achievements.length}</span>
  `;
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
