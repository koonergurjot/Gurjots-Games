// Shared achievement system
// Schema: { id, title, desc, icon, condition: (event, stats) => boolean }

import { PROFILE_EVENT } from './profile-events.js';

function normalizeProfileName(name) {
  if (typeof name !== 'string') return 'default';
  const trimmed = name.trim();
  return trimmed || 'default';
}

function getAchievementStorageKey(name) {
  return `achievements:${normalizeProfileName(name)}`;
}

function getStatStorageKey(name) {
  return `achstats:${normalizeProfileName(name)}`;
}

let profile = 'default';
let ACH_KEY = getAchievementStorageKey(profile);
let STAT_KEY = getStatStorageKey(profile);

let unlocks = {};
let stats = { plays: {}, totalPlays: 0, missions: { daily: 0, weekly: 0, career: 0, total: 0 } };

function load() {
  unlocks = {};
  stats = { plays: {}, totalPlays: 0 };
  try {
    const raw = localStorage.getItem(ACH_KEY);
    unlocks = raw ? JSON.parse(raw) : {};
  } catch { unlocks = {}; }
  try {
    const raw = localStorage.getItem(STAT_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    stats.plays = parsed.plays || {};
    stats.totalPlays = parsed.totalPlays || 0;
    const missions = parsed.missions && typeof parsed.missions === 'object' ? parsed.missions : {};
    stats.missions = {
      daily: Number.isFinite(Number(missions.daily)) ? Number(missions.daily) : 0,
      weekly: Number.isFinite(Number(missions.weekly)) ? Number(missions.weekly) : 0,
      career: Number.isFinite(Number(missions.career)) ? Number(missions.career) : 0,
      total: Number.isFinite(Number(missions.total)) ? Number(missions.total) : 0,
    };
  } catch { /* ignore */ }
}

export function setActiveProfile(name) {
  const nextProfile = normalizeProfileName(name);
  if (nextProfile === profile) {
    load();
    return;
  }
  profile = nextProfile;
  ACH_KEY = getAchievementStorageKey(profile);
  STAT_KEY = getStatStorageKey(profile);
  load();
}

function initProfile() {
  let stored = 'default';
  try {
    stored = localStorage.getItem('profile') || 'default';
  } catch {}
  setActiveProfile(stored);
}

initProfile();

function saveUnlocks(){
  try { localStorage.setItem(ACH_KEY, JSON.stringify(unlocks)); } catch {}
}
function saveStats(){
  try {
    localStorage.setItem(
      STAT_KEY,
      JSON.stringify({ plays: stats.plays, totalPlays: stats.totalPlays, missions: stats.missions })
    );
  } catch {}
}

export const registry = [
  { id: 'first_play', title: 'First Play', desc: 'Play any game once', icon: '🎉', condition: (e, s) => s.totalPlays >= 1 },
  { id: 'ten_plays', title: 'Ten Plays', desc: 'Play any game ten times', icon: '🔥', condition: (e, s) => s.totalPlays >= 10 },
  { id: 'five_games', title: 'Variety Gamer', desc: 'Play five different games', icon: '🎮', condition: (e, s) => Object.keys(s.plays).length >= 5 },
  { id: 'asteroids_1000', title: 'Space Ace', desc: 'Score 1000 in Asteroids', icon: '🚀', condition: (e) => e.slug === 'asteroids' && e.type === 'score' && Number(e.value) >= 1000 },
  { id: 'pong_perfect', title: 'Perfect Pong', desc: 'Win Pong 11-0', icon: '🏓', condition: (e) => e.slug === 'pong' && e.type === 'game_over' && e.value && e.value.right >= 11 && e.value.left === 0 },
  { id: 'mission_daily_3', title: 'Routine Runner', desc: 'Complete 3 daily missions', icon: '📆', condition: (_e, s) => (s.missions?.daily || 0) >= 3 },
  { id: 'mission_weekly_5', title: 'Weekend Warrior', desc: 'Complete 5 weekly missions', icon: '🛡️', condition: (_e, s) => (s.missions?.weekly || 0) >= 5 },
  { id: 'mission_total_25', title: 'Mission Master', desc: 'Complete 25 missions overall', icon: '🏅', condition: (_e, s) => (s.missions?.total || 0) >= 25 },
];

const toastQueue = [];
let showing = false;
let container;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

function queueToast(ach) {
  toastQueue.push(ach);
  if (!showing) showNextToast();
}

function showNextToast() {
  if (!toastQueue.length) { showing = false; return; }
  showing = true;
  const ach = toastQueue.shift();
  const el = document.createElement('div');
  el.className = 'ach-toast';
  el.textContent = `${ach.icon} ${ach.title}`;
  getContainer().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      el.remove();
      showNextToast();
    }, 300);
  }, 3000);
}

if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
  .ach-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--button-bg,#111522);color:var(--fg,#cfe6ff);padding:8px 14px;border:1px solid var(--button-border,#27314b);border-radius:8px;opacity:0;transition:opacity .3s,transform .3s;z-index:1000;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;font-size:14px;}
  .ach-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
  `;
  document.head.appendChild(style);
}

export function emitEvent(event = {}) {
  // update stats
  if (event.type === 'play') {
    stats.totalPlays++;
    stats.plays[event.slug] = (stats.plays[event.slug] || 0) + 1;
    saveStats();
  } else if (event.type === 'mission_complete') {
    const kind = event?.mission?.kind;
    stats.missions = stats.missions || { daily: 0, weekly: 0, career: 0, total: 0 };
    if (kind === 'daily' || kind === 'weekly' || kind === 'career') {
      stats.missions[kind] = (stats.missions[kind] || 0) + 1;
    }
    stats.missions.total = (stats.missions.total || 0) + 1;
    saveStats();
  }

  for (const a of registry) {
    if (unlocks[a.id]) continue;
    let unlocked = false;
    try { unlocked = a.condition(event, stats); } catch { unlocked = false; }
    if (unlocked) {
      unlocks[a.id] = Date.now();
      saveUnlocks();
      if (typeof document !== 'undefined') queueToast(a);
    }
  }
}

export function getAchievements(){
  return registry.map(a => ({ ...a, unlocked: !!unlocks[a.id], unlockedAt: unlocks[a.id] }));
}

export function getUnlocks(){
  return { ...unlocks };
}

if (typeof window !== 'undefined') {
  window.addEventListener(PROFILE_EVENT, (event) => {
    const name = event && event.detail && event.detail.profile ? event.detail.profile.name : undefined;
    setActiveProfile(name);
  });
}
