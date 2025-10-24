/* @vitest-environment jsdom */
import { test, expect, vi } from 'vitest';
import { Controls } from '../src/runtime/controls.ts';

test('touchstart listeners are non-passive', () => {
  const spy = vi.spyOn(HTMLElement.prototype, 'addEventListener');
  const c = new Controls();
  const touch = spy.mock.calls.filter(c => c[0] === 'touchstart');
  expect(touch.some(c => c[2] && (c[2] as any).passive === false)).toBe(true);
  c.dispose();
  spy.mockRestore();
});

test('adding mappings for a second player does not crash on keydown', () => {
  const c = new Controls();
  c.setMapping('a', 'KeyX', 1);
  const handler = vi.fn();
  expect(() => c.on('a', handler, 1)).not.toThrow();
  expect(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }))).not.toThrow();
  expect(handler).toHaveBeenCalledTimes(1);
  c.dispose();
});

test('non-contiguous player mappings skip missing entries safely', () => {
  const c = new Controls();
  c.setMapping('jump', 'KeyJ', 2);
  const handler = vi.fn();
  c.on('jump', handler, 2);
  expect(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' }))).not.toThrow();
  expect(handler).toHaveBeenCalledTimes(1);
  c.dispose();
});

test('dispose removes listeners', () => {
  const addSpy = vi.spyOn(window, 'addEventListener');
  const removeSpy = vi.spyOn(window, 'removeEventListener');
  const c = new Controls();
  document.body.appendChild(c.element!);
  const downHandler = addSpy.mock.calls.find(c => c[0] === 'keydown')[1];
  const upHandler = addSpy.mock.calls.find(c => c[0] === 'keyup')[1];
  c.dispose();
  expect(removeSpy).toHaveBeenCalledWith('keydown', downHandler, undefined);
  expect(removeSpy).toHaveBeenCalledWith('keyup', upHandler, undefined);
  expect(document.body.contains(c.element)).toBe(false);
  addSpy.mockRestore();
  removeSpy.mockRestore();
});

test('touch buttons toggle each code in array mappings', () => {
  const c = new Controls({ map: { a: ['KeyZ', 'KeyX'] } });
  const button = Array.from(c.element!.querySelectorAll('button')).find(b => b.textContent === 'A') as HTMLButtonElement;
  const state = (c as any).state as Map<string, boolean>;
  button.dispatchEvent(new Event('touchstart', { cancelable: true }));
  expect(state.get('KeyZ')).toBe(true);
  expect(state.get('KeyX')).toBe(true);
  button.dispatchEvent(new Event('touchend'));
  expect(state.get('KeyZ')).toBe(false);
  expect(state.get('KeyX')).toBe(false);
  c.dispose();
});

test('touch buttons respect mapping changes while pressed', () => {
  const c = new Controls({ map: { a: 'KeyZ' } });
  const button = Array.from(c.element!.querySelectorAll('button')).find(b => b.textContent === 'A') as HTMLButtonElement;
  const state = (c as any).state as Map<string, boolean>;
  button.dispatchEvent(new Event('touchstart', { cancelable: true }));
  expect(state.get('KeyZ')).toBe(true);
  c.setMapping('a', 'KeyX');
  expect(state.get('KeyZ')).toBe(false);
  expect(state.get('KeyX')).toBe(true);
  button.dispatchEvent(new Event('touchend'));
  expect(state.get('KeyZ')).toBe(false);
  expect(state.get('KeyX')).toBe(false);
  c.dispose();
});
