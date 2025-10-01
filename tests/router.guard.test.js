/* @vitest-environment jsdom */
import { beforeEach, describe, expect, test, vi } from 'vitest';

const notFoundHandler = vi.fn();

vi.mock('../scripts/pages/not-found.js', () => ({
  default: notFoundHandler,
}));

import { Router } from '../scripts/router.js';

describe('Router guard navigation', () => {
  beforeEach(() => {
    notFoundHandler.mockClear();
  });

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
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(history.length).toBe(initialLength);
    expect(location.pathname).toBe('/');
    expect(fallbackLoader).toHaveBeenCalledTimes(1);
    expect(fallbackHandler).toHaveBeenCalledTimes(1);
    expect(notFoundHandler).not.toHaveBeenCalled();

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

  test('guarded home route falls back to not-found', async () => {
    const outlet = document.createElement('div');
    const router = new Router(outlet);

    const guard = vi.fn().mockResolvedValue(false);
    const guardedLoader = vi.fn(async () => ({ default: vi.fn() }));
    router.register('/', guardedLoader, guard);

    await router.resolve('/');

    expect(guard).toHaveBeenCalledTimes(1);
    expect(guardedLoader).not.toHaveBeenCalled();
    expect(notFoundHandler).toHaveBeenCalledTimes(1);
  });

  test('missing home route shows not-found after guard fallback', async () => {
    const originalPathname = location.pathname;
    history.replaceState({}, '', originalPathname);

    const replaceSpy = vi.spyOn(history, 'replaceState');

    const outlet = document.createElement('div');
    const router = new Router(outlet);

    const guard = vi.fn().mockResolvedValue(false);
    const protectedLoader = vi.fn(async () => ({ default: vi.fn() }));
    router.register('/protected', protectedLoader, guard);

    await router.navigate('/protected');

    expect(guard).toHaveBeenCalledTimes(1);
    expect(protectedLoader).not.toHaveBeenCalled();
    expect(notFoundHandler).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledTimes(1);

    replaceSpy.mockRestore();
    history.replaceState({}, '', originalPathname);
  });
});
