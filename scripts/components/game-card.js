import { loadStyle } from '../utils.js';
import { isFavorite, toggleFavorite } from '../state/user-state.js';

loadStyle('styles/components/game-card.css');

const template = document.createElement('template');
template.innerHTML = `
  <article class="game-card">
    <div class="game-card__media" hidden>
      <img class="game-card__art" alt="" loading="lazy" />
    </div>
    <h3 class="game-title"></h3>
    <p class="game-short"></p>
    <div class="tags"></div>
    <div class="game-card__actions">
      <a class="play" href="#">Play</a>
      <button type="button" class="game-card__favorite" data-game-favorite aria-pressed="false">
        <span class="game-card__favorite-icon" aria-hidden="true">☆</span>
        <span class="game-card__favorite-label">Add to favorites</span>
      </button>
    </div>
  </article>
`;

export function syncFavoriteButton(button, favorite) {
  if (!(button instanceof HTMLElement)) {
    return;
  }
  const isActive = Boolean(favorite);
  button.classList.toggle('is-active', isActive);
  button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  button.setAttribute('data-active', isActive ? 'true' : 'false');
  button.setAttribute('title', isActive ? 'Remove from favorites' : 'Add to favorites');

  const icon = button.querySelector('.game-card__favorite-icon');
  if (icon) {
    icon.textContent = isActive ? '★' : '☆';
  }

  const label = button.querySelector('.game-card__favorite-label');
  if (label) {
    label.textContent = isActive ? 'Remove from favorites' : 'Add to favorites';
  }
}

export function createGameCard(game) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.game-card');
  const sprite =
    game.thumbnailPath ||
    game.thumbnail ||
    game.assets?.sprites?.[0] ||
    game.firstFrame?.sprites?.[0] ||
    null;
  const media = card.querySelector('.game-card__media');

  if (sprite) {
    const art = media.querySelector('.game-card__art');
    art.src = sprite;
    art.alt = `${game.title} preview frame`;
    media.hidden = false;
  } else {
    media.remove();
  }

  card.querySelector('.game-title').textContent = game.title;
  card.querySelector('.game-short').textContent = game.description || game.short || '';
  const tagsEl = card.querySelector('.tags');
  (game.tags || []).forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag';
    chip.textContent = tag;
    tagsEl.appendChild(chip);
  });
  const link = card.querySelector('.play');
  link.href = `/game/${game.id}`;

  const favoriteButton = card.querySelector('[data-game-favorite]');
  if (favoriteButton) {
    favoriteButton.dataset.gameFavorite = game.id;

    syncFavoriteButton(favoriteButton, isFavorite(game.id));

    favoriteButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const nextState = toggleFavorite(game.id);
      const isNowFavorite = nextState.favorites.includes(game.id);
      syncFavoriteButton(favoriteButton, isNowFavorite);
    });
  }

  return card;
}

export default createGameCard;
