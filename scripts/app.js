import { createRouter } from './router.js';
import { toggleTheme, toggleMotion } from './theme.js';
import { resolveAssetPath } from '../shared/base-path.js';

const outlet = document.getElementById('app');
const router = createRouter(outlet);
const catalogUrl = resolveAssetPath('games.json');

router.register('/', () => import('./pages/home.js'));
router.register('/games', () => import('./pages/games.js'));
router.register('/categories', () => import('./pages/categories.js'));
router.register('/leaderboards', () => import('./pages/leaderboards.js'));
router.register('/about', () => import('./pages/about.js'));
router.register('/game/:id', () => import('./pages/game.js'), async ({ id }) => {
  try {
    const res = await fetch(catalogUrl);
    const games = await res.json();
    return Array.isArray(games) && games.some(g => g.id === id);
  } catch {
    return false;
  }
});

router.resolve(location.pathname);

window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('loaded');
});

window.toggleTheme = toggleTheme;
window.toggleMotion = toggleMotion;
