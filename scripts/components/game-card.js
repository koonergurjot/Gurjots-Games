import { loadStyle } from '../utils.js';
import { isFavorite, toggleFavorite } from '../state/user-state.js';

loadStyle('styles/components/game-card.css');

const template = document.createElement('template');
template.innerHTML = `
  <article class="game-card">
    <div class="game-card__media" hidden>
      <img class="game-card__art" alt="" loading="lazy" />
      <video class="game-card__trailer" playsinline muted loop preload="metadata" hidden></video>
      <button type="button" class="game-card__preview-toggle" hidden>
        <span class="game-card__preview-icon" aria-hidden="true">▶</span>
        <span class="game-card__preview-label">Play trailer</span>
      </button>
    </div>
    <h3 class="game-title"></h3>
    <p class="game-short"></p>
    <div class="game-card__meta">
      <div class="game-card__rating" hidden>
        <span class="game-card__rating-stars" aria-hidden="true"></span>
        <span class="game-card__rating-score"></span>
        <span class="game-card__rating-count"></span>
      </div>
      <div class="game-card__platforms" hidden></div>
    </div>
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

  const trailer = game.trailer || game.previewVideo || null;
  const trailerEl = card.querySelector('.game-card__trailer');
  const previewToggle = card.querySelector('.game-card__preview-toggle');

  if (trailer && trailerEl && previewToggle && media && !media.hasAttribute('hidden')) {
    trailerEl.src = trailer;
    trailerEl.hidden = false;
    previewToggle.hidden = false;

    const setPlayingState = isPlaying => {
      card.classList.toggle('is-previewing', isPlaying);
      previewToggle.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
      const label = previewToggle.querySelector('.game-card__preview-label');
      const icon = previewToggle.querySelector('.game-card__preview-icon');
      if (label) {
        label.textContent = isPlaying ? 'Pause trailer' : 'Play trailer';
      }
      if (icon) {
        icon.textContent = isPlaying ? '❚❚' : '▶';
      }
    };

    setPlayingState(false);

    const play = async () => {
      if (typeof trailerEl.play !== 'function') {
        setPlayingState(false);
        return;
      }
      try {
        await trailerEl.play();
        setPlayingState(true);
      } catch (error) {
        setPlayingState(false);
      }
    };

    const pause = () => {
      if (typeof trailerEl.pause === 'function') {
        trailerEl.pause();
      }
      setPlayingState(false);
    };

    previewToggle.addEventListener('click', event => {
      event.preventDefault();
      if (trailerEl.paused) {
        play();
      } else {
        pause();
      }
    });

    const prefersFinePointer = () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: fine)').matches;

    card.addEventListener('mouseenter', () => {
      if (prefersFinePointer() && trailerEl.paused) {
        play();
      }
    });

    card.addEventListener('mouseleave', () => {
      pause();
    });
  } else {
    if (previewToggle) {
      previewToggle.remove();
    }
    if (trailerEl) {
      trailerEl.remove();
    }
  }

  card.querySelector('.game-title').textContent = game.title;
  card.querySelector('.game-short').textContent = game.description || game.short || '';
  const ratingEl = card.querySelector('.game-card__rating');
  const ratingStarsEl = card.querySelector('.game-card__rating-stars');
  const ratingScoreEl = card.querySelector('.game-card__rating-score');
  const ratingCountEl = card.querySelector('.game-card__rating-count');
  const rating = Number.parseFloat(game.rating);
  const ratingCount = Number.parseInt(game.ratingCount ?? game.reviewsCount ?? 0, 10);

  if (ratingEl && Number.isFinite(rating) && rating > 0) {
    const clampedRating = Math.min(Math.max(rating, 0), 5);
    const rounded = Math.round(clampedRating * 10) / 10;
    if (ratingStarsEl) {
      const solidStars = Math.round(clampedRating);
      ratingStarsEl.textContent = solidStars > 0 ? '★'.repeat(solidStars) : '★';
    }
    if (ratingScoreEl) {
      ratingScoreEl.textContent = `${rounded.toFixed(1)} / 5`;
    }
    if (ratingCountEl && Number.isFinite(ratingCount) && ratingCount > 0) {
      ratingCountEl.textContent = `(${ratingCount.toLocaleString()} reviews)`;
    } else if (ratingCountEl) {
      ratingCountEl.remove();
    }
    ratingEl.hidden = false;
    ratingEl.setAttribute('aria-label', `Rated ${rounded.toFixed(1)} out of 5`);
  } else if (ratingEl) {
    ratingEl.remove();
  }

  const platformsEl = card.querySelector('.game-card__platforms');
  const platforms = Array.isArray(game.platforms)
    ? game.platforms.filter(Boolean)
    : Array.isArray(game.featureFlags)
      ? game.featureFlags.filter(Boolean)
      : [];

  if (platformsEl && platforms.length > 0) {
    platforms.forEach(platform => {
      const badge = document.createElement('span');
      badge.className = 'game-card__platform';
      badge.textContent = platform;
      badge.setAttribute('role', 'listitem');
      platformsEl.appendChild(badge);
    });
    platformsEl.hidden = false;
  } else if (platformsEl) {
    platformsEl.remove();
  }
  const metaEl = card.querySelector('.game-card__meta');
  if (metaEl && metaEl.childElementCount === 0) {
    metaEl.remove();
  }
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
