import { loadStyle } from '../utils.js';
import { loadGameCatalog } from '../../shared/game-catalog.js';

export default async function(outlet){
  loadStyle('styles/pages/categories.css');
  const { games } = await loadGameCatalog();
  const tags = new Map();
  games.forEach(g => (g.tags||[]).forEach(t => tags.set(t, (tags.get(t)||0)+1)));
  const section = document.createElement('section');
  section.innerHTML = '<h2>Categories</h2>';
  const list = document.createElement('ul');
  tags.forEach((count, tag) => {
    const li = document.createElement('li');
    li.textContent = `${tag} (${count})`;
    list.appendChild(li);
  });
  section.appendChild(list);
  outlet.appendChild(section);
}
