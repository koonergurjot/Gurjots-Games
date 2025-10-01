import { loadStyle } from '../utils.js';

loadStyle('styles/components/game-card.css');

const template = document.createElement('template');
template.innerHTML = `
  <article class="game-card">
    <div class="game-card__media" hidden>
      <img class="game-card__art" alt="" loading="lazy" />
    </div>
    <h3 class="game-title"></h3>
    <p class="game-short"></p>
    <div class="tags"></div>
    <a class="play" href="#">Play</a>
  </article>
`;

export function createGameCard(game) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.game-card');
  const sprite = game.firstFrame?.sprites?.[0] || null;
  const media = card.querySelector('.game-card__media');

  if (sprite) {
    const art = media.querySelector('.game-card__art');
    art.src = sprite;
    art.alt = `${game.title} preview frame`;
    media.hidden = false;
  } else {
    media.remove();
  }

  card.querySelector('.game-title').textContent = game.title;
  card.querySelector('.game-short').textContent = game.short || '';
  const tagsEl = card.querySelector('.tags');
  (game.tags || []).forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag';
    chip.textContent = tag;
    tagsEl.appendChild(chip);
  });
  const link = card.querySelector('.play');
  link.href = `/game/${game.id}`;
  return card;
}

export default createGameCard;
