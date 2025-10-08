const STORAGE_KEY = 'gg:user-state.v1';
const ALLOWED_DIFFICULTIES = ['easy', 'normal', 'hard'];

const defaultState = {
  preferences: {
    sound: true,
    difficulty: 'normal',
  },
  lastPlayed: null,
  favorites: [],
};

const storage = (() => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch (error) {
    // Ignore and fall back to in-memory storage.
  }

  const memory = new Map();
  return {
    getItem(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(key, String(value));
    },
    removeItem(key) {
      memory.delete(key);
    },
  };
})();

function sanitizePreferences(raw = {}) {
  const result = {
    sound: typeof raw.sound === 'boolean' ? raw.sound : Boolean(defaultState.preferences.sound),
    difficulty: ALLOWED_DIFFICULTIES.includes(raw.difficulty)
      ? raw.difficulty
      : defaultState.preferences.difficulty,
  };
  return result;
}

function sanitizeLastPlayed(value) {
  if (!value) {
    return null;
  }

  const gameId = typeof value.gameId === 'string' && value.gameId.trim() ? value.gameId.trim() : null;
  if (!gameId) {
    return null;
  }

  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const playedAt = (() => {
    const timestamp = typeof value.playedAt === 'string' ? value.playedAt : new Date().toISOString();
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return new Date().toISOString();
    }
    return date.toISOString();
  })();

  return {
    gameId,
    title,
    playedAt,
  };
}

function sanitizeFavorites(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const entry of list) {
    if (typeof entry !== 'string') {
      continue;
    }
    const id = entry.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

function sanitizeState(value) {
  const preferences = sanitizePreferences(value?.preferences);
  const lastPlayed = sanitizeLastPlayed(value?.lastPlayed);
  const favorites = sanitizeFavorites(value?.favorites);
  return {
    preferences,
    lastPlayed,
    favorites,
  };
}

function cloneState(state) {
  return {
    preferences: { ...state.preferences },
    lastPlayed: state.lastPlayed ? { ...state.lastPlayed } : null,
    favorites: [...state.favorites],
  };
}

function statesEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (a.preferences.sound !== b.preferences.sound) {
    return false;
  }
  if (a.preferences.difficulty !== b.preferences.difficulty) {
    return false;
  }
  const aLast = a.lastPlayed;
  const bLast = b.lastPlayed;
  if (Boolean(aLast) !== Boolean(bLast)) {
    return false;
  }
  if (aLast && bLast) {
    if (aLast.gameId !== bLast.gameId || aLast.playedAt !== bLast.playedAt || aLast.title !== bLast.title) {
      return false;
    }
  }
  if (a.favorites.length !== b.favorites.length) {
    return false;
  }
  for (let i = 0; i < a.favorites.length; i += 1) {
    if (a.favorites[i] !== b.favorites[i]) {
      return false;
    }
  }
  return true;
}

function loadInitialState() {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return cloneState(defaultState);
    }
    const parsed = JSON.parse(raw);
    return sanitizeState(parsed);
  } catch (error) {
    return cloneState(defaultState);
  }
}

let state = loadInitialState();
const listeners = new Set();

function persist(nextState) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  } catch (error) {
    // Ignore storage errors (e.g., quota exceeded).
  }
}

function setState(updater) {
  const current = cloneState(state);
  const updated = typeof updater === 'function' ? updater(current) || current : sanitizeState(updater);
  const next = sanitizeState(updated);

  if (statesEqual(state, next)) {
    return getState();
  }

  state = next;
  persist(state);

  const snapshot = getState();
  listeners.forEach(listener => {
    try {
      listener(snapshot);
    } catch (error) {
      // Listener errors should not break the store update cycle.
      console.error('[user-state] Listener execution failed', error); // eslint-disable-line no-console
    }
  });

  return snapshot;
}

export function getState() {
  return cloneState(state);
}

export function subscribe(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPreferences() {
  return { ...state.preferences };
}

export function setPreferences(partial) {
  return setState(current => ({
    ...current,
    preferences: sanitizePreferences({
      ...current.preferences,
      ...(typeof partial === 'function' ? partial({ ...current.preferences }) : partial),
    }),
  }));
}

export function setSoundEnabled(enabled) {
  return setPreferences({ sound: Boolean(enabled) });
}

export function setDifficulty(level) {
  const difficulty = typeof level === 'string' ? level.toLowerCase() : defaultState.preferences.difficulty;
  const next = ALLOWED_DIFFICULTIES.includes(difficulty) ? difficulty : defaultState.preferences.difficulty;
  return setPreferences({ difficulty: next });
}

export function setLastPlayed(info) {
  return setState(current => {
    const payload = typeof info === 'function' ? info(current.lastPlayed) : info;
    return {
      ...current,
      lastPlayed: sanitizeLastPlayed(payload),
    };
  });
}

export function clearLastPlayed() {
  return setState(current => ({
    ...current,
    lastPlayed: null,
  }));
}

export function isFavorite(gameId) {
  if (typeof gameId !== 'string') {
    return false;
  }
  return state.favorites.includes(gameId.trim());
}

export function setFavorites(list) {
  return setState(current => ({
    ...current,
    favorites: sanitizeFavorites(typeof list === 'function' ? list([...current.favorites]) : list),
  }));
}

export function addFavorite(gameId) {
  if (typeof gameId !== 'string' || !gameId.trim()) {
    return getState();
  }
  const id = gameId.trim();
  if (state.favorites.includes(id)) {
    return getState();
  }
  return setFavorites(favorites => {
    favorites.push(id);
    return favorites;
  });
}

export function removeFavorite(gameId) {
  if (typeof gameId !== 'string' || !gameId.trim()) {
    return getState();
  }
  const id = gameId.trim();
  return setFavorites(favorites => favorites.filter(item => item !== id));
}

export function toggleFavorite(gameId) {
  if (typeof gameId !== 'string' || !gameId.trim()) {
    return getState();
  }
  const id = gameId.trim();
  if (state.favorites.includes(id)) {
    return removeFavorite(id);
  }
  return addFavorite(id);
}

export { ALLOWED_DIFFICULTIES };
