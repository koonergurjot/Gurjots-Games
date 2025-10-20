import { emitEvent as emitAchievementEvent } from './achievements.js';
import { PROFILE_EVENT } from './profile-events.js';
import { getProfile } from './profile.js';

export const MISSIONS_UPDATED_EVENT = 'missions:updated';
export const MISSION_COMPLETED_EVENT = 'missions:completed';

const MISSION_SOURCES = ['/shared/missions.json', '/public/shared/missions.json'];
const DEFAULT_STATE = () => ({
  version: 1,
  totals: { daily: 0, weekly: 0, career: 0, all: 0 },
  progress: {}
});

let missionDefinitions = [];
let missionLoadPromise = null;
let missionsLoaded = false;
let pendingEvents = [];

let activeProfile = getActiveProfileName();
let profileState = loadProfileState(activeProfile);

const subscribers = new Set();

function getActiveProfileName() {
  try {
    const profile = getProfile();
    const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
    return name || 'Guest';
  } catch (_) {
    return 'Guest';
  }
}

function normalizeProfileKey(name) {
  if (typeof name !== 'string') return 'guest';
  const normalized = name.trim().toLowerCase();
  return normalized || 'guest';
}

function getStorageKey(name) {
  return `gg:missions:${encodeURIComponent(normalizeProfileKey(name))}`;
}

function sanitizeState(input) {
  const base = DEFAULT_STATE();
  if (!input || typeof input !== 'object') return base;
  const totals = input.totals && typeof input.totals === 'object' ? input.totals : {};
  const progress = input.progress && typeof input.progress === 'object' ? input.progress : {};
  return {
    version: 1,
    totals: {
      daily: Number.isFinite(Number(totals.daily)) ? Number(totals.daily) : 0,
      weekly: Number.isFinite(Number(totals.weekly)) ? Number(totals.weekly) : 0,
      career: Number.isFinite(Number(totals.career)) ? Number(totals.career) : 0,
      all: Number.isFinite(Number(totals.all)) ? Number(totals.all) : (
        (Number.isFinite(Number(totals.daily)) ? Number(totals.daily) : 0) +
        (Number.isFinite(Number(totals.weekly)) ? Number(totals.weekly) : 0) +
        (Number.isFinite(Number(totals.career)) ? Number(totals.career) : 0)
      )
    },
    progress: { ...progress }
  };
}

function loadProfileState(name) {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_STATE();
  }
  try {
    const raw = localStorage.getItem(getStorageKey(name));
    if (!raw) return DEFAULT_STATE();
    const parsed = JSON.parse(raw);
    return sanitizeState(parsed);
  } catch (_) {
    return DEFAULT_STATE();
  }
}

function persistState() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(activeProfile), JSON.stringify(profileState));
  } catch (_) {
    /* ignore persistence failures */
  }
}

function getDailyKey(date = new Date()) {
  const d = new Date(date.getTime());
  return d.toISOString().slice(0, 10);
}

function getWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

function getPeriodKey(kind, date = new Date()) {
  if (kind === 'daily') return getDailyKey(date);
  if (kind === 'weekly') return getWeekKey(date);
  return 'career';
}

function ensureEntry(mission) {
  if (!mission || !mission.id) return null;
  if (!profileState || typeof profileState !== 'object') {
    profileState = DEFAULT_STATE();
  }
  if (!profileState.progress || typeof profileState.progress !== 'object') {
    profileState.progress = {};
  }
  const existing = profileState.progress[mission.id];
  const targetPeriod = getPeriodKey(mission.kind);
  if (!existing) {
    const entry = {
      kind: mission.kind,
      period: targetPeriod,
      requirements: {},
      completed: false,
      completedAt: null
    };
    profileState.progress[mission.id] = entry;
    persistState();
    return entry;
  }
  if ((mission.kind === 'daily' || mission.kind === 'weekly') && existing.period !== targetPeriod) {
    existing.period = targetPeriod;
    existing.requirements = {};
    existing.completed = false;
    existing.completedAt = null;
    persistState();
  }
  if (!existing.requirements || typeof existing.requirements !== 'object') {
    existing.requirements = {};
  }
  return existing;
}

function normalizeRequirementProgress(requirement, storedValue) {
  const raw = Number(storedValue) || 0;
  const target = Number(requirement?.count) || 0;
  const safeTarget = target > 0 ? target : 0;
  const current = safeTarget > 0 ? Math.min(raw, safeTarget) : raw;
  const achieved = safeTarget > 0 ? raw >= safeTarget : raw > 0;
  return {
    current,
    raw,
    target: safeTarget,
    completed: achieved,
    remaining: safeTarget > 0 ? Math.max(0, safeTarget - Math.min(raw, safeTarget)) : 0
  };
}

function projectMission(mission, overrideEntry) {
  const entry = overrideEntry || ensureEntry(mission) || { requirements: {}, completed: false, completedAt: null };
  const requirements = Array.isArray(mission.requires) ? mission.requires : [];
  const mapped = requirements.map((requirement, index) => {
    const key = String(index);
    const stored = entry.requirements?.[key] ?? 0;
    const progress = normalizeRequirementProgress(requirement, stored);
    return {
      ...requirement,
      current: progress.current,
      raw: progress.raw,
      target: progress.target,
      completed: progress.completed,
      remaining: progress.remaining
    };
  });
  const completed = entry.completed || (mapped.length ? mapped.every(req => req.completed) : entry.completed);
  const ratio = mapped.length
    ? mapped.reduce((acc, req) => {
        if (req.target <= 0) return acc + (req.completed ? 1 : 0);
        return acc + Math.min(1, req.current / req.target);
      }, 0) / mapped.length
    : completed ? 1 : 0;
  return {
    ...mission,
    requirements: mapped,
    completed,
    completedAt: entry.completedAt,
    progress: {
      ratio,
      percentage: Math.round(ratio * 100),
      completed
    }
  };
}

function getSnapshot() {
  if (!missionsLoaded) {
    return {
      loaded: false,
      profile: activeProfile,
      missions: [],
      totals: { ...profileState?.totals }
    };
  }
  const missions = missionDefinitions.map(mission => projectMission(mission));
  return {
    loaded: true,
    profile: activeProfile,
    missions,
    totals: { ...profileState?.totals }
  };
}

function notifySubscribers() {
  if (!missionsLoaded) return;
  const snapshot = getSnapshot();
  subscribers.forEach(listener => {
    try {
      listener(snapshot);
    } catch (err) {
      console.error('[missions] subscriber failed', err);
    }
  });
  dispatchWindowEvent(MISSIONS_UPDATED_EVENT, snapshot);
}

function dispatchWindowEvent(type, detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  let event = null;
  if (typeof window.CustomEvent === 'function') {
    event = new window.CustomEvent(type, { detail });
  } else if (typeof document !== 'undefined' && typeof document.createEvent === 'function') {
    event = document.createEvent('CustomEvent');
    event.initCustomEvent(type, false, false, detail);
  }
  if (event) window.dispatchEvent(event);
}

function requirementMatches(requirement, event) {
  if (!requirement || !event) return false;
  if (requirement.type && requirement.type !== event.type) return false;
  if (requirement.name && requirement.name !== event.name) return false;
  return true;
}

function updateRequirementProgress(entry, requirement, index, event) {
  if (!entry || !requirementMatches(requirement, event)) return false;
  const key = String(index);
  const prev = Number(entry.requirements?.[key]) || 0;
  let next = prev;

  if (requirement.type === 'combo') {
    const observed = Number(event.count ?? event.value ?? event.best ?? 0);
    if (Number.isFinite(observed) && observed > next) {
      next = observed;
    }
  } else {
    let delta = Number(event.delta ?? event.increment);
    if (!Number.isFinite(delta)) {
      const candidate = Number(event.count ?? event.value ?? event.amount);
      delta = Number.isFinite(candidate) && candidate > 0 ? candidate : 1;
    }
    if (delta > 0) {
      next = prev + delta;
    }
  }

  if (next !== prev) {
    entry.requirements[key] = next;
    return true;
  }
  return false;
}

function completeMission(entry, mission) {
  if (!entry || entry.completed) return;
  entry.completed = true;
  entry.completedAt = Date.now();
  profileState.totals = profileState.totals || { daily: 0, weekly: 0, career: 0, all: 0 };
  if (mission.kind === 'daily' || mission.kind === 'weekly' || mission.kind === 'career') {
    profileState.totals[mission.kind] = (profileState.totals[mission.kind] || 0) + 1;
  }
  profileState.totals.all = (profileState.totals.all || 0) + 1;
  persistState();

  const snapshotMission = projectMission(mission, entry);
  dispatchWindowEvent(MISSION_COMPLETED_EVENT, {
    mission: snapshotMission,
    totals: { ...profileState.totals },
    profile: activeProfile
  });
  emitAchievementEvent({
    type: 'mission_complete',
    mission: snapshotMission,
    totals: { ...profileState.totals }
  });
}

function applyGameEvent(event) {
  if (!missionsLoaded) {
    pendingEvents.push(event);
    return;
  }
  if (!event || typeof event !== 'object') return;
  const slug = typeof event.slug === 'string' ? event.slug.trim() : '';
  if (!slug) return;
  const matches = missionDefinitions.filter(mission => mission.slug === slug);
  if (!matches.length) return;

  let changed = false;
  matches.forEach(mission => {
    const entry = ensureEntry(mission);
    if (!entry) return;
    let entryChanged = false;

    const requirements = Array.isArray(mission.requires) ? mission.requires : [];
    requirements.forEach((requirement, index) => {
      const updated = updateRequirementProgress(entry, requirement, index, event);
      if (updated) entryChanged = true;
    });

    if (entryChanged) {
      const missionState = projectMission(mission, entry);
      if (missionState.completed && !entry.completed) {
        completeMission(entry, mission);
      } else {
        persistState();
      }
      changed = true;
    }
  });

  if (changed) {
    notifySubscribers();
  }
}

function handleMessageEvent(messageEvent) {
  const data = messageEvent?.data;
  if (!data || typeof data !== 'object') return;
  if (data.type !== 'GAME_EVENT') return;
  const payload = data.event && typeof data.event === 'object' ? data.event : data;
  const normalized = normalizeIncomingEvent(payload, data.slug);
  if (normalized) applyGameEvent(normalized);
}

function handleCustomGameEvent(customEvent) {
  const detail = customEvent?.detail;
  const normalized = normalizeIncomingEvent(detail, detail?.slug);
  if (normalized) applyGameEvent(normalized);
}

function normalizeIncomingEvent(source, fallbackSlug) {
  if (!source || typeof source !== 'object') return null;
  const slug = typeof source.slug === 'string' ? source.slug.trim() : (typeof fallbackSlug === 'string' ? fallbackSlug : '');
  if (!slug) return null;
  const type = typeof source.type === 'string' ? source.type.trim() : '';
  if (!type) return null;
  const name = typeof source.name === 'string' ? source.name : undefined;
  const countValue = Number(source.count ?? source.value ?? source.amount ?? 0);
  const incrementValue = Number(source.increment ?? source.delta ?? source.add ?? 0);
  const normalized = { ...source };
  normalized.slug = slug;
  normalized.type = type;
  if (name !== undefined) normalized.name = name;
  if (Number.isFinite(countValue)) {
    normalized.count = countValue;
    normalized.value = countValue;
  }
  if (Number.isFinite(incrementValue) && incrementValue !== 0) {
    normalized.increment = incrementValue;
    normalized.delta = incrementValue;
  }
  return normalized;
}

async function fetchMissionDefinitions() {
  if (missionLoadPromise) return missionLoadPromise;
  missionLoadPromise = (async () => {
    for (const url of MISSION_SOURCES) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res?.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            missionDefinitions = data.filter(item => item && typeof item === 'object' && item.id && item.slug && item.kind);
            missionsLoaded = true;
            flushPendingEvents();
            notifySubscribers();
            return missionDefinitions;
          }
        }
      } catch (err) {
        console.warn('[missions] failed to load', url, err);
      }
    }
    missionDefinitions = [];
    missionsLoaded = true;
    notifySubscribers();
    return missionDefinitions;
  })();
  return missionLoadPromise;
}

function flushPendingEvents() {
  if (!missionsLoaded || !pendingEvents.length) return;
  const queue = pendingEvents.splice(0, pendingEvents.length);
  queue.forEach(event => applyGameEvent(event));
}

function handleProfileChange(event) {
  const name = event?.detail?.profile?.name || getActiveProfileName();
  switchProfile(name);
}

function switchProfile(name) {
  const normalized = name || 'Guest';
  if (normalized === activeProfile) {
    profileState = loadProfileState(activeProfile);
    notifySubscribers();
    return;
  }
  activeProfile = normalized;
  profileState = loadProfileState(activeProfile);
  notifySubscribers();
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', handleMessageEvent, { passive: true });
  window.addEventListener('ggshell:game-event', handleCustomGameEvent, { passive: true });
  window.addEventListener(PROFILE_EVENT, handleProfileChange);
  fetchMissionDefinitions();
}

export async function whenReady() {
  await fetchMissionDefinitions();
  return getSnapshot();
}

export function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  subscribers.add(listener);
  if (missionsLoaded) {
    try { listener(getSnapshot()); } catch (err) { console.error('[missions] subscriber init failed', err); }
  }
  return () => {
    subscribers.delete(listener);
  };
}

export function getMissions(filter = {}) {
  const snapshot = getSnapshot();
  if (!snapshot.loaded) return [];
  const { slug, kind } = filter;
  return snapshot.missions.filter(mission => {
    if (slug && mission.slug !== slug) return false;
    if (kind && mission.kind !== kind) return false;
    return true;
  });
}

export function getMissionTotals() {
  return { ...profileState?.totals };
}

export function resetMissionProgress(id) {
  if (!profileState?.progress || typeof profileState.progress !== 'object') return;
  if (!profileState.progress[id]) return;
  const entry = profileState.progress[id];
  profileState.progress[id] = {
    kind: entry.kind,
    period: getPeriodKey(entry.kind),
    requirements: {},
    completed: false,
    completedAt: null
  };
  persistState();
  notifySubscribers();
}

export default {
  whenReady,
  subscribe,
  getMissions,
  getMissionTotals,
  resetMissionProgress
};
