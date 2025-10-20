/* @vitest-environment jsdom */
import { beforeEach, afterEach, expect, test, vi } from 'vitest';

vi.mock('../scripts/pages/not-found.js', () => ({
  default: vi.fn(),
}));

import { Router } from '../scripts/router.js';

let outlet;
let router;

beforeEach(() => {
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
