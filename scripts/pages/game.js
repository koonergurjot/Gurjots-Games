import { loadStyle } from '../utils.js';
import { getGameById } from '../../shared/game-catalog.js';
import {
  ALLOWED_DIFFICULTIES,
  getPreferences,
  setDifficulty,
  setLastPlayed,
  setSoundEnabled,
  subscribe,
} from '../state/user-state.js';

function capitalize(text) {
  if (typeof text !== 'string' || !text.length) {
    return '';
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default async function(outlet, params, context){
  loadStyle('styles/pages/game.css');
  const slug = params.id;
  const url = context?.url ?? new URL(location.href);
  const query = new URLSearchParams(url.search);
  const forceLegacy = query.has('legacy') || (query.get('shell') || '').toLowerCase() === 'legacy' || query.get('noshell') === '1';
  document.title = 'Play — Gurjot\'s Games';
  const game = await getGameById(params.id);
  const buildShellUrl = (id) => {
    const shellUrl = new URL('/game.html', location.origin);
    shellUrl.searchParams.set('slug', id);
    if (game?.title) {
      shellUrl.searchParams.set('title', game.title);
    }
    ['modern', 'shell', 'diag', 'diagnostics'].forEach(key => {
      if (query.has(key)) {
        const value = query.get(key);
        if (value === null) {
          shellUrl.searchParams.set(key, '');
        } else {
          shellUrl.searchParams.set(key, value);
        }
      }
    });
    return `${shellUrl.pathname}${shellUrl.search}`;
  };
  let src = forceLegacy ? `/games/${slug}/` : buildShellUrl(slug);
  if (game && forceLegacy){
    src = game.playPath || game.playUrl || src;
  }

  if (game) {
    setLastPlayed({
      gameId: game.id,
      title: game.title || '',
      playedAt: new Date().toISOString(),
    });
  }

  const preferencesPanel = document.createElement('section');
  preferencesPanel.className = 'game-preferences';
  preferencesPanel.innerHTML = `
    <h2 class="game-preferences__title">Game settings</h2>
    <div class="game-preferences__controls">
      <label class="game-preferences__toggle">
        <input type="checkbox" data-sound-toggle />
        <span>Sound enabled</span>
      </label>
      <label class="game-preferences__select">
        <span>Difficulty</span>
        <select data-difficulty-select></select>
      </label>
    </div>
    <p class="game-preferences__summary" data-preference-summary></p>
  `;

  const difficultySelect = preferencesPanel.querySelector('[data-difficulty-select]');
  if (difficultySelect) {
    difficultySelect.innerHTML = '';
    ALLOWED_DIFFICULTIES.forEach(level => {
      const option = document.createElement('option');
      option.value = level;
      option.textContent = capitalize(level);
      difficultySelect.appendChild(option);
    });
  }

  const soundToggle = preferencesPanel.querySelector('[data-sound-toggle]');
  const summary = preferencesPanel.querySelector('[data-preference-summary]');

  const applyPreferences = preferences => {
    const current = preferences || getPreferences();
    if (soundToggle) {
      soundToggle.checked = Boolean(current.sound);
    }
    if (difficultySelect) {
      const nextValue = ALLOWED_DIFFICULTIES.includes(current.difficulty)
        ? current.difficulty
        : ALLOWED_DIFFICULTIES[0];
      difficultySelect.value = nextValue;
    }
    if (summary) {
      summary.textContent = `Sound ${current.sound ? 'on' : 'muted'} · Difficulty ${capitalize(current.difficulty)}`;
    }
  };

  applyPreferences(getPreferences());

  if (soundToggle) {
    soundToggle.addEventListener('change', () => {
      setSoundEnabled(soundToggle.checked);
    });
  }

  if (difficultySelect) {
    difficultySelect.addEventListener('change', () => {
      setDifficulty(difficultySelect.value);
    });
  }

  const unsubscribe = subscribe(state => {
    applyPreferences(state.preferences);
  });

  const observer = new MutationObserver(() => {
    if (!outlet.contains(preferencesPanel)) {
      unsubscribe();
      observer.disconnect();
    }
  });
  observer.observe(outlet, { childList: true });

  outlet.appendChild(preferencesPanel);
  const frame = document.createElement('iframe');
  frame.id = 'game-frame';
  frame.src = src;
  frame.loading = 'lazy';
  frame.allow = 'fullscreen; clipboard-read; clipboard-write';
  frame.setAttribute('allowfullscreen', '');
  frame.title = game?.title ? `${game.title} shell` : 'Game shell';
  outlet.appendChild(frame);
}
