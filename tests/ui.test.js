/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { injectBackButton } from '../shared/ui.js';

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
});
