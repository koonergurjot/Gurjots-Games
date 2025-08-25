/* @vitest-environment jsdom */
import { test, expect, vi } from 'vitest';
import { standardAxesToDir, createGamepad } from '../shared/controls.js';

test('deadzone', () => {
  const pad = { axes: [0.1, 0.05] };
  expect(standardAxesToDir(pad)).toEqual({ dx:0, dy:0 });
});

test('createGamepad destroy stops polling and removes listeners', () => {
  const raf = vi.fn(() => 1);
  const caf = vi.fn();
  const origRAF = window.requestAnimationFrame;
  const origCAF = window.cancelAnimationFrame;
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = caf;

  const addSpy = vi.spyOn(window, 'addEventListener');
  const removeSpy = vi.spyOn(window, 'removeEventListener');

  const { destroy } = createGamepad(() => {});
  destroy();

  const startFn = addSpy.mock.calls.find(c => c[0] === 'gamepadconnected')[1];
  const stopFn = addSpy.mock.calls.find(c => c[0] === 'gamepaddisconnected')[1];

  expect(caf).toHaveBeenCalledWith(1);
  expect(removeSpy).toHaveBeenCalledWith('gamepadconnected', startFn);
  expect(removeSpy).toHaveBeenCalledWith('gamepaddisconnected', stopFn);

  addSpy.mockRestore();
  removeSpy.mockRestore();
  window.requestAnimationFrame = origRAF;
  window.cancelAnimationFrame = origCAF;
});
