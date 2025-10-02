/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { injectBackButton, recordLastPlayed } from '../shared/ui.js';

const mockCatalogGames = [];
const nativeGetContext = HTMLCanvasElement.prototype.getContext;
const nativeMatchMedia = global.matchMedia;

vi.mock('../shared/game-catalog.js', () => ({
  loadGameCatalog: async () => ({ games: mockCatalogGames })
}));

vi.mock('../tools/reporters/console-signature.js', () => ({
  warn: vi.fn()
}));

describe('injectBackButton', () => {
  beforeEach(() => {
    // Reset DOM before each test
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('adds a back link with default href and injects styles', () => {
    injectBackButton();

    const link = document.querySelector('a.back-to-hub');
    expect(link).toBeTruthy();
    expect(link.textContent).toBe('← Back to Hub');
    expect(link.getAttribute('href')).toBe('../../');

    const style = document.head.querySelector('style');
    expect(style).toBeTruthy();
    expect(style.textContent).toContain('.back-to-hub');
  });

  it('uses custom href when provided', () => {
    injectBackButton('../');

    const link = document.querySelector('a.back-to-hub');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('../');
  });

  it('updates existing link without duplicating elements on subsequent calls', () => {
    injectBackButton();
    injectBackButton('../');

    const links = document.querySelectorAll('a.back-to-hub');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('../');

    const styles = document.head.querySelectorAll('style[data-back-to-hub]');
    expect(styles.length).toBe(1);
  });
});

describe('recordLastPlayed', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('prepends id, removes duplicates, and truncates to 10 items', () => {
    localStorage.setItem('lastPlayed', JSON.stringify(['a', 'b', 'c']));
    recordLastPlayed('b');
    recordLastPlayed('d');

    const result = JSON.parse(localStorage.getItem('lastPlayed'));
    expect(result).toEqual(['d', 'b', 'a', 'c']);

    const many = Array.from({ length: 10 }, (_, i) => `g${i}`);
    localStorage.setItem('lastPlayed', JSON.stringify(many));
    recordLastPlayed('new');

    const truncated = JSON.parse(localStorage.getItem('lastPlayed'));
    expect(truncated.length).toBe(10);
    expect(truncated[0]).toBe('new');
  });

  it('handles non-array stored value gracefully', () => {
    localStorage.setItem('lastPlayed', '"oops"');
    recordLastPlayed('x');
    const result = JSON.parse(localStorage.getItem('lastPlayed'));
    expect(result).toEqual(['x']);
  });
});

describe('landing newest sort', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCatalogGames.length = 0;
    document.body.innerHTML = `
      <div id="app-root">
        <header>
          <span id="year"></span>
          <select id="theme"><option value="default">Default</option></select>
          <input id="search" />
          <select id="sort">
            <option value="az">A-Z</option>
            <option value="za">Z-A</option>
            <option value="new">Newest</option>
          </select>
        </header>
        <div id="tagChips"></div>
        <div id="statusWrap"><div id="status"></div></div>
        <div id="gamesGrid"></div>
      </div>
    `;
    global.innerWidth = 1280;
    global.innerHeight = 720;
    localStorage.clear();
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
    window.requestAnimationFrame = vi.fn();
    HTMLCanvasElement.prototype.getContext = () => null;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = nativeGetContext;
    window.matchMedia = nativeMatchMedia;
    vi.resetAllMocks();
  });

  it('reorders games by the newest derived timestamp', async () => {
    mockCatalogGames.push(
      { id: 'old', title: 'Old Game', description: 'Old', tags: [], addedAt: '2023-01-01' },
      { id: 'fresh', title: 'Fresh Game', description: 'Fresh', tags: [], released: '2024-05-20' }
    );

    await import('../js/app.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    await new Promise(resolve => setTimeout(resolve, 0));

    const sort = document.getElementById('sort');
    sort.value = 'new';
    sort.dispatchEvent(new Event('change'));

    await new Promise(resolve => setTimeout(resolve, 0));

    const titles = Array.from(document.querySelectorAll('#gamesGrid article h3')).map(el => el.textContent);
    expect(titles[0]).toBe('Fresh Game');
  });

  it('lets users favorite a game and filter by favorites', async () => {
    mockCatalogGames.push(
      { id: 'fav', title: 'Fav Game', description: 'Fav', tags: [] },
      { id: 'other', title: 'Other Game', description: 'Other', tags: [] }
    );

    await import('../js/app.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    await new Promise(resolve => setTimeout(resolve, 0));

    const favBtn = document.querySelector('.favorite-toggle');
    expect(favBtn).toBeTruthy();
    favBtn.click();

    const favoritesChip = Array.from(document.querySelectorAll('#tagChips button')).find(btn => btn.textContent.startsWith('Favorites'));
    expect(favoritesChip).toBeTruthy();
    favoritesChip.click();

    const titles = Array.from(document.querySelectorAll('#gamesGrid article h3')).map(el => el.textContent);
    expect(titles).toEqual(['Fav Game']);
  });
});
