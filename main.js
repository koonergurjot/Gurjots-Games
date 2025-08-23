import { registerSW } from './shared/ui.js';
registerSW();

const res = await fetch('./games.json');
const games = await res.json();
const grid = document.getElementById('grid');
const search = document.getElementById('search');

function render(){
  const q = search.value.toLowerCase();
  grid.innerHTML = '';
  games
    .filter(g => !q || g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q) || (g.badge && g.badge.toLowerCase().includes(q)))
    .forEach(g => {
      const a = document.createElement('a');
      a.className = 'card';
      a.href = g.path;
      a.setAttribute('aria-label', 'Play ' + g.name);
      let highHtml = '';
      if (g.hasScore){
        const score = localStorage.getItem('highscore_' + g.id) || 0;
        highHtml = `<div class="high">High: ${score}</div>`;
      }
      a.innerHTML = `
        <div class="badge">${g.badge}</div>
        <h3>${g.name}</h3>
        <p>${g.description}</p>
        ${highHtml}
        <div class="play">Play →</div>
      `;
      grid.appendChild(a);
    });
}

search.addEventListener('input', render);
render();
