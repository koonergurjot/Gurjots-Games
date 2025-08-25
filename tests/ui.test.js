/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { injectBackButton, recordLastPlayed } from '../shared/ui.js';

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

  it('increments play counts for each launch', () => {
    recordLastPlayed('pong');
    recordLastPlayed('pong');
    expect(localStorage.getItem('plays:pong')).toBe('2');
  });
});
