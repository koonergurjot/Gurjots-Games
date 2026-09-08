import { emitEvent as emitAchievementEvent } from './achievements.js';
import { recordGameEvent } from './progression.js';
import { recordGameEvent as recordObjectiveEvent } from './objectives.js';
import { pushEvent } from '../games/common/diag-adapter.js';

function toObject(data) {
  if (!data || typeof data !== 'object') return {};
  if (Array.isArray(data)) return {};
  return data;
}

export function gameEvent(type, data = {}) {
  if (typeof type !== 'string') return null;
  const normalized = type.trim();
  if (!normalized) return null;
  const payload = { type: normalized, ...toObject(data) };

  try {
    if (typeof emitAchievementEvent === 'function') {
      emitAchievementEvent(payload);
    }
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[telemetry] achievements emit failed', err);
    }
  }

  // Progression rides on the events games already emit, so a game earns XP,
  // levels and unlocks by reporting what happened rather than wiring up
  // progression itself.
  try {
    if (typeof recordGameEvent === 'function') {
      recordGameEvent(payload);
    }
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[telemetry] progression update failed', err);
    }
  }

  try {
    if (typeof recordObjectiveEvent === 'function') {
      recordObjectiveEvent(payload);
    }
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[telemetry] objective update failed', err);
    }
  }

  try {
    if (typeof pushEvent === 'function') {
      pushEvent('gameplay', payload);
    }
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[telemetry] diagnostics push failed', err);
    }
  }

  return payload;
}
