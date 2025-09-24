import { loadStyle } from '../utils.js';
import { resolveGamePaths } from '../../shared/game-paths.js';

export default async function(outlet, params){
  loadStyle('styles/pages/game.css');
  let src = `/games/${params.id}/index.html`;
  try {
    const { playPath } = await resolveGamePaths(params.id);
    if (playPath) {
      src = playPath;
    }
  } catch (err) {
    console.warn('[GG] unable to resolve game frame path', params?.id, err);
  }
  const frame = document.createElement('iframe');
  frame.id = 'game-frame';
  frame.src = src;
  frame.loading = 'lazy';
  outlet.appendChild(frame);
}
