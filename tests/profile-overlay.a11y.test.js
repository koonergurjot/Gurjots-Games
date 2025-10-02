/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const focusableSelector = [
  'a[href]',
  'area[href]',
  'button:not([disabled]):not([aria-hidden="true"])',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const buildVisibleFocusable = root => {
  const nodes = Array.from(root.querySelectorAll(focusableSelector));
  return nodes.filter(node => {
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  });
};

describe('profile overlay focus management', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = `
      <button data-profile-trigger aria-expanded="false">
        <span data-profile-avatar></span>
        <span data-profile-name></span>
      </button>
    `;

    vi.mock('../shared/profile.js', () => {
      const current = { name: 'Player One', avatar: '' };
      const profiles = [
        { name: 'Player One', avatar: '' },
        { name: 'Player Two', avatar: '' }
      ];
      return {
        getProfile: vi.fn(() => current),
        getAggregatedStats: vi.fn(() => ({ xp: 0, plays: 0, achievements: [] })),
        login: vi.fn((name, avatar = '') => ({ name, avatar })),
        listProfiles: vi.fn(() => profiles.map(profile => ({ ...profile }))),
        removeProfile: vi.fn()
      };
    });

    vi.mock('../shared/profile-events.js', () => ({
      PROFILE_EVENT: 'profile:changed'
    }));

    vi.mock('../shared/achievements.js', () => ({
      getAchievements: vi.fn(() => [])
    }));

    vi.mock('../shared/quests.js', () => ({
      getActiveQuests: vi.fn(() => ({ daily: [], weekly: [] })),
      getXP: vi.fn(() => 0),
      QUESTS_UPDATED_EVENT: 'quests:updated'
    }));

    vi.mock('../shared/ui.js', () => ({
      getLastPlayed: vi.fn(() => [])
    }));

    vi.mock('../shared/game-catalog.js', () => ({
      loadGameCatalog: vi.fn(async () => ({ games: [] }))
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('keeps focus trapped within the dialog when tabbing', async () => {
    await import('../js/profile-overlay.js');
    const trigger = document.querySelector('[data-profile-trigger]');
    expect(trigger).toBeTruthy();
    trigger.focus();
    trigger.click();

    const dialog = document.querySelector('.profile-overlay-dialog');
    expect(dialog).toBeTruthy();
    expect(document.activeElement).toBe(dialog);

    const focusable = buildVisibleFocusable(dialog);
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);

    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);
  });
});
