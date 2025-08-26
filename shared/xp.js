import { startSessionTimer, endSessionTimer } from './metrics.js';

const PROFILE_KEY = 'profile:current';
const XP_PREFIX = 'xp:';
const DEFAULT_ACHIEVEMENT_BONUS = 50;
let session = null; // { slug, start }

function currentProfile(){
  try { return localStorage.getItem(PROFILE_KEY) || 'default'; }
  catch { return 'default'; }
}

function xpKey(profile=currentProfile()){
  return `${XP_PREFIX}${profile}`;
}

export function getXP(profile=currentProfile()){
  try { return Number(localStorage.getItem(xpKey(profile)) || 0); }
  catch { return 0; }
}

function setXP(xp, profile=currentProfile()){
  try { localStorage.setItem(xpKey(profile), String(xp)); } catch {}
}

export function addXP(amount, profile=currentProfile()){
  const total = getXP(profile) + Number(amount||0);
  setXP(total, profile);
  return total;
}

export function xpForLevel(level){
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1/0.8));
}

export function levelFromXP(xp){
  return Math.floor(Math.pow((xp||0)/100, 0.8)) + 1;
}

export function currentLevel(profile=currentProfile()){
  return levelFromXP(getXP(profile));
}

export function xpToNext(profile=currentProfile()){
  const xp = getXP(profile);
  const lvl = levelFromXP(xp);
  const nextThreshold = xpForLevel(lvl + 1);
  return nextThreshold - xp;
}

export function beginPlaySession(slug){
  try {
    const key = `plays:${slug}`;
    const prev = Number(localStorage.getItem(key) || 0);
    localStorage.setItem(key, String(prev + 1));
  } catch {}
  addXP(10);
  startSessionTimer(slug);
  session = { slug, start: performance.now() };
}

export function endPlaySession(slug){
  if (session && session.slug === slug){
    const ms = performance.now() - session.start;
    const minutes = Math.floor(ms / 60000);
    if (minutes > 0) addXP(minutes);
    session = null;
  }
  endSessionTimer(slug);
}

export function awardAchievementXP(bonus=DEFAULT_ACHIEVEMENT_BONUS){
  addXP(bonus);
}

