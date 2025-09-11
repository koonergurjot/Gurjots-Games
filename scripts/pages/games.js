import { loadStyle } from '../utils.js';

export default async function(outlet){
  loadStyle('styles/pages/games.css');
  const res = await fetch('/games.json');
  const games = await res.json();
  const section = document.createElement('section');
  section.innerHTML = '<h2>All Games</h2>';
  const list = document.createElement('ul');
  games.forEach(g => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="/game/${g.id}">${g.title}</a>`;
    list.appendChild(li);
  });
  section.appendChild(list);
  outlet.appendChild(section);
}
