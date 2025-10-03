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
let unlocked = typeof document === 'undefined';
let unlockRequested = false;

function clampVolume(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function ensureAudio(name) {
  if (cache[name]) return cache[name];
  const src = AUDIO_SOURCES[name];
  if (!src || !AudioCtor) return null;
  try {
    const audio = new AudioCtor(src);
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    try { audio.load(); } catch (_) {}
    cache[name] = audio;
    return audio;
  } catch (err) {
    cache[name] = null;
    return null;
  }
}

function preload(names) {
  const list = Array.isArray(names) && names.length ? names : Object.keys(AUDIO_SOURCES);
  for (const name of list) ensureAudio(name);
}

function stopAll() {
  if (!AudioCtor) return;
  for (const audio of Object.values(cache)) {
    if (!(audio instanceof AudioCtor)) continue;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (_) {}
  }
}

function performPlay(audio, options) {
  if (!AudioCtor || !(audio instanceof AudioCtor)) return false;
  if (typeof options.volume === 'number') {
    audio.volume = clampVolume(options.volume);
  }
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
  if (unlocked || unlockRequested || typeof document === 'undefined') return;
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
export { preload, play, stopAll, setMuted, setPaused, isMuted, isPaused, unlock };
