import { loadStyle } from '../utils.js';

export default function(outlet, params){
  loadStyle('styles/pages/game.css');
  const frame = document.createElement('iframe');
  frame.id = 'game-frame';
  frame.src = `/games/${params.id}/`;
  frame.loading = 'lazy';
  outlet.appendChild(frame);
}
