// shared/juice/audio.js
const AudioCtor = typeof Audio !== 'undefined' ? Audio : null;

const AUDIO_SOURCES = {
  hit: '/assets/audio/hit.wav',
  explode: '/assets/audio/explode.wav',
  power: '/assets/audio/powerup.wav',
  click: '/assets/audio/click.wav',
  jump: '/assets/audio/jump.wav',
  coin: '/assets/audio/coin.wav',
  powerdown: '/assets/audio/powerdown.wav',
};

const cache = Object.create(null);
const pendingPlays = [];

let muted = false;
let paused = false;
let masterVolume = 1;

const audioUnsupportedByEnv = (() => {
  if (!AudioCtor) return true;
  const ua = typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
    ? navigator.userAgent
    : '';
  if (ua && /jsdom/i.test(ua)) return true;
  return false;
})();

let audioDisabled = audioUnsupportedByEnv;
let unlocked = typeof document === 'undefined' || audioDisabled;
let unlockRequested = false;

function isUnsupportedError(error) {
  if (!error || typeof error.message !== 'string') return false;
  return /Not implemented: HTMLMediaElement\.prototype\./.test(error.message);
}

function clampVolume(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function ensureAudio(name) {
  if (cache[name]) return cache[name];
  const src = AUDIO_SOURCES[name];
  if (!src || !AudioCtor || audioDisabled) return null;
  try {
    const audio = new AudioCtor(src);
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    try {
      if (typeof audio.load === 'function') {
        audio.load();
      }
    } catch (error) {
      if (isUnsupportedError(error)) {
        audioDisabled = true;
        cache[name] = null;
        return null;
      }
    }
    cache[name] = audio;
    return audio;
  } catch (err) {
    if (isUnsupportedError(err)) {
      audioDisabled = true;
    }
    cache[name] = null;
    return null;
  }
}

function preload(names) {
  if (!AudioCtor || audioDisabled) return;
  const list = Array.isArray(names) && names.length ? names : Object.keys(AUDIO_SOURCES);
  for (const name of list) ensureAudio(name);
}

function stopAll() {
  if (!AudioCtor || audioDisabled) return;
  for (const audio of Object.values(cache)) {
    if (!(audio instanceof AudioCtor)) continue;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (error) {
      if (isUnsupportedError(error)) {
        audioDisabled = true;
        return;
      }
    }
  }
}

function performPlay(audio, options) {
  if (!AudioCtor || !(audio instanceof AudioCtor)) return false;
  const baseVolume = typeof options.volume === 'number'
    ? clampVolume(options.volume)
    : 1;
  audio.__ggBaseVolume = baseVolume;
  audio.volume = clampVolume(baseVolume * masterVolume);
  if (options.restart !== false) {
    try { audio.currentTime = 0; } catch (_) {}
  }
  try {
    const promise = audio.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {});
    }
    return true;
  } catch (_) {
    return false;
  }
}

function internalPlay(name, options) {
  if (muted) return false;
  if (paused && !options.allowWhilePaused) return false;
  const audio = ensureAudio(name);
  if (!audio) return false;
  return performPlay(audio, options);
}

function flushQueue() {
  if (!unlocked || !pendingPlays.length) return;
  const queued = pendingPlays.splice(0, pendingPlays.length);
  for (const entry of queued) {
    internalPlay(entry.name, entry.options);
  }
}

function unlock() {
  if (unlocked) return;
  unlocked = true;
  flushQueue();
}

function requestUnlock() {
  if (audioDisabled || unlocked || unlockRequested || typeof document === 'undefined') return;
  unlockRequested = true;
  const finish = () => {
    document.removeEventListener('pointerdown', finish, true);
    document.removeEventListener('keydown', finish, true);
    unlock();
  };
  document.addEventListener('pointerdown', finish, { once: true, capture: true });
  document.addEventListener('keydown', finish, { once: true, capture: true });
}

function play(name, opts = {}) {
  const options = {
    allowWhilePaused: !!opts.allowWhilePaused,
    restart: opts.restart !== false,
  };
  if (typeof opts.volume === 'number') options.volume = clampVolume(opts.volume);
  if (muted) return false;
  if (paused && !options.allowWhilePaused) return false;
  if (audioDisabled) return false;
  if (!unlocked) {
    requestUnlock();
    pendingPlays.push({ name, options });
    return false;
  }
  return internalPlay(name, options);
}

function setMuted(value) {
  const next = !!value;
  if (next === muted) return;
  muted = next;
  if (muted) stopAll();
}

function setPaused(value) {
  const next = !!value;
  if (next === paused) return;
  paused = next;
  if (paused) stopAll();
}

function setVolume(value) {
  const next = clampVolume(value);
  if (next === masterVolume) return;
  masterVolume = next;
  if (!AudioCtor || audioDisabled) return;
  for (const audio of Object.values(cache)) {
    if (!(audio instanceof AudioCtor)) continue;
    const base = typeof audio.__ggBaseVolume === 'number' ? audio.__ggBaseVolume : 1;
    audio.volume = clampVolume(base * masterVolume);
  }
}

function getVolume() {
  return masterVolume;
}

function isMuted() {
  return muted;
}

function isPaused() {
  return paused;
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', event => {
    const data = event && typeof event.data === 'object' ? event.data : null;
    if (!data) return;
    if (data.type === 'GG_SET_MUTE') setMuted(!!data.value);
    if (data.type === 'GG_PAUSE') setPaused(true);
    if (data.type === 'GG_RESUME') setPaused(false);
  }, { passive: true });
  window.addEventListener('ggshell:pause', () => setPaused(true));
  window.addEventListener('ggshell:resume', () => setPaused(false));
  window.addEventListener('ggshell:mute', () => setMuted(true));
  window.addEventListener('ggshell:unmute', () => setMuted(false));
}

preload();
requestUnlock();

export const SFX = cache;
export {
  preload,
  play,
  stopAll,
  setMuted,
  setPaused,
  setVolume,
  getVolume,
  isMuted,
  isPaused,
  unlock,
};
