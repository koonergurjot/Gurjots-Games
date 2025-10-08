import { createRouter } from './router.js';
import { toggleTheme, toggleMotion } from './theme.js';
import { getGameById } from '../shared/game-catalog.js';

const outlet = document.getElementById('app');
const router = createRouter(outlet);

router.register('/', () => import('./pages/home.js'));
router.register('/games', () => import('./pages/games.js'));
router.register('/categories', () => import('./pages/categories.js'));
router.register('/leaderboards', () => import('./pages/leaderboards.js'));
router.register('/about', () => import('./pages/about.js'));
router.register('/game/:id', () => import('./pages/game.js'), async ({ id }) => {
  const game = await getGameById(id);
  return Boolean(game);
});

router.resolve(location.pathname + location.search + location.hash);

window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('loaded');
});

window.toggleTheme = toggleTheme;
window.toggleMotion = toggleMotion;
