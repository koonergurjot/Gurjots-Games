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

test('dispose removes listeners', () => {
  const addSpy = vi.spyOn(window, 'addEventListener');
  const removeSpy = vi.spyOn(window, 'removeEventListener');
  const c = new Controls({ touch: false });
  const downHandler = addSpy.mock.calls.find(c => c[0] === 'keydown')[1];
  const upHandler = addSpy.mock.calls.find(c => c[0] === 'keyup')[1];
  c.dispose();
  expect(removeSpy).toHaveBeenCalledWith('keydown', downHandler, undefined);
  expect(removeSpy).toHaveBeenCalledWith('keyup', upHandler, undefined);
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
