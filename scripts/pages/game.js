import { loadStyle } from '../utils.js';
import { getGameById } from '../../shared/game-catalog.js';

export default async function(outlet, params){
  loadStyle('styles/pages/game.css');
  const slug = params.id;
  const query = new URLSearchParams(location.search);
  const forceLegacy = query.has('legacy') || (query.get('shell') || '').toLowerCase() === 'legacy' || query.get('noshell') === '1';
  const buildShellUrl = (id) => {
    const url = new URL('/game.html', location.origin);
    url.searchParams.set('slug', id);
    return `${url.pathname}${url.search}`;
  };
  let src = forceLegacy ? `/games/${slug}/` : buildShellUrl(slug);
  const game = await getGameById(params.id);
  if (game && forceLegacy){
    src = game.playPath || game.playUrl || src;
  }
  const frame = document.createElement('iframe');
  frame.id = 'game-frame';
  frame.src = src;
  frame.loading = 'lazy';
  outlet.appendChild(frame);
}
