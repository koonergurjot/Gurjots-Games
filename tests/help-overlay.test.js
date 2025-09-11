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
});
