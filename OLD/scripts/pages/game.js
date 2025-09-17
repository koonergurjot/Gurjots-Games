import { loadStyle } from '../utils.js';

export default async function(outlet, params){
  loadStyle('styles/pages/game.css');
  let src = `/games/${params.id}/`;
  try {
    const res = await fetch('/data/games.json');
    const games = await res.json();
    const game = Array.isArray(games) ? games.find(g => g.id === params.id) : null;
    if (game && game.playUrl) src = game.playUrl;
  } catch {}
  const frame = document.createElement('iframe');
  frame.id = 'game-frame';
  frame.src = src;
  frame.loading = 'lazy';
  outlet.appendChild(frame);
}
