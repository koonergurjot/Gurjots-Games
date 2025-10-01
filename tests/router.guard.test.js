/* @vitest-environment jsdom */
import { describe, expect, test, vi } from 'vitest';
import { Router } from '../scripts/router.js';

describe('Router guard navigation', () => {
  test('guard failure replaces current history entry', async () => {
    const originalPathname = location.pathname;
    history.replaceState({}, '', originalPathname);

    const pushSpy = vi.spyOn(history, 'pushState');
    const replaceSpy = vi.spyOn(history, 'replaceState');

    const outlet = document.createElement('div');
    const router = new Router(outlet);
    const fallbackHandler = vi.fn();
    const fallbackLoader = vi.fn(async () => ({ default: fallbackHandler }));
    router.register('/', fallbackLoader);

    const guardedLoader = vi.fn(async () => ({ default: vi.fn() }));
    const guard = vi.fn().mockResolvedValue(false);
    router.register('/protected', guardedLoader, guard);

    const initialLength = history.length;

    await router.navigate('/protected');

    expect(guard).toHaveBeenCalledTimes(1);
    expect(guardedLoader).not.toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(history.length).toBe(initialLength + 1);
    expect(location.pathname).toBe('/');
    expect(fallbackLoader).toHaveBeenCalledTimes(1);
    expect(fallbackHandler).toHaveBeenCalledTimes(1);

    pushSpy.mockRestore();
    replaceSpy.mockRestore();
    history.replaceState({}, '', originalPathname);
  });

  test('static routes with dots only match exact paths', async () => {
    const outlet = document.createElement('div');
    const router = new Router(outlet);

    const statsHandler = vi.fn();
    const statsLoader = vi.fn(async () => ({ default: statsHandler }));
    const statsXHandler = vi.fn();
    const statsXLoader = vi.fn(async () => ({ default: statsXHandler }));

    router.register('/stats.html', statsLoader);
    router.register('/statsXhtml', statsXLoader);

    await router.resolve('/stats.html');
    expect(statsLoader).toHaveBeenCalledTimes(1);
    expect(statsHandler).toHaveBeenCalledTimes(1);
    expect(statsXLoader).not.toHaveBeenCalled();

    await router.resolve('/statsXhtml');
    expect(statsLoader).toHaveBeenCalledTimes(1);
    expect(statsHandler).toHaveBeenCalledTimes(1);
    expect(statsXLoader).toHaveBeenCalledTimes(1);
    expect(statsXHandler).toHaveBeenCalledTimes(1);
  });
});
