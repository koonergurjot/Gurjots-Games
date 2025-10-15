/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameCard } from '../scripts/components/game-card.js';

describe('createGameCard', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders preview art when thumbnailPath is provided', () => {
    const game = {
      id: 'demo',
      title: 'Demo Game',
      short: 'A test entry',
      thumbnailPath: 'https://example.com/demo-thumb.png'
    };

    const card = createGameCard(game);
    const media = card.querySelector('.game-card__media');
    const art = card.querySelector('.game-card__art');

    expect(media).toBeTruthy();
    expect(media?.hasAttribute('hidden')).toBe(false);
    expect(art).toBeTruthy();
    expect(art?.getAttribute('src')).toBe('https://example.com/demo-thumb.png');
    expect(art?.getAttribute('alt')).toBe('Demo Game preview frame');
  });

  it('falls back to asset sprites when thumbnailPath is missing', () => {
    const game = {
      id: 'demo',
      title: 'Demo Game',
      description: 'A test entry',
      assets: {
        sprites: ['https://example.com/demo.png']
      }
    };

    const card = createGameCard(game);
    const art = card.querySelector('.game-card__art');

    expect(art?.getAttribute('src')).toBe('https://example.com/demo.png');
  });

  it('omits meta container when no rating or platforms are available', () => {
    const game = {
      id: 'bare',
      title: 'Bare Bones',
      short: 'Minimal info',
      thumbnailPath: 'https://example.com/bare.png'
    };

    const card = createGameCard(game);
    const meta = card.querySelector('.game-card__meta');

    expect(meta).toBeNull();
  });

  it('renders rating and platform badges when provided', () => {
    const game = {
      id: 'meta',
      title: 'Meta Runner',
      short: 'Speedy fun',
      thumbnailPath: 'https://example.com/meta.png',
      rating: 4.6,
      ratingCount: 1289,
      platforms: ['Web', 'Mobile']
    };

    const card = createGameCard(game);
    const rating = card.querySelector('.game-card__rating');
    const platforms = card.querySelectorAll('.game-card__platform');

    expect(rating).toBeTruthy();
    expect(rating?.hasAttribute('hidden')).toBe(false);
    expect(rating?.textContent).toContain('4.6');
    expect(Array.from(platforms).map(el => el.textContent)).toEqual(['Web', 'Mobile']);
  });

  it('falls back to feature flags when explicit platforms are missing', () => {
    const game = {
      id: 'flags',
      title: 'Flag Fighter',
      short: 'Badge heavy',
      thumbnailPath: 'https://example.com/flags.png',
      featureFlags: ['Touch', 'Gamepad']
    };

    const card = createGameCard(game);
    const platforms = card.querySelectorAll('.game-card__platform');

    expect(Array.from(platforms).map(el => el.textContent)).toEqual(['Touch', 'Gamepad']);
  });

  it('exposes trailer controls when trailer url is provided', async () => {
    const playSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const pauseSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});

    const game = {
      id: 'trailer',
      title: 'Trailer Quest',
      short: 'Preview heavy',
      thumbnailPath: 'https://example.com/trailer.png',
      trailer: 'https://example.com/trailer.mp4'
    };

    const card = createGameCard(game);
    const previewButton = card.querySelector('.game-card__preview-toggle');

    expect(previewButton).toBeTruthy();
    expect(previewButton?.hasAttribute('hidden')).toBe(false);

    previewButton?.dispatchEvent(new window.Event('click'));

    expect(playSpy).toHaveBeenCalledTimes(1);

    card.dispatchEvent(new window.MouseEvent('mouseleave'));

    expect(pauseSpy).toHaveBeenCalled();
  });
});
