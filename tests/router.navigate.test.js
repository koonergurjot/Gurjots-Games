/* @vitest-environment jsdom */
import { beforeEach, afterEach, expect, test, vi } from 'vitest';

vi.mock('../scripts/pages/not-found.js', () => ({
  default: vi.fn(),
}));

import { Router } from '../scripts/router.js';

let outlet;
let router;

beforeEach(() => {
  vi.clearAllMocks();
  outlet = document.createElement('div');
  router = new Router(outlet);
});

afterEach(() => {
  document.body.innerHTML = '';
});

test('navigating to the current path does not push a new history entry', async () => {
  const handler = vi.fn();
  const loader = vi.fn(async () => ({ default: handler }));
  router.register('/foo', loader);

  const pushSpy = vi.spyOn(history, 'pushState');

  await router.navigate('/foo');
  expect(pushSpy).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledTimes(1);

  await router.navigate('/foo');
  expect(pushSpy).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledTimes(2);

  pushSpy.mockRestore();
});

test('hash-prefixed paths are normalized before resolving', async () => {
  const handler = vi.fn();
  const loader = vi.fn(async () => ({ default: handler }));
  router.register('/foo', loader);

  await router.resolve('#/foo');

  expect(loader).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledTimes(1);
});

test('when a loader rejects the router renders not found without pushing history', async () => {
  const notFoundModule = await import('../scripts/pages/not-found.js');
  const loaderError = new Error('boom');
  const loader = vi.fn(async () => {
    throw loaderError;
  });

  router.register('/error', loader);

  const pushSpy = vi.spyOn(history, 'pushState');

  await expect(router.navigate('/error')).resolves.toBeUndefined();

  expect(loader).toHaveBeenCalledTimes(1);
  expect(notFoundModule.default).toHaveBeenCalledTimes(1);
  expect(pushSpy).not.toHaveBeenCalled();

  pushSpy.mockRestore();
});
