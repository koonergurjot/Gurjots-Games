import { loadStyle } from '../utils.js';

export default async function(outlet){
  loadStyle('styles/pages/home.css');
  const res = await fetch('/games.json');
  const games = await res.json();
  const section = document.createElement('section');
  section.innerHTML = '<h2>Play Now</h2>';
  const grid = document.createElement('div');
  grid.className = 'grid';
  games.forEach(g => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${g.title}</h3>
      <p>${g.desc || ''}</p>
      <a href="/game/${g.id}">Play</a>
    `;
    grid.appendChild(card);
  });
  section.appendChild(grid);
  outlet.appendChild(section);
}
