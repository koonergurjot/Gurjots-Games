/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { getPrefs, setPref, resetPrefs, applyPrefs, prefersReducedMotion, DEFAULT_PREFS, PREFS_KEY } from '../shared/prefs.js';

describe('player preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPrefs();
  });

  it('returns defaults when nothing is saved', () => {
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('saves a change and applies it to <html>', () => {
    setPref('textSize', 'large');
    setPref('contrast', 'high');
    expect(getPrefs().textSize).toBe('large');
    expect(document.documentElement.dataset.textSize).toBe('large');
    expect(document.documentElement.dataset.contrast).toBe('high');
  });

  it('ignores unknown choices and clamps volume', () => {
    setPref('textSize', 'gigantic');
    expect(getPrefs().textSize).toBe(DEFAULT_PREFS.textSize);
    setPref('volume', 5);
    expect(getPrefs().volume).toBe(1);
    setPref('volume', -2);
    expect(getPrefs().volume).toBe(0);
  });

  it('recovers from corrupt stored data', () => {
    localStorage.setItem(PREFS_KEY, '{not json');
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sound: 'yes', motion: 'warp' }));
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('lets the player override the device motion setting', () => {
    setPref('motion', 'reduce');
    expect(prefersReducedMotion()).toBe(true);
    setPref('motion', 'full');
    expect(prefersReducedMotion()).toBe(false);
  });

  it('emits an event so open games can react', () => {
    let seen = null;
    window.addEventListener('gg:prefs', e => { seen = e.detail; }, { once: true });
    setPref('sound', false);
    expect(seen && seen.sound).toBe(false);
  });

  it('resetPrefs restores defaults and clears storage', () => {
    setPref('sound', false);
    resetPrefs();
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
    applyPrefs();
    expect(document.documentElement.dataset.motion).toBe('system');
  });
});
