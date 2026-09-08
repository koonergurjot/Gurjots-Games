// The briefing card and objective HUD.
//
// A premise nobody reads is not a premise, so it appears once per game per
// device on first visit, and stays reachable from a small chip afterwards.

import { OBJECTIVE_EVENT, getBriefing, getProgress } from './objectives.js';

const SEEN_KEY = 'gg:briefed';
const STYLE_ID = 'gg-brief-style';

const CSS = `
.gg-brief-chip {
  position: fixed;
  right: 16px;
  top: 16px;
  z-index: 61;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 13px;
  border-radius: 999px;
  border: 1px solid rgba(126, 224, 192, 0.3);
  background: rgba(10, 14, 24, 0.84);
  color: #dfe6f5;
  font: 600 12px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  cursor: pointer;
  backdrop-filter: blur(6px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.gg-brief-chip:hover, .gg-brief-chip:focus-visible {
  border-color: rgba(126, 224, 192, 0.7);
  outline: none;
}
.gg-brief-chip__count { color: #7ee0c0; font-variant-numeric: tabular-nums; }

.gg-brief-back {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(4, 8, 16, 0.72);
  backdrop-filter: blur(5px);
}
.gg-brief-back[hidden] { display: none !important; }

.gg-brief {
  width: min(30rem, 100%);
  max-height: min(88vh, 40rem);
  overflow-y: auto;
  padding: 26px 26px 20px;
  border-radius: 18px;
  border: 1px solid rgba(126, 224, 192, 0.22);
  background: linear-gradient(165deg, #121a2b, #0b1120);
  color: #e9eefb;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  font: 400 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.gg-brief__kicker {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #7ee0c0;
}
.gg-brief__title { margin: 0 0 12px; font-size: 25px; line-height: 1.15; }
.gg-brief__premise {
  margin: 0 0 20px;
  padding-left: 12px;
  border-left: 2px solid rgba(126, 224, 192, 0.4);
  color: #b9c4dc;
  font-style: italic;
}
.gg-brief__h { margin: 0 0 10px; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #8fa0c4; }
.gg-brief__list { list-style: none; margin: 0 0 20px; padding: 0; display: grid; gap: 8px; }
.gg-brief__item {
  display: grid;
  grid-template-columns: 20px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.gg-brief__item[data-done="true"] { border-color: rgba(126, 224, 192, 0.4); }
.gg-brief__item[data-done="true"] .gg-brief__label { color: #7ee0c0; }
.gg-brief__tick { color: #7ee0c0; }
.gg-brief__num { color: #8fa0c4; font-size: 12px; font-variant-numeric: tabular-nums; }
.gg-brief__btn {
  width: 100%;
  padding: 11px;
  border-radius: 10px;
  border: 0;
  background: linear-gradient(120deg, #3b82f6, #6366f1);
  color: #fff;
  font: 700 14px system-ui, sans-serif;
  cursor: pointer;
}
.gg-brief__btn:hover { filter: brightness(1.08); }

.gg-obj-toast {
  position: fixed;
  right: 16px;
  top: 62px;
  z-index: 62;
  padding: 9px 15px;
  border-radius: 999px;
  background: linear-gradient(120deg, #059669, #0d9488);
  color: #fff;
  font: 700 12px system-ui, sans-serif;
  box-shadow: 0 10px 28px rgba(5, 150, 105, 0.45);
  animation: gg-obj-in 2600ms ease forwards;
}
@keyframes gg-obj-in {
  0% { opacity: 0; transform: translateX(14px); }
  10%, 80% { opacity: 1; transform: none; }
  100% { opacity: 0; transform: translateX(14px); }
}
@media (max-width: 600px) {
  .gg-brief-chip { right: 10px; top: 10px; padding: 6px 10px; font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) {
  .gg-obj-toast { animation-duration: 2000ms; }
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

function seen(slug) {
  try {
    return (JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') || []).includes(slug);
  } catch {
    return false;
  }
}

function markSeen(slug) {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') || [];
    if (!list.includes(slug)) list.push(slug);
    localStorage.setItem(SEEN_KEY, JSON.stringify(list));
  } catch {}
}

export function mountObjectives(slug) {
  if (typeof document === 'undefined' || !document.body) return null;
  const briefing = getBriefing(slug);
  if (!briefing) return null;
  ensureStyle();

  const backdrop = document.createElement('div');
  backdrop.className = 'gg-brief-back';
  backdrop.hidden = true;

  const card = document.createElement('div');
  card.className = 'gg-brief';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', `${briefing.title} briefing`);

  const list = document.createElement('ul');
  list.className = 'gg-brief__list';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gg-brief__btn';
  button.textContent = 'Start playing';

  card.innerHTML =
    `<p class="gg-brief__kicker">Briefing</p>` +
    `<h2 class="gg-brief__title"></h2>` +
    `<p class="gg-brief__premise"></p>` +
    `<p class="gg-brief__h">Objectives</p>`;
  card.querySelector('.gg-brief__title').textContent = briefing.title;
  card.querySelector('.gg-brief__premise').textContent = briefing.premise;
  card.append(list, button);
  backdrop.append(card);

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'gg-brief-chip';
  chip.innerHTML = `<span aria-hidden="true">🎯</span><span class="gg-brief__label">Objectives</span><span class="gg-brief-chip__count"></span>`;
  const chipCount = chip.querySelector('.gg-brief-chip__count');

  function renderList() {
    const progress = getProgress(slug);
    list.replaceChildren(...progress.map((objective) => {
      const item = document.createElement('li');
      item.className = 'gg-brief__item';
      item.dataset.done = String(objective.done);
      const tick = document.createElement('span');
      tick.className = 'gg-brief__tick';
      tick.textContent = objective.done ? '✓' : '○';
      const label = document.createElement('span');
      label.className = 'gg-brief__label';
      label.textContent = objective.label;
      const num = document.createElement('span');
      num.className = 'gg-brief__num';
      num.textContent = objective.done ? 'Done' : `${objective.have}/${objective.goal}`;
      item.append(tick, label, num);
      return item;
    }));
    const done = progress.filter((o) => o.done).length;
    chipCount.textContent = `${done}/${progress.length}`;
  }

  const open = () => { renderList(); backdrop.hidden = false; button.focus(); };
  const close = () => { backdrop.hidden = true; markSeen(slug); };

  button.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop.hidden) close(); });
  chip.addEventListener('click', open);

  window.addEventListener(OBJECTIVE_EVENT, (event) => {
    renderList();
    const objective = event?.detail?.objective;
    if (!objective || event.detail.slug !== slug) return;
    const toast = document.createElement('div');
    toast.className = 'gg-obj-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = `Objective complete — ${objective.label}`;
    document.body.append(toast);
    setTimeout(() => toast.remove(), 2700);
  });

  document.body.append(backdrop, chip);
  renderList();
  // First visit gets the premise unprompted; after that it is opt-in.
  if (!seen(slug)) setTimeout(open, 700);
  return { open, close };
}

export default mountObjectives;
