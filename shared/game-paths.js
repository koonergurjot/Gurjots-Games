import { getGameById } from './game-catalog.js';
import {
  basePathFromFullPath,
  buildIndexPath,
  normalizePlayPath
} from './game-path-utils.js';

export async function resolveGamePaths(slug) {
  if (!slug) return { basePath: null, playPath: null };
  const game = await getGameById(slug);
  if (!game) return { basePath: null, playPath: null };

  let { basePath = null, playPath = null } = game;

  if (!playPath) {
    playPath = normalizePlayPath(game.playUrl || game.path || game.entry);
  }

  if (!basePath && playPath) {
    basePath = basePathFromFullPath(playPath);
  }

  if (!playPath && basePath) {
    playPath = buildIndexPath(basePath);
  }

  return {
    basePath: basePath || null,
    playPath: playPath || null
  };
}
