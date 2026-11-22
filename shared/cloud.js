// Cloud account client: sign-in, save sync and leaderboards via /api (Cloudflare D1).
// Everything degrades quietly: if the API is unreachable the arcade keeps working locally.
export const CLOUD_EVENT = 'gg:cloud';

// Keys that make up a player's progress. Settings are device-specific and stay local.
const SYNC_KEYS = ['gg:bests', 'gg:unlocks', 'gg:xp', 'lastPlayed', 'skin:unlocks'];
const SYNC_PREFIXES = ['gg:xp:', 'gg:missions:', 'achievements:', 'achstats:', 'plays:'];

let user = null;

async function call(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || 'Something went wrong. Try again.');
  return data;
}

function emit() {
  try { window.dispatchEvent(new CustomEvent(CLOUD_EVENT, { detail: { user } })); } catch { /* no window */ }
}

function syncedKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (SYNC_KEYS.includes(k) || SYNC_PREFIXES.some(p => k.startsWith(p)))) keys.push(k);
    }
  } catch { /* storage blocked */ }
  return keys;
}

function parse(v) { try { return JSON.parse(v); } catch { return null; } }

/**
 * Merge two parsed values so progress only ever moves forward: numbers keep the higher value,
 * booleans are OR-ed, objects merge key by key, and anything else keeps the local value.
 */
export function mergeValue(local, cloud) {
  if (local === undefined || local === null) return cloud;
  if (cloud === undefined || cloud === null) return local;
  if (typeof local === 'number' && typeof cloud === 'number') return Math.max(local, cloud);
  if (typeof local === 'boolean' && typeof cloud === 'boolean') return local || cloud;
  if (Array.isArray(local) && Array.isArray(cloud)) return cloud.length > local.length ? cloud : local;
  if (local && cloud && typeof local === 'object' && typeof cloud === 'object' && !Array.isArray(local) && !Array.isArray(cloud)) {
    const out = { ...local };
    for (const k of Object.keys(cloud)) out[k] = mergeValue(local[k], cloud[k]);
    return out;
  }
  return local;
}

/** Merge a cloud snapshot into local storage without ever lowering a score or losing local progress. */
export function mergeSnapshot(cloud) {
  if (!cloud || typeof cloud !== 'object') return;
  for (const [key, value] of Object.entries(cloud)) {
    if (typeof value !== 'string') continue;
    let local = null;
    try { local = localStorage.getItem(key); } catch { return; }
    if (local === null) { localStorage.setItem(key, value); continue; }
    const a = parse(local);
    const b = parse(value);
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      localStorage.setItem(key, JSON.stringify(mergeValue(a, b)));
    }
  }
}

export function snapshot() {
  const data = {};
  for (const k of syncedKeys()) { try { data[k] = localStorage.getItem(k); } catch { /* skip */ } }
  return data;
}

export const getUser = () => user;

export async function refresh() {
  try { user = (await call('/api/me')).user; } catch { user = null; }
  emit();
  return user;
}

export async function pushSave() {
  if (!user) return false;
  await call('/api/save', { method: 'PUT', body: JSON.stringify({ data: snapshot() }) });
  const bests = parse(localStorage.getItem('gg:bests')) || {};
  await Promise.all(Object.entries(bests)
    .filter(([, n]) => Number.isFinite(Number(n)) && Number(n) > 0)
    .map(([game, score]) => call('/api/score', { method: 'POST', body: JSON.stringify({ game, score: Number(score) }) }).catch(() => null)));
  return true;
}

export async function pullSave() {
  if (!user) return false;
  const { data } = await call('/api/save');
  mergeSnapshot(data);
  return true;
}

async function afterSignIn(result) {
  user = result.user;
  try { await pullSave(); await pushSave(); } catch { /* sync is best effort */ }
  emit();
  return user;
}

export async function signUp(username, password) {
  return afterSignIn(await call('/api/signup', { method: 'POST', body: JSON.stringify({ username, password }) }));
}
export async function signIn(username, password) {
  return afterSignIn(await call('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }));
}
export async function signOut() {
  await call('/api/logout', { method: 'POST' });
  user = null;
  emit();
}
export async function deleteAccount() {
  await call('/api/account', { method: 'DELETE' });
  user = null;
  emit();
}
export async function leaderboard(game) {
  return (await call(`/api/leaderboard?game=${encodeURIComponent(game)}`)).entries;
}

// Keep the cloud copy fresh when progress changes, at most once every few seconds. Games run in their
// own document, so besides this page's own event we also listen for localStorage writes made there.
let timer = null;
let autoSyncOn = false;
const schedulePush = () => {
  if (!user) return;
  clearTimeout(timer);
  timer = setTimeout(() => { pushSave().catch(() => {}); }, 4000);
};
export function autoSync() {
  if (autoSyncOn) return;
  autoSyncOn = true;
  window.addEventListener('gg:progression', schedulePush);
  window.addEventListener('storage', e => {
    if (!e.key || SYNC_KEYS.includes(e.key) || SYNC_PREFIXES.some(p => e.key.startsWith(p))) schedulePush();
  });
}
