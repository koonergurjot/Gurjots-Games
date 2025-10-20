const powerNodes = new Map();
const numberFormatter = typeof Intl !== 'undefined' ? new Intl.NumberFormat('en-US') : null;

const state = {
  root: null,
  statusNodes: null,
  powerList: null,
  missionList: null,
  powerPlaceholder: null,
};

function formatInteger(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return numberFormatter ? numberFormatter.format(Math.round(safe)) : String(Math.round(safe));
}

function formatTime(value) {
  if (!Number.isFinite(value)) return '0.0s';
  return `${Math.max(0, value).toFixed(1)}s`;
}

function formatPowerupLabel(entry) {
  if (!entry) return 'Power-up';
  const label = typeof entry.label === 'string' && entry.label.trim().length
    ? entry.label.trim()
    : (entry.id || 'Power-up');
  const remaining = Number(entry.remaining);
  const duration = Number(entry.duration);
  if (duration > 0) {
    const seconds = Math.max(0, remaining);
    return `${label} — ${seconds.toFixed(1)}s`;
  }
  return label;
}

function formatMissionText(mission) {
  if (!mission) return '';
  const label = typeof mission.label === 'string' && mission.label.trim().length
    ? mission.label.trim()
    : (mission.id || 'Mission');
  if (mission.complete) {
    return `${label} — Complete`;
  }
  const target = Number(mission.target);
  const progress = Number.isFinite(mission.progress) ? Math.max(0, mission.progress) : 0;
  if (!(target > 0)) {
    return `${label} — Ready`;
  }
  const clamped = Math.min(target, progress);
  const unit = typeof mission.unit === 'string' ? mission.unit : '';
  if (unit.trim() === 's') {
    return `${label} — ${clamped.toFixed(1)}/${target}${unit}`;
  }
  return `${label} — ${Math.round(clamped)}/${target}${unit}`;
}

function resolveHudContainer() {
  if (state.root && state.root.isConnected) {
    return state.root;
  }
  const surface = document.querySelector('.game-shell__surface');
  const host = surface?.parentElement || document.body;
  let existing = host?.querySelector?.('[data-breakout-hud]') || null;
  if (!existing) {
    existing = document.createElement('aside');
    existing.className = 'hud hud--breakout';
    existing.dataset.breakoutHud = 'true';
    existing.innerHTML = `
      <div class="hud-panel hud-panel--status">
        <div class="hud-panel__header">
          <h2 class="hud-panel__title">Status</h2>
          <p class="hud-panel__subtitle">Clear every brick • Catch capsules for boosts • P to pause</p>
        </div>
        <div class="hud-panel__body">
          <dl class="hud-stats">
            <div class="hud-stats__row"><dt>Score</dt><dd data-hud-score>0</dd></div>
            <div class="hud-stats__row"><dt>Lives</dt><dd data-hud-lives>3</dd></div>
            <div class="hud-stats__row"><dt>Level</dt><dd data-hud-level>1</dd></div>
            <div class="hud-stats__row"><dt>Run Time</dt><dd data-hud-time>0.0s</dd></div>
          </dl>
        </div>
      </div>
      <div class="hud-panel hud-panel--powerups">
        <div class="hud-panel__header">
          <h2 class="hud-panel__title">Power-ups</h2>
        </div>
        <div class="hud-panel__body">
          <ul class="hud-missionList" data-hud-powerups aria-live="polite">
            <li class="hud-missionList__item hud-missionList__item--empty" data-placeholder>
              Catch a falling capsule to trigger a temporary boost.
            </li>
          </ul>
        </div>
      </div>
      <div class="hud-panel hud-panel--missions">
        <div class="hud-panel__header">
          <h2 class="hud-panel__title">Missions</h2>
        </div>
        <div class="hud-panel__body">
          <ul class="hud-missionList" data-hud-missions aria-live="polite"></ul>
        </div>
      </div>
    `;
    if (surface && surface.parentElement) {
      surface.parentElement.appendChild(existing);
    } else {
      host?.appendChild(existing);
    }
  }
  state.root = existing;
  state.statusNodes = {
    score: existing.querySelector('[data-hud-score]'),
    lives: existing.querySelector('[data-hud-lives]'),
    level: existing.querySelector('[data-hud-level]'),
    time: existing.querySelector('[data-hud-time]'),
  };
  state.powerList = existing.querySelector('[data-hud-powerups]');
  state.powerPlaceholder = state.powerList?.querySelector('[data-placeholder]') || null;
  state.missionList = existing.querySelector('[data-hud-missions]');
  return existing;
}

export function initHud() {
  resolveHudContainer();
}

export function updateHudStatus({ score = 0, lives = 0, level = 1, time = 0 } = {}) {
  resolveHudContainer();
  if (!state.statusNodes) return;
  if (state.statusNodes.score) state.statusNodes.score.textContent = formatInteger(score);
  if (state.statusNodes.lives) state.statusNodes.lives.textContent = formatInteger(lives);
  if (state.statusNodes.level) state.statusNodes.level.textContent = formatInteger(level);
  if (state.statusNodes.time) state.statusNodes.time.textContent = formatTime(time);
}

export function updateHudPowerups(powerups = []) {
  resolveHudContainer();
  if (!state.powerList) return;
  const activeIds = new Set();
  for (const entry of powerups) {
    if (!entry) continue;
    const id = entry.id || entry.label;
    if (!id) continue;
    activeIds.add(id);
    let node = powerNodes.get(id);
    if (!node) {
      node = document.createElement('li');
      node.className = 'hud-missionList__item';
      node.setAttribute('data-powerup-id', id);
      powerNodes.set(id, node);
      state.powerList.appendChild(node);
    }
    node.textContent = formatPowerupLabel(entry);
  }
  for (const [id, node] of powerNodes.entries()) {
    if (!activeIds.has(id)) {
      node.remove();
      powerNodes.delete(id);
    }
  }
  if (state.powerPlaceholder) {
    state.powerPlaceholder.hidden = activeIds.size > 0;
  }
}

export function updateMissionHud(missions = []) {
  resolveHudContainer();
  if (!state.missionList) return;
  state.missionList.innerHTML = '';
  for (const mission of missions) {
    const node = document.createElement('li');
    node.className = 'hud-missionList__item';
    if (mission?.complete) {
      node.classList.add('is-complete');
    }
    node.textContent = formatMissionText(mission);
    node.setAttribute('data-mission-id', mission?.id || 'mission');
    state.missionList.appendChild(node);
  }
}

export default {
  initHud,
  updateHudStatus,
  updateHudPowerups,
  updateMissionHud,
};
