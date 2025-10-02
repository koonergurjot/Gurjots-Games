import {
  getProfile,
  getAggregatedStats,
  login,
  listProfiles,
  removeProfile,
  PROFILE_EVENT
} from '../shared/profile.js';
import { getAchievements } from '../shared/achievements.js';
import { getActiveQuests, getXP, QUESTS_UPDATED_EVENT } from '../shared/quests.js';
import { getLastPlayed } from '../shared/ui.js';

const trigger = document.querySelector('[data-profile-trigger]');
if (trigger) {
  const nameNode = trigger.querySelector('[data-profile-name]');
  const avatarNode = trigger.querySelector('[data-profile-avatar]');

  let overlay = null;
  let dialog = null;
  let lastFocused = null;
  let catalogPromise = null;
  let catalogTitles = new Map();

  const selectors = {
    list: '[data-profile-list]',
    metrics: '[data-profile-metrics]',
    quests: '[data-profile-quests]',
    history: '[data-profile-history]',
    add: '[data-add-profile]'
  };

  function setAvatarVisual(node, profile) {
    if (!node || !profile) return;
    const name = profile.name || 'Guest';
    const avatar = profile.avatar || '';
    node.textContent = '';
    node.classList.remove('has-image');
    node.style.removeProperty('background-image');

    if (avatar) {
      node.classList.add('has-image');
      node.style.backgroundImage = `url("${avatar}")`;
    } else {
      const initial = name.trim().charAt(0) || 'G';
      node.textContent = initial.toUpperCase();
    }
  }

  function updateTrigger(profile = getProfile()) {
    if (avatarNode) {
      setAvatarVisual(avatarNode, profile);
    }
    if (nameNode) {
      nameNode.textContent = profile.name || 'Guest';
    }
    trigger.setAttribute('aria-label', `Open profile overlay for ${profile.name || 'Guest'}`);
  }

  function createOverlay() {
    const wrapper = document.createElement('div');
    wrapper.className = 'profile-overlay';
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.innerHTML = `
      <div class="profile-overlay-backdrop" data-close></div>
      <div class="profile-overlay-dialog" role="dialog" aria-modal="true" aria-labelledby="profileOverlayTitle" tabindex="-1">
        <div class="profile-overlay-header">
          <h2 id="profileOverlayTitle">Player profile</h2>
          <button type="button" class="profile-overlay-close" data-close aria-label="Close profile overlay">×</button>
        </div>
        <section class="profile-section">
          <div class="profile-switch-header">
            <h3>Switch profile</h3>
            <button type="button" class="profile-add-btn" data-add-profile>Add profile</button>
          </div>
          <ul class="profile-switch-list" data-profile-list role="list"></ul>
        </section>
        <section class="profile-section">
          <h3>Metrics</h3>
          <div class="profile-metrics-grid" data-profile-metrics></div>
        </section>
        <section class="profile-section">
          <h3>Quest progress</h3>
          <div class="profile-quests-group" data-profile-quests></div>
        </section>
        <section class="profile-section">
          <h3>Recent history</h3>
          <ul class="profile-history-list" data-profile-history role="list"></ul>
        </section>
      </div>
    `;
    document.body.appendChild(wrapper);
    return wrapper;
  }

  function ensureOverlay() {
    if (!overlay) {
      overlay = createOverlay();
      dialog = overlay.querySelector('.profile-overlay-dialog');
      overlay.addEventListener('click', onOverlayClick);
    }
    if (!dialog) {
      dialog = overlay.querySelector('.profile-overlay-dialog');
    }
    return overlay;
  }

  function renderSwitchList(profiles = listProfiles()) {
    const root = overlay.querySelector(selectors.list);
    if (!root) return;
    root.innerHTML = '';
    const current = getProfile();
    if (!profiles.length) {
      const empty = document.createElement('li');
      empty.className = 'profile-empty';
      empty.textContent = 'No profiles yet. Add a profile to get started.';
      root.appendChild(empty);
      return;
    }

    profiles.forEach(profile => {
      const item = document.createElement('li');
      item.className = 'profile-switch-item';
      if (profile.name === current.name) {
        item.classList.add('is-active');
      }

      const mainBtn = document.createElement('button');
      mainBtn.type = 'button';
      mainBtn.className = 'profile-switch-main';
      mainBtn.dataset.switch = profile.name;

      const avatar = document.createElement('span');
      avatar.className = 'profile-switch-avatar';
      setAvatarVisual(avatar, profile);
      mainBtn.appendChild(avatar);

      const textWrap = document.createElement('span');
      textWrap.className = 'profile-switch-text';
      const name = document.createElement('span');
      name.className = 'profile-switch-name';
      name.textContent = profile.name;
      const meta = document.createElement('span');
      meta.className = 'profile-switch-meta';
      meta.textContent = profile.name === current.name ? 'Active profile' : 'Switch to profile';
      textWrap.appendChild(name);
      textWrap.appendChild(meta);

      mainBtn.appendChild(textWrap);
      item.appendChild(mainBtn);

      const canRemove = profile.name !== current.name && profile.name.toLowerCase() !== 'guest';
      if (canRemove) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'profile-remove-btn';
        removeBtn.dataset.remove = profile.name;
        removeBtn.textContent = 'Remove';
        item.appendChild(removeBtn);
      }

      root.appendChild(item);
    });
  }

  function renderMetrics() {
    const container = overlay.querySelector(selectors.metrics);
    if (!container) return;
    const stats = getAggregatedStats();
    const unlocked = stats.achievements || [];
    const achievements = getAchievements().filter(a => a.unlocked).slice(0, 3);
    const questXP = getXP();
    container.innerHTML = `
      <div class="profile-metric">
        <span class="profile-metric-label">Lifetime XP</span>
        <span class="profile-metric-value">${Number(stats.xp || 0).toLocaleString()}</span>
      </div>
      <div class="profile-metric">
        <span class="profile-metric-label">Total plays</span>
        <span class="profile-metric-value">${Number(stats.plays || 0).toLocaleString()}</span>
      </div>
      <div class="profile-metric">
        <span class="profile-metric-label">Achievements</span>
        <span class="profile-metric-value">${unlocked.length}</span>
        ${achievements.length ? `<p class="profile-metric-note">Recent: ${achievements.map(a => a.title).join(', ')}</p>` : ''}
      </div>
      <div class="profile-metric">
        <span class="profile-metric-label">Quest XP</span>
        <span class="profile-metric-value">${Number(questXP || 0).toLocaleString()}</span>
      </div>
    `;
  }

  function createQuestCard(quest, typeLabel) {
    const card = document.createElement('article');
    card.className = 'profile-quest-card';
    if (quest.completed) {
      card.dataset.complete = 'true';
    }

    const header = document.createElement('header');
    const label = document.createElement('span');
    label.textContent = quest.description;
    const xp = document.createElement('span');
    xp.textContent = `+${quest.xp} XP`;
    header.appendChild(label);
    header.appendChild(xp);

    const type = document.createElement('span');
    type.className = 'profile-quest-status';
    type.textContent = typeLabel;

    const progress = document.createElement('div');
    progress.className = 'profile-quest-progress';
    const fill = document.createElement('span');
    const current = Math.min(quest.progress || 0, quest.goal || 0);
    const pct = quest.goal ? Math.min(100, (current / quest.goal) * 100) : 0;
    fill.style.width = `${pct}%`;
    progress.appendChild(fill);

    const status = document.createElement('div');
    status.className = 'profile-quest-status';
    status.textContent = quest.completed ? 'Completed' : `${current} / ${quest.goal}`;

    card.appendChild(header);
    card.appendChild(type);
    card.appendChild(progress);
    card.appendChild(status);
    return card;
  }

  function renderQuests(detail) {
    const container = overlay.querySelector(selectors.quests);
    if (!container) return;
    container.innerHTML = '';
    const data = detail && typeof detail === 'object' && detail.daily && detail.weekly ? detail : getActiveQuests();
    const combined = [
      ...(Array.isArray(data.daily) ? data.daily.map(q => ({ ...q, __type: 'Daily quest' })) : []),
      ...(Array.isArray(data.weekly) ? data.weekly.map(q => ({ ...q, __type: 'Weekly quest' })) : [])
    ];
    if (!combined.length) {
      const empty = document.createElement('p');
      empty.className = 'profile-empty';
      empty.textContent = 'No quests available right now. Check back soon!';
      container.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    combined.forEach(quest => {
      fragment.appendChild(createQuestCard(quest, quest.__type));
    });
    container.appendChild(fragment);
  }

  function renderHistory() {
    const container = overlay.querySelector(selectors.history);
    if (!container) return;
    container.innerHTML = '';
    const slugs = getLastPlayed(6);
    if (!Array.isArray(slugs) || !slugs.length) {
      const empty = document.createElement('li');
      empty.className = 'profile-empty';
      empty.textContent = 'No recent plays yet. Launch a game to build your history.';
      container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    slugs.forEach((slug, index) => {
      const item = document.createElement('li');
      item.className = 'profile-history-item';
      item.dataset.slug = slug;

      const title = document.createElement('strong');
      const label = catalogTitles.get(slug) || slug;
      title.textContent = `${index + 1}. ${label}`;

      const meta = document.createElement('span');
      meta.textContent = slug;

      item.appendChild(title);
      item.appendChild(meta);
      fragment.appendChild(item);
    });
    container.appendChild(fragment);

    if (!catalogPromise) {
      catalogPromise = loadCatalogTitles().then(map => {
        catalogTitles = map;
        updateHistoryTitles();
      });
    }
  }

  function updateHistoryTitles() {
    if (!overlay) return;
    const items = overlay.querySelectorAll('[data-profile-history] .profile-history-item');
    items.forEach((item, index) => {
      const slug = item.dataset.slug;
      const titleNode = item.querySelector('strong');
      if (!slug || !titleNode) return;
      const label = catalogTitles.get(slug) || slug;
      titleNode.textContent = `${index + 1}. ${label}`;
    });
  }

  async function loadCatalogTitles() {
    const urls = ['./games.json', './public/games.json'];
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res?.ok) continue;
        const data = await res.json();
        const list = Array.isArray(data) ? data : Array.isArray(data?.games) ? data.games : [];
        const map = new Map();
        list.forEach(entry => {
          const slug = entry?.slug || entry?.id;
          if (!slug) return;
          const title = entry?.title || entry?.name || slug;
          map.set(slug, title);
        });
        if (map.size) return map;
      } catch (error) {
        console.warn('[profile-overlay] Failed to load catalog titles from', url, error);
      }
    }
    return new Map();
  }

  function renderAll(detail) {
    renderSwitchList(detail?.profiles || listProfiles());
    renderMetrics();
    renderQuests(detail);
    renderHistory();
  }

  function openOverlay(detail) {
    ensureOverlay();
    renderAll(detail);
    overlay.setAttribute('aria-hidden', 'false');
    trigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('profile-overlay-open');
    lastFocused = document.activeElement;
    dialog?.focus();
    window.addEventListener('keydown', onKeyDown);
  }

  function closeOverlay() {
    if (!overlay) return;
    overlay.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('profile-overlay-open');
    window.removeEventListener('keydown', onKeyDown);
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    } else {
      trigger.focus();
    }
  }

  function onOverlayClick(event) {
    const target = event.target;
    if (!target) return;
    if (target.matches('[data-close]')) {
      closeOverlay();
      return;
    }
    if (target.matches(selectors.add)) {
      const nameInput = window.prompt('Enter a profile name:');
      const name = nameInput ? nameInput.trim() : '';
      if (!name) return;
      const avatarInput = window.prompt('Avatar image URL (optional):') || '';
      const avatar = avatarInput.trim();
      const profile = login(name, avatar);
      updateTrigger(profile);
      renderSwitchList();
      renderMetrics();
      renderHistory();
      return;
    }
    const switchBtn = target.closest('[data-switch]');
    if (switchBtn) {
      const nextName = switchBtn.dataset.switch;
      if (nextName && nextName !== getProfile().name) {
        const saved = listProfiles().find(p => p.name === nextName);
        const profile = login(nextName, saved?.avatar || '');
        updateTrigger(profile);
        renderAll();
      }
      closeOverlay();
      return;
    }
    const removeBtn = target.closest('[data-remove]');
    if (removeBtn) {
      const name = removeBtn.dataset.remove;
      if (!name) return;
      const confirmed = window.confirm(`Remove profile "${name}"? This keeps any saved data locally but removes it from the switcher.`);
      if (!confirmed) return;
      removeProfile(name);
      renderAll();
      return;
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeOverlay();
    }
  }

  trigger.addEventListener('click', () => {
    ensureOverlay();
    const isOpen = overlay.getAttribute('aria-hidden') === 'false';
    if (isOpen) {
      closeOverlay();
    } else {
      openOverlay();
    }
  });

  updateTrigger();

  window.addEventListener(PROFILE_EVENT, (event) => {
    const detail = event?.detail || {};
    updateTrigger(detail.profile || getProfile());
    if (overlay && overlay.getAttribute('aria-hidden') === 'false') {
      renderAll(detail);
    }
  });

  window.addEventListener(QUESTS_UPDATED_EVENT, (event) => {
    if (!overlay || overlay.getAttribute('aria-hidden') === 'true') return;
    renderQuests(event?.detail);
    renderMetrics();
  });
}
