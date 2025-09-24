import { loadStyle } from '../utils.js';
import { resolveAssetPath } from '../../shared/base-path.js';

export default async function(outlet){
  loadStyle('styles/pages/categories.css');
  const res = await fetch(resolveAssetPath('games.json'));
  const games = await res.json();
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
