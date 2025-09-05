/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('achievement toast accessibility', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.spyOn(global, 'requestAnimationFrame').mockImplementation(cb => cb());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('adds toast to live region and removes it after hiding', async () => {
    const { emitEvent } = await import('../shared/achievements.js');
    emitEvent({ type: 'play', slug: 'test' });

    const container = document.querySelector('div[role="status"]');
    expect(container).not.toBeNull();
    expect(container.getAttribute('aria-live')).toBe('polite');
    expect(container.children.length).toBe(1);

    await vi.runAllTimersAsync();
    expect(container.children.length).toBe(0);
  });
});

