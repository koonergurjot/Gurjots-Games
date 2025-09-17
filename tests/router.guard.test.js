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
});
