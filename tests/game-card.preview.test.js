/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameCard } from '../scripts/components/game-card.js';

describe('createGameCard', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('renders preview art when firstFrame sprite is provided', () => {
    const game = {
      id: 'demo',
      title: 'Demo Game',
      short: 'A test entry',
      firstFrame: {
        sprites: ['https://example.com/demo.png']
      }
    };

    const card = createGameCard(game);
    const media = card.querySelector('.game-card__media');
    const art = card.querySelector('.game-card__art');

    expect(media).toBeTruthy();
    expect(media?.hasAttribute('hidden')).toBe(false);
    expect(art).toBeTruthy();
    expect(art?.getAttribute('src')).toBe('https://example.com/demo.png');
    expect(art?.getAttribute('alt')).toBe('Demo Game preview frame');
  });
});
