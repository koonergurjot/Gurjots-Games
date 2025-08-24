/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableGamepadHint, virtualButtons } from '../shared/controls.js';

describe('enableGamepadHint', () => {
  let el;
  let mockPads;

  beforeEach(() => {
    document.body.innerHTML = '<span id="pad" hidden></span>';
    el = document.getElementById('pad');
    mockPads = [];
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => mockPads
    });
  });

  it('toggles hidden based on gamepad connection', () => {
    enableGamepadHint(el);
    expect(el.hidden).toBe(true);

    mockPads = [{}];
    window.dispatchEvent(new Event('gamepadconnected'));
    expect(el.hidden).toBe(false);

    mockPads = [];
    window.dispatchEvent(new Event('gamepaddisconnected'));
    expect(el.hidden).toBe(true);
  });
});

describe('virtualButtons', () => {
  it('reflects button states via read()', () => {
    const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'];
    const { element, read } = virtualButtons(codes);
    document.body.appendChild(element);

    for (const code of codes) {
      const button = element.querySelector(`button[data-k="${code}"]`);
      button.dispatchEvent(new Event('touchstart', { bubbles: true }));
      expect(read().get(code)).toBe(true);
      button.dispatchEvent(new Event('touchend', { bubbles: true }));
      expect(read().get(code)).toBe(false);
    }
  });
});
