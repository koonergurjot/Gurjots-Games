import { loadStyle } from '../utils.js';
import { createGameCard } from '../components/game-card.js';

export default async function(outlet){
  loadStyle('styles/pages/home.css');
  loadStyle('styles/components/game-grid.css');
  const res = await fetch('/games.json');
  const games = await res.json();
  const section = document.createElement('section');
  section.innerHTML = '<h2>Play Now</h2>';
  const grid = document.createElement('div');
  grid.className = 'grid';
  games.forEach(g => {
    const card = createGameCard(g);
    grid.appendChild(card);
  });
  section.appendChild(grid);
  outlet.appendChild(section);
}
