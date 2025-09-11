/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { attachHelpOverlay } from '../shared/ui.js';

const steps = [{ objective: 'Win', controls: 'Arrows', tips: 'Good luck' }];

describe('attachHelpOverlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('shows overlay automatically on first run and sets localStorage flag', () => {
    attachHelpOverlay({ gameId: 'game1', steps });
    const overlay = document.querySelector('.help-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('hidden')).toBe(false);
    const seen = JSON.parse(localStorage.getItem('seenHints'));
    expect(seen.game1).toBe(true);
  });

  it('does not auto show when already seen', () => {
    localStorage.setItem('seenHints', JSON.stringify({ game1: true }));
    attachHelpOverlay({ gameId: 'game1', steps });
    const overlay = document.querySelector('.help-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('hides on Escape and returns focus to help button', () => {
    document.body.innerHTML = '<button class="help-btn">?</button>';
    localStorage.setItem('seenHints', JSON.stringify({ game1: true }));
    const { show } = attachHelpOverlay({ gameId: 'game1', steps });
    show();
    const overlay = document.querySelector('.help-overlay');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(overlay.classList.contains('hidden')).toBe(true);
    expect(document.activeElement.classList.contains('help-btn')).toBe(true);
  });

  it('closes when clicking backdrop', () => {
    document.body.innerHTML = '<button class="help-btn">?</button>';
    localStorage.setItem('seenHints', JSON.stringify({ game1: true }));
    const { show } = attachHelpOverlay({ gameId: 'game1', steps });
    show();
    const overlay = document.querySelector('.help-overlay');
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('renders an accessible close icon', () => {
    const { show } = attachHelpOverlay({ gameId: 'game1', steps });
    show();
    const closeIcon = document.querySelector('.help-overlay .close-icon');
    expect(closeIcon).toBeTruthy();
    expect(closeIcon.getAttribute('aria-label')).toBe('Close');
  });
});
