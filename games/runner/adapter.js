import { registerGameDiagnostics } from '../common/diagnostics/adapter.js';

const SLUG = 'runner';

let currentGame = null;
let registered = false;

function snapshotScore(game) {
  if (!game) {
    return {
      status: 'unknown',
      score: 0,
      bestScore: 0,
      distance: 0,
      difficulty: 'med',
      levelName: '',
    };
  }
  return {
    status: game.gameOver ? 'game-over' : (game.paused ? 'paused' : 'running'),
    score: game.score ?? 0,
    bestScore: game.bestScore ?? 0,
    distance: Math.floor(game.distance ?? 0),
    difficulty: game.difficulty ?? 'med',
    levelName: game.levelName || '',
  };
}

function snapshotEntities(game) {
  if (!game) {
    return {
      meta: snapshotScore(null),
      player: null,
      obstacles: [],
    };
  }
  const player = game.player
    ? {
        x: game.player.x,
        y: game.player.y,
        width: game.player.width,
        height: game.player.height,
        vy: game.player.vy,
        grounded: !!game.player.grounded,
        sliding: !!game.player.sliding,
        state: game.player.state || (game.player.sliding ? 'slide' : (game.player.grounded ? 'run' : 'jump')),
      }
    : null;
  const obstacles = Array.isArray(game.obstacles)
    ? game.obstacles.map(obs => ({
        x: obs.x,
        y: obs.y,
        w: obs.w,
        h: obs.h,
        type: obs.type || 'obstacle',
      }))
    : [];
  return {
    meta: snapshotScore(game),
    player,
    obstacles,
  };
}

function ensureRegistered() {
  if (registered || !currentGame) return;
  registerGameDiagnostics(SLUG, {
    hooks: {},
    api: {
      start: () => currentGame?.start?.(),
      pause: () => currentGame?.pause?.(),
      resume: () => currentGame?.resume?.(),
      reset: () => currentGame?.restart?.(),
      getScore: () => snapshotScore(currentGame),
      setDifficulty: ({ level }) => {
        const target = typeof level === 'string' ? level.trim() : '';
        if (target && currentGame?.setDifficulty) {
          currentGame.setDifficulty(target);
        }
        return currentGame?.difficulty ?? 'med';
      },
      getEntities: () => snapshotEntities(currentGame),
    },
  });
  registered = true;
}

export function registerRunnerAdapter(game) {
  if (game) {
    currentGame = game;
  }
  if (!currentGame) return;
  ensureRegistered();
}
