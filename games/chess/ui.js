import { getProfile } from '../../shared/profile.js';
import { PROFILE_EVENT } from '../../shared/profile-events.js';

const STORAGE_PREFIX = 'gg:chess';
const RATING_KEY = 'ladder-rating';
const LEVEL_KEY = 'ladder-level';
const PUZZLE_PREFIX = 'puzzles:';
const MILESTONE_PREFIX = 'milestone:';

function normalizeProfileName(name) {
  if (typeof name !== 'string') return 'guest';
  const trimmed = name.trim();
  if (!trimmed) return 'guest';
  return trimmed.toLowerCase().replace(/\s+/g, '_');
}

function scopedKey(suffix) {
  try {
    const profile = getProfile();
    const base = normalizeProfileName(profile?.name);
    return `${STORAGE_PREFIX}:${base}:${suffix}`;
  } catch {
    return `${STORAGE_PREFIX}:guest:${suffix}`;
  }
}

function readNumber(suffix, fallback) {
  try {
    const raw = localStorage.getItem(scopedKey(suffix));
    if (raw === null || raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeNumber(suffix, value) {
  try {
    localStorage.setItem(scopedKey(suffix), String(Math.round(value)));
  } catch {}
}

function readJson(suffix) {
  try {
    const raw = localStorage.getItem(scopedKey(suffix));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  return {};
}

function writeJson(suffix, value) {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(scopedKey(suffix));
    } else {
      localStorage.setItem(scopedKey(suffix), JSON.stringify(value));
    }
  } catch {}
}

let ratingLabel = null;

function ensureRatingLabel() {
  if (typeof document === 'undefined') return null;
  if (ratingLabel && ratingLabel.isConnected) return ratingLabel;
  ratingLabel = document.getElementById('training-rating');
  if (ratingLabel) return ratingLabel;
  const header = document.querySelector('.training-ladder__header');
  if (!header) return null;
  const span = document.createElement('span');
  span.id = 'training-rating';
  span.className = 'training-ladder__rating';
  span.style.fontSize = '0.75rem';
  span.style.color = '#9ca3af';
  header.appendChild(span);
  ratingLabel = span;
  return ratingLabel;
}

export function updateRatingDisplay(value) {
  const el = ensureRatingLabel();
  if (el) el.textContent = `ELO ${Math.round(value)}`;
}

export function initUi() {
  updateRatingDisplay(loadLadderRating());
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(PROFILE_EVENT, () => {
      updateRatingDisplay(loadLadderRating());
    });
  }
}

export function loadLadderRating() {
  return readNumber(RATING_KEY, 1200);
}

export function saveLadderRating(value) {
  writeNumber(RATING_KEY, value);
  updateRatingDisplay(value);
}

export function loadLevelSelection() {
  const stored = readNumber(LEVEL_KEY, 2);
  if (!Number.isFinite(stored)) return '2';
  const clamped = Math.min(5, Math.max(1, Math.round(stored)));
  return String(clamped);
}

export function saveLevelSelection(level) {
  const value = Number(level);
  const clamped = Math.min(5, Math.max(1, Number.isFinite(value) ? Math.round(value) : 1));
  writeNumber(LEVEL_KEY, clamped);
}

function normalizeProgressValue(input, fallback = 0) {
  const value = Number(input);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

export function loadPuzzleProgress(dateKey) {
  if (!dateKey) {
    return { solved: 0, current: null, streak: 0, best: 0 };
  }
  const data = readJson(`${PUZZLE_PREFIX}${dateKey}`);
  const solved = normalizeProgressValue(data?.solved, 0);
  const streak = normalizeProgressValue(data?.streak, 0);
  const best = Math.max(streak, normalizeProgressValue(data?.best, 0));
  const currentRaw = data?.current;
  const current = Number.isInteger(currentRaw) && currentRaw >= 0 ? currentRaw : null;
  return { solved, current, streak, best };
}

export function savePuzzleProgress(dateKey, data) {
  if (!dateKey) return;
  const solved = normalizeProgressValue(data?.solved, 0);
  const streak = normalizeProgressValue(data?.streak, 0);
  const best = Math.max(streak, normalizeProgressValue(data?.best, streak));
  const current = Number.isInteger(data?.current) && data.current >= 0 ? Math.round(data.current) : null;
  writeJson(`${PUZZLE_PREFIX}${dateKey}`, { solved, current, streak, best });
}

export function clearPuzzleProgress(dateKey) {
  if (!dateKey) return;
  writeJson(`${PUZZLE_PREFIX}${dateKey}`, null);
}

export function hasMilestone(name) {
  if (!name) return false;
  try {
    return localStorage.getItem(scopedKey(`${MILESTONE_PREFIX}${name}`)) === '1';
  } catch {
    return false;
  }
}

export function markMilestone(name) {
  if (!name) return;
  try {
    localStorage.setItem(scopedKey(`${MILESTONE_PREFIX}${name}`), '1');
  } catch {}
}

export function onProfileChange(callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') return () => {};
  const handler = () => callback();
  window.addEventListener(PROFILE_EVENT, handler);
  return () => window.removeEventListener(PROFILE_EVENT, handler);
}
