import { loadStyle } from '../utils.js';
import { createGameCard, syncFavoriteButton } from '../components/game-card.js';
import { loadGameCatalog } from '../../shared/game-catalog.js';
import { clearLastPlayed, getState, subscribe } from '../state/user-state.js';

export default async function(outlet){
  loadStyle('styles/pages/home.css');
  loadStyle('styles/components/game-grid.css');
  const { games } = await loadGameCatalog();
  const container = document.createElement('div');
  container.className = 'home-view';

  const lastPlayedSection = document.createElement('section');
  lastPlayedSection.className = 'home-section home-last-played';
  lastPlayedSection.innerHTML = `
    <div class="home-section__header">
      <h2>Last played</h2>
      <button type="button" class="home-last-played__clear" data-clear-last-played hidden>Clear</button>
    </div>
    <div class="grid" data-last-played-grid></div>
    <p class="home-empty" data-last-played-empty>No games played yet. Pick a game to start your journey!</p>
  `;
  container.appendChild(lastPlayedSection);

  const favoritesSection = document.createElement('section');
  favoritesSection.className = 'home-section home-favorites';
  favoritesSection.innerHTML = `
    <h2>Your favorites</h2>
    <div class="grid" data-favorites-grid></div>
    <p class="home-empty" data-favorites-empty>Favorite games to build your personal library.</p>
  `;
  container.appendChild(favoritesSection);

  const featuredSection = document.createElement('section');
  featuredSection.className = 'home-section home-featured';
  featuredSection.innerHTML = '<h2>Play Now</h2>';
  const grid = document.createElement('div');
  grid.className = 'grid';
  games.forEach(g => {
    const card = createGameCard(g);
    grid.appendChild(card);
  });
  featuredSection.appendChild(grid);
  container.appendChild(featuredSection);
  outlet.appendChild(container);

  const clearButton = lastPlayedSection.querySelector('[data-clear-last-played]');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      clearLastPlayed();
    });
  }

  const syncState = (state = getState()) => {
    const favorites = new Set(state.favorites);

    container.querySelectorAll('[data-game-favorite]').forEach(button => {
      const gameId = button.getAttribute('data-game-favorite');
      syncFavoriteButton(button, favorites.has(gameId));
    });

    const favoritesGrid = favoritesSection.querySelector('[data-favorites-grid]');
    const favoritesEmpty = favoritesSection.querySelector('[data-favorites-empty]');
    if (favoritesGrid && favoritesEmpty) {
      favoritesGrid.innerHTML = '';
      const favoriteGames = state.favorites
        .map(id => games.find(game => game.id === id))
        .filter(Boolean);
      if (favoriteGames.length) {
        favoriteGames.forEach(game => {
          favoritesGrid.appendChild(createGameCard(game));
        });
        favoritesEmpty.hidden = true;
      } else {
        favoritesEmpty.hidden = false;
      }
    }

    const lastPlayedGrid = lastPlayedSection.querySelector('[data-last-played-grid]');
    const lastPlayedEmpty = lastPlayedSection.querySelector('[data-last-played-empty]');
    const lastPlayedClear = lastPlayedSection.querySelector('[data-clear-last-played]');
    if (lastPlayedGrid && lastPlayedEmpty && lastPlayedClear) {
      lastPlayedGrid.innerHTML = '';
      const { lastPlayed } = state;
      if (lastPlayed) {
        const game = games.find(item => item.id === lastPlayed.gameId);
        if (game) {
          const card = createGameCard(game);
          const meta = document.createElement('p');
          meta.className = 'home-last-played__meta';
          const playedDate = new Date(lastPlayed.playedAt);
          const formatted = Number.isNaN(playedDate.getTime())
            ? ''
            : new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(playedDate);
          meta.textContent = formatted ? `Played ${formatted}` : 'Recently played';
          card.appendChild(meta);
          lastPlayedGrid.appendChild(card);
          lastPlayedEmpty.hidden = true;
          lastPlayedClear.hidden = false;
        } else {
          lastPlayedEmpty.hidden = false;
          lastPlayedClear.hidden = true;
        }
      } else {
        lastPlayedEmpty.hidden = false;
        lastPlayedClear.hidden = true;
      }
    }
  };

  const unsubscribe = subscribe(syncState);
  syncState();

  const observer = new MutationObserver(() => {
    if (!outlet.contains(container)) {
      unsubscribe();
      observer.disconnect();
    }
  });
  observer.observe(outlet, { childList: true });
}
