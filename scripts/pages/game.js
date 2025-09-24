import { loadStyle } from '../utils.js';

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
  try {
    const res = await fetch('/games.json');
    const games = await res.json();
    const game = Array.isArray(games) ? games.find(g => g.id === params.id) : null;
    if (game && game.playUrl){
      if (forceLegacy) src = String(game.playUrl);
    }
  } catch {}
  const frame = document.createElement('iframe');
  frame.id = 'game-frame';
  frame.src = src;
  frame.loading = 'lazy';
  outlet.appendChild(frame);
}
