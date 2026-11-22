// Settings page: reads and writes shared/prefs.js, exports and erases locally saved data.
import { getPrefs, setPref, resetPrefs } from '../shared/prefs.js';
import { mountChrome } from './site-chrome.js';

mountChrome('settings');

const $ = sel => document.querySelector(sel);
const status = $('#status');

// Everything the arcade stores on this device. Keys are matched by prefix so new
// games and features that follow the same naming are covered automatically.
const OWN_KEYS = ['lastPlayed', 'profile', 'profiles', 'seenHints', 'skin:current', 'skin:unlocks', 'theme', 'lang'];
const OWN_PREFIXES = ['gg:', 'gg.', 'achievements:', 'achstats:', 'plays:', 'profile:', 'leaderboard:', 'bestScore:', 'missions', 'tetris:', 'runner:', 'chess3d.', 'snake:', 'pong:'];
// Settings-like keys are exported but kept when erasing progress.
const KEEP_ON_ERASE = ['gg:prefs', 'theme', 'lang', 'skin:current'];

function ownedKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (OWN_KEYS.includes(k) || OWN_PREFIXES.some(p => k.startsWith(p))) keys.push(k);
    }
  } catch { /* storage blocked */ }
  return keys;
}

function say(msg, isError = false) {
  if (!status) return;
  status.textContent = msg;
  status.classList.toggle('is-error', isError);
}

function paint() {
  const p = getPrefs();
  $('#pref-sound').checked = p.sound;
  $('#pref-volume').value = String(Math.round(p.volume * 100));
  $('#pref-volume').disabled = !p.sound;
  $('#pref-volume-out').textContent = `${Math.round(p.volume * 100)}%`;
  for (const name of ['motion', 'contrast', 'textSize']) {
    const radio = document.querySelector(`input[name="${name}"][value="${p[name]}"]`);
    if (radio) radio.checked = true;
  }
}

$('#pref-sound').addEventListener('change', e => { setPref('sound', e.target.checked); paint(); say(e.target.checked ? 'Sound is on.' : 'Sound is off.'); });
$('#pref-volume').addEventListener('input', e => { setPref('volume', Number(e.target.value) / 100); $('#pref-volume-out').textContent = `${e.target.value}%`; });

document.querySelectorAll('input[type="radio"]').forEach(r => {
  r.addEventListener('change', () => { if (r.checked) { setPref(r.name, r.value); say('Saved.'); } });
});

$('#test-sound').addEventListener('click', () => {
  const p = getPrefs();
  if (!p.sound || p.volume === 0) { say('Turn sound on and raise the volume to hear the test.', true); return; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.18 * p.volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.27);
    osc.onended = () => ctx.close();
    say('Test sound played.');
  } catch {
    say('This browser could not play the test sound.', true);
  }
});

$('#reset-prefs').addEventListener('click', () => { resetPrefs(); paint(); say('Settings restored to their defaults.'); });

$('#export-data').addEventListener('click', () => {
  const data = {};
  for (const k of ownedKeys()) {
    try { data[k] = localStorage.getItem(k); } catch { /* skip unreadable key */ }
  }
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), site: location.origin, data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gurjots-games-data.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say(`Downloaded ${Object.keys(data).length} saved items.`);
});

const confirmBox = $('#erase-confirm');
$('#erase-start').addEventListener('click', () => { confirmBox.hidden = false; $('#erase-no').focus(); });
$('#erase-no').addEventListener('click', () => { confirmBox.hidden = true; $('#erase-start').focus(); say('Nothing was erased.'); });
$('#erase-yes').addEventListener('click', () => {
  const keys = ownedKeys().filter(k => !KEEP_ON_ERASE.includes(k));
  keys.forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  confirmBox.hidden = true;
  say(`Erased ${keys.length} saved items from this device.`);
  $('#erase-start').focus();
});

paint();
