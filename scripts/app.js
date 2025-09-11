import { createRouter } from './router.js';

const outlet = document.getElementById('app');
const router = createRouter(outlet);

router.register('/', () => import('./pages/home.js'));
router.register('/games', () => import('./pages/games.js'));
router.register('/categories', () => import('./pages/categories.js'));
router.register('/leaderboards', () => import('./pages/leaderboards.js'));
router.register('/about', () => import('./pages/about.js'));
router.register('/game/:id', () => import('./pages/game.js'), async ({ id }) => {
  try {
    const res = await fetch('/data/games.json');
    const games = await res.json();
    return Array.isArray(games) && games.some(g => g.id === id);
  } catch {
    return false;
  }
});

router.resolve(location.pathname);
