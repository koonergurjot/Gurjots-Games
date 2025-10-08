import { loadStyle } from '../utils.js';
import { getGameById } from '../../shared/game-catalog.js';

export default async function(outlet, params, context){
  loadStyle('styles/pages/game.css');
  const slug = params.id;
  const url = context?.url ?? new URL(location.href);
  const query = new URLSearchParams(url.search);
  const forceLegacy = query.has('legacy') || (query.get('shell') || '').toLowerCase() === 'legacy' || query.get('noshell') === '1';
  document.title = 'Play — Gurjot\'s Games';
  const game = await getGameById(params.id);
  const buildShellUrl = (id) => {
    const shellUrl = new URL('/game.html', location.origin);
    shellUrl.searchParams.set('slug', id);
    if (game?.title) {
      shellUrl.searchParams.set('title', game.title);
    }
    ['modern', 'shell', 'diag', 'diagnostics'].forEach(key => {
      if (query.has(key)) {
        const value = query.get(key);
        if (value === null) {
          shellUrl.searchParams.set(key, '');
        } else {
          shellUrl.searchParams.set(key, value);
        }
      }
    });
    return `${shellUrl.pathname}${shellUrl.search}`;
  };
  let src = forceLegacy ? `/games/${slug}/` : buildShellUrl(slug);
  if (game && forceLegacy){
    src = game.playPath || game.playUrl || src;
  }
  if (game?.title) {
    document.title = `Play ${game.title} — Gurjot's Games`;
  }
  const frame = document.createElement('iframe');
  frame.id = 'game-frame';
  frame.src = src;
  frame.loading = 'lazy';
  frame.allow = 'fullscreen; clipboard-read; clipboard-write';
  frame.setAttribute('allowfullscreen', '');
  frame.title = game?.title ? `${game.title} shell` : 'Game shell';
  outlet.appendChild(frame);
}
