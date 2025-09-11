// Home page script for Gurjot's Game
async function init() {
  const res = await fetch('games.json');
  const games = await res.json();
  const grid = document.getElementById('gameGrid');
  games.forEach(g => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${g.title}</h3>
      <p>${g.desc}</p>
      <a href="${g.path}">Play</a>
    `;
    grid.appendChild(card);
  });
  document.body.classList.add('loaded');
  document.querySelectorAll('.card a').forEach(a=>{
    a.addEventListener('click', e=>{
      e.preventDefault();
      document.body.classList.add('fade-out');
      setTimeout(()=>location.href=a.href,200);
    });
  });
}

window.addEventListener('DOMContentLoaded', init);
