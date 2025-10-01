import { getActiveQuests, getXP, QUESTS_UPDATED_EVENT } from './quests.js';

const DEFAULT_OPTIONS = {
  headingLevel: 2,
  regionLabel: 'Quest progress'
};

function createHeading(level, text){
  const safeLevel = Math.min(6, Math.max(1, Number(level) || 2));
  const el = document.createElement(`h${safeLevel}`);
  el.textContent = text;
  return el;
}

function createGroup(title){
  const container = document.createElement('section');
  container.className = 'quest-widget-group';
  const heading = createHeading(3, title);
  heading.classList.add('quest-widget-subheading');
  container.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'quest-widget-list';
  list.setAttribute('role', 'list');
  container.appendChild(list);

  return { container, list };
}

function renderList(listEl, quests, emptyLabel){
  listEl.innerHTML = '';
  if (!quests?.length){
    const empty = document.createElement('li');
    empty.className = 'quest-widget-item quest-widget-empty';
    empty.tabIndex = 0;
    empty.textContent = emptyLabel;
    listEl.appendChild(empty);
    return;
  }

  quests.forEach(quest => {
    const item = document.createElement('li');
    item.className = 'quest-widget-item';
    item.tabIndex = 0;

    if (quest.completed) item.classList.add('is-complete');

    const row = document.createElement('div');
    row.className = 'quest-widget-row';
    const label = document.createElement('span');
    label.className = 'quest-widget-label';
    label.textContent = quest.description;
    row.appendChild(label);

    const xp = document.createElement('span');
    xp.className = 'quest-widget-xp';
    xp.textContent = `+${quest.xp} XP`;
    row.appendChild(xp);
    item.appendChild(row);

    const progress = document.createElement('div');
    progress.className = 'quest-widget-progress';
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', String(quest.goal));
    const current = Math.min(quest.progress || 0, quest.goal);
    progress.setAttribute('aria-valuenow', String(current));
    progress.setAttribute('aria-label', `${quest.description} (${current} of ${quest.goal})`);

    const fill = document.createElement('div');
    fill.className = 'quest-widget-progress-fill';
    const pct = quest.goal > 0 ? Math.min(100, (current / quest.goal) * 100) : 0;
    fill.style.width = `${pct}%`;
    progress.appendChild(fill);
    item.appendChild(progress);

    const status = document.createElement('div');
    status.className = 'quest-widget-status';
    status.textContent = quest.completed ? 'Completed' : `${current} / ${quest.goal}`;
    item.appendChild(status);

    listEl.appendChild(item);
  });
}

export function mountQuestWidget(root, options = {}){
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (!root) return null;

  root.classList.add('quest-widget');

  const panel = document.createElement('section');
  panel.className = 'quest-widget-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-label', opts.regionLabel);

  const heading = createHeading(opts.headingLevel, 'Quests');
  heading.classList.add('quest-widget-heading');
  panel.appendChild(heading);

  const xpLine = document.createElement('p');
  xpLine.className = 'quest-widget-xp-total';
  panel.appendChild(xpLine);

  const daily = createGroup('Daily quests');
  const weekly = createGroup('Weekly quest');
  panel.appendChild(daily.container);
  panel.appendChild(weekly.container);

  const refreshNote = document.createElement('p');
  refreshNote.className = 'quest-widget-note';
  refreshNote.textContent = 'Daily quests reset at 00:00 UTC. Weekly quests reset every Monday (UTC).';
  panel.appendChild(refreshNote);

  root.appendChild(panel);

  function render(detail){
    const data = detail && typeof detail === 'object' ? detail : null;
    const quests = data?.daily && data?.weekly ? data : getActiveQuests();
    const xp = typeof data?.xp === 'number' ? data.xp : getXP();

    xpLine.textContent = `Total XP: ${xp.toLocaleString()}`;
    renderList(daily.list, quests.daily, 'No daily quests right now. Check back soon!');
    renderList(weekly.list, quests.weekly, 'No weekly quest available.');
  }

  render();

  const onUpdate = (event) => {
    render(event?.detail);
  };

  window.addEventListener(QUESTS_UPDATED_EVENT, onUpdate);

  return {
    destroy(){
      window.removeEventListener(QUESTS_UPDATED_EVENT, onUpdate);
      root.innerHTML = '';
    }
  };
}

export default { mountQuestWidget };
