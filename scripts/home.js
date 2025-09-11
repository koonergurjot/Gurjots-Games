import { toggleTheme } from './theme.js';

const themeBtn = document.getElementById('themeToggle');
themeBtn.addEventListener('click', toggleTheme);

const grid = document.getElementById('gamesGrid');
const hero = document.querySelector('.hero');
const gamesSection = document.getElementById('games');
const playArea = document.getElementById('playArea');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

let games = [];

fetch('/data/games.json')
  .then(r => r.json())
  .then(data => {
    games = Array.isArray(data) ? data : [];
    renderGrid();
    renderRoute();
  });

function renderGrid() {
  grid.innerHTML = '';
  games.forEach(g => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${g.title}</h3>
      <p>${g.short || ''}</p>
      <div class="tags">${(g.tags || []).map(t => `<span class="chip">${t}</span>`).join('')}</div>
      <div class="actions"><a class="btn play" href="#/game/${g.id}">Play</a></div>
    `;
    grid.appendChild(card);
  });

  if (!reduceMotion.matches) {
    document.querySelectorAll('.btn').forEach(btn => {
      btn.addEventListener('click', ripple);
    });
  }
}

function ripple(e) {
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.left = `${e.clientX - rect.left}px`;
  span.style.top = `${e.clientY - rect.top}px`;
  btn.appendChild(span);
  span.addEventListener('animationend', () => span.remove());
}

function renderRoute() {
  const hash = location.hash;
  if (hash.startsWith('#/game/')) {
    const id = hash.split('/')[2];
    const game = games.find(g => g.id === id);
    if (game) {
      hero.hidden = true;
      gamesSection.hidden = true;
      playArea.hidden = false;
      playArea.innerHTML = `<iframe class="play-frame" src="${game.playUrl}" title="${game.title}"></iframe>`;
      return;
    }
  }
  hero.hidden = false;
  gamesSection.hidden = false;
  playArea.hidden = true;
  playArea.innerHTML = '';
}

window.addEventListener('hashchange', renderRoute);
window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('loaded');
});

