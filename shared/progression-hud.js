// In-game progression readout: a small badge showing level and XP progress that
// reacts when either changes. Progression the player cannot see is not
// progression, and every game already loads the shell, so this rides along with
// it rather than asking each game to build its own.

import { PROGRESSION_EVENT, getState } from './progression.js';

const STYLE_ID = 'gg-progression-style';

const CSS = `
.gg-prog {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px 8px 10px;
  border-radius: 999px;
  background: rgba(10, 14, 24, 0.82);
  border: 1px solid rgba(120, 160, 255, 0.25);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  color: #e8ecf7;
  font: 600 12px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  backdrop-filter: blur(6px);
  pointer-events: none;
  transition: transform 220ms ease, border-color 220ms ease;
}
.gg-prog__level {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: linear-gradient(150deg, #3b82f6, #6366f1);
  font-size: 12px;
  color: #fff;
}
.gg-prog__meter {
  width: 88px;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  overflow: hidden;
}
.gg-prog__fill {
  display: block;
  height: 100%;
  width: 0%;
  border-radius: inherit;
  background: linear-gradient(90deg, #38bdf8, #a855f7);
  transition: width 320ms ease;
}
.gg-prog__text { opacity: 0.78; font-weight: 500; }
.gg-prog.is-levelling {
  transform: scale(1.06);
  border-color: rgba(168, 85, 247, 0.75);
}
.gg-prog__pop {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 6px 12px;
  border-radius: 999px;
  background: linear-gradient(120deg, #6366f1, #a855f7);
  color: #fff;
  font-weight: 700;
  box-shadow: 0 8px 24px rgba(88, 28, 235, 0.5);
  animation: gg-prog-pop 1800ms ease forwards;
}
@keyframes gg-prog-pop {
  0% { opacity: 0; transform: translate(-50%, 6px); }
  15% { opacity: 1; transform: translate(-50%, 0); }
  75% { opacity: 1; transform: translate(-50%, 0); }
  100% { opacity: 0; transform: translate(-50%, -8px); }
}
@media (prefers-reduced-motion: reduce) {
  .gg-prog, .gg-prog__fill { transition: none; }
  .gg-prog__pop { animation-duration: 1200ms; }
}
@media (max-width: 600px) {
  .gg-prog { left: 10px; bottom: 10px; padding: 6px 10px 6px 8px; }
  .gg-prog__meter { width: 60px; }
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

let badge = null;
let fill = null;
let levelEl = null;
let textEl = null;

function ensureBadge() {
  if (badge?.isConnected) return badge;
  ensureStyle();
  badge = document.createElement('div');
  badge.className = 'gg-prog';
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite');

  levelEl = document.createElement('span');
  levelEl.className = 'gg-prog__level';

  const meter = document.createElement('span');
  meter.className = 'gg-prog__meter';
  fill = document.createElement('span');
  fill.className = 'gg-prog__fill';
  meter.appendChild(fill);

  textEl = document.createElement('span');
  textEl.className = 'gg-prog__text';

  badge.append(levelEl, meter, textEl);
  document.body.appendChild(badge);
  return badge;
}

function render(state) {
  ensureBadge();
  levelEl.textContent = String(state.level);
  fill.style.width = `${Math.round(state.ratio * 100)}%`;
  textEl.textContent = `${Math.round(state.into)}/${Math.round(state.needed)} XP`;
  badge.setAttribute('aria-label', `Level ${state.level}, ${Math.round(state.remaining)} XP to next level`);
}

function pop(message) {
  ensureBadge();
  const el = document.createElement('span');
  el.className = 'gg-prog__pop';
  el.textContent = message;
  badge.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

function onProgress(event) {
  const detail = event?.detail;
  if (!detail) return;
  render(detail);
  if (detail.levelsGained > 0) {
    badge.classList.add('is-levelling');
    setTimeout(() => badge.classList.remove('is-levelling'), 700);
    pop(`Level ${detail.level}!`);
    detail.unlocked?.forEach((unlock, i) => {
      setTimeout(() => pop(`Unlocked: ${unlock.title}`), 1900 * (i + 1));
    });
  } else if (detail.reason === 'personal_best') {
    pop(`Personal best! +${detail.gained} XP`);
  }
}

export function mountProgressionHud() {
  if (typeof document === 'undefined' || !document.body) return null;
  render(getState());
  window.addEventListener(PROGRESSION_EVENT, onProgress);
  // Games that still award XP through the legacy GG.addXP helper write the same
  // record without going through awardXp, so re-read rather than drift.
  window.addEventListener('gg:stats-written', () => render(getState()));
  return badge;
}

export default mountProgressionHud;
