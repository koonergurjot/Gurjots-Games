// Arcade-wide progression: XP, levels, personal bests and level-gated unlocks.
//
// XP already existed but only three games ever awarded any, and it never became
// anything a player could see. This module turns the gameplay events every game
// already emits through gameEvent() into progression, so a game earns XP by
// reporting what happened rather than by wiring up progression itself.
//
// Storage is deliberately the same { xp, plays } record that js/gameUtil.js and
// shared/profile.js already read, so existing XP carries over and the hub's
// profile view keeps working.

import { getProfileStatsKey, readProfileStats } from './profile.js';

const BEST_KEY = 'gg:bests';
const UNLOCK_KEY = 'gg:unlocks';
export const PROGRESSION_EVENT = 'gg:progression';

// Each level costs a little more than the last: level 1 -> 2 costs 100, and the
// cost grows by 50 a level. Cheap early levels make the first session feel
// rewarding; the ramp keeps later ones meaningful.
const BASE_COST = 100;
const COST_STEP = 50;

export function xpForLevel(level) {
  const n = Math.max(1, Math.floor(level));
  // Cumulative XP needed to *reach* this level.
  return ((n - 1) * (2 * BASE_COST + (n - 2) * COST_STEP)) / 2;
}

export function levelForXp(xp) {
  const total = Number.isFinite(xp) && xp > 0 ? xp : 0;
  let level = 1;
  while (xpForLevel(level + 1) <= total) level++;
  return level;
}

/** Where the player sits inside their current level, for progress bars. */
export function progressForXp(xp) {
  const total = Number.isFinite(xp) && xp > 0 ? xp : 0;
  const level = levelForXp(total);
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const span = Math.max(1, ceiling - floor);
  return {
    level,
    xp: total,
    into: total - floor,
    needed: span,
    remaining: Math.max(0, ceiling - total),
    ratio: Math.min(1, (total - floor) / span),
  };
}

// Cosmetics and modes earned by levelling. Games read these through
// isUnlocked(); nothing here changes a game's rules, only what it may offer.
export const UNLOCKS = [
  { id: 'theme:neon', level: 2, title: 'Neon palette', desc: 'A brighter board and trail palette.' },
  { id: 'trail:comet', level: 3, title: 'Comet trails', desc: 'Projectiles and dots leave a tail.' },
  { id: 'theme:retro', level: 5, title: 'Retro palette', desc: 'Chunky CRT-era colours.' },
  { id: 'mode:hardcore', level: 7, title: 'Hardcore mode', desc: 'Faster, meaner, one life.' },
  { id: 'theme:mono', level: 10, title: 'Monochrome palette', desc: 'High-contrast black and white.' },
  { id: 'mode:daily', level: 12, title: 'Daily challenge', desc: 'One seeded run a day, arcade-wide.' },
];

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked; progression is not worth breaking play over.
  }
}

function persistStats(stats) {
  const payload = {
    xp: Math.max(0, Math.round(Number(stats.xp) || 0)),
    plays: Math.max(0, Math.round(Number(stats.plays) || 0)),
  };
  try {
    localStorage.setItem(getProfileStatsKey(), JSON.stringify(payload));
    // js/gameUtil.js mirrors the guest record here; keep the two in step.
    localStorage.setItem('gg:xp', JSON.stringify(payload));
  } catch {}
  return payload;
}

function emit(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(PROGRESSION_EVENT, { detail }));
  } catch {}
}

export function getState() {
  const stats = readProfileStats();
  const progress = progressForXp(stats.xp);
  return { ...progress, plays: stats.plays, unlocks: getUnlocked(progress.level) };
}

export function getUnlocked(level = getState().level) {
  return UNLOCKS.filter(u => level >= u.level).map(u => u.id);
}

export function isUnlocked(id, level) {
  const unlock = UNLOCKS.find(u => u.id === id);
  if (!unlock) return false;
  const current = Number.isFinite(level) ? level : levelForXp(readProfileStats().xp);
  return current >= unlock.level;
}

/**
 * Add XP and report what it changed. Returns the new state plus any levels and
 * unlocks crossed, so callers can celebrate without recomputing.
 */
export function awardXp(amount, reason = '') {
  const gain = Math.max(0, Math.round(Number(amount) || 0));
  const before = readProfileStats();
  if (!gain) return { ...progressForXp(before.xp), gained: 0, levelsGained: 0, unlocked: [] };

  const beforeLevel = levelForXp(before.xp);
  const after = persistStats({ xp: before.xp + gain, plays: before.plays });
  const progress = progressForXp(after.xp);
  const unlocked = UNLOCKS.filter(u => u.level > beforeLevel && u.level <= progress.level);

  if (unlocked.length) {
    const stored = readJson(UNLOCK_KEY, {});
    unlocked.forEach(u => { stored[u.id] = Date.now(); });
    writeJson(UNLOCK_KEY, stored);
  }

  const detail = {
    ...progress,
    gained: gain,
    reason,
    levelsGained: progress.level - beforeLevel,
    unlocked,
  };
  emit(detail);
  return detail;
}

export function recordPlay() {
  const stats = readProfileStats();
  persistStats({ xp: stats.xp, plays: stats.plays + 1 });
}

/** Best score per game, so beating your own record can be recognised. */
export function getBest(slug) {
  const bests = readJson(BEST_KEY, {});
  const value = Number(bests[slug]);
  return Number.isFinite(value) ? value : 0;
}

export function recordBest(slug, score) {
  const value = Number(score);
  if (!slug || !Number.isFinite(value)) return { best: getBest(slug), improved: false };
  const bests = readJson(BEST_KEY, {});
  const previous = Number(bests[slug]);
  const prior = Number.isFinite(previous) ? previous : 0;
  if (value <= prior) return { best: prior, improved: false };
  bests[slug] = value;
  writeJson(BEST_KEY, bests);
  return { best: value, improved: true, previous: prior };
}

// What each kind of gameplay event is worth. Ending a run also pays out a slice
// of the score, capped so a single long run cannot dwarf everything else.
// Deliberately absent: 'score'. Games report it continuously while a run is in
// progress -- the runner emits one per frame -- so paying anything per event,
// even only when it beats the stored best, awards XP every frame. A score is
// banked once, at the end of a run.
const EVENT_XP = {
  play: 5,
  start: 0,
  level_up: 15,
  combo: 3,
  win: 40,
  match_win: 40,
  mission_complete: 25,
  score_event: 0,
};

// Finishing a run always pays something, win or lose, so a bad run is still
// worth playing out. Games are inconsistent about which of these they emit --
// some send game_over, some lose, several send all three back to back -- so
// treat them as one family and pay it once per run.
const RUN_END_TYPES = new Set(['game_over', 'lose', 'end', 'match_end', 'match_lose']);
const RUN_END_XP = 5;
const RUN_END_DEDUPE_MS = 2000;
let lastRunEnd = { slug: null, at: 0 };

const SCORE_XP_DIVISOR = 50;
const SCORE_XP_CAP = 60;
const PERSONAL_BEST_BONUS = 50;

/**
 * Translate one gameplay event into progression. Called for every gameEvent, so
 * it must stay cheap and must never throw into the game's own code path.
 */
export function recordGameEvent(event = {}) {
  const type = typeof event.type === 'string' ? event.type : '';
  if (!type) return null;
  const slug = typeof event.slug === 'string' ? event.slug : '';

  if (type === 'play') recordPlay();

  let xp = EVENT_XP[type] ?? 0;
  let reason = type;

  if (RUN_END_TYPES.has(type)) {
    const now = Date.now();
    const duplicate = lastRunEnd.slug === slug && now - lastRunEnd.at < RUN_END_DEDUPE_MS;
    if (!duplicate) {
      lastRunEnd = { slug, at: now };
      xp += RUN_END_XP;
      reason = 'run_end';

      const score = Number(event.value);
      if (Number.isFinite(score) && score > 0) {
        xp += Math.min(SCORE_XP_CAP, Math.floor(score / SCORE_XP_DIVISOR));
      }
      if (slug && Number.isFinite(score)) {
        const { improved } = recordBest(slug, score);
        if (improved) {
          xp += PERSONAL_BEST_BONUS;
          reason = 'personal_best';
        }
      }
    }
  }

  if (!xp) return null;
  return awardXp(xp, reason);
}

export default {
  awardXp,
  getBest,
  getState,
  getUnlocked,
  isUnlocked,
  levelForXp,
  progressForXp,
  recordBest,
  recordGameEvent,
  recordPlay,
  xpForLevel,
  UNLOCKS,
  PROGRESSION_EVENT,
};
