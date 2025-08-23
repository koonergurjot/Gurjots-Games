/* @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { enableGamepadHint, virtualButtons } from '../shared/controls.js';

describe('enableGamepadHint', () => {
  it('shows and hides the hint element on gamepad connect/disconnect', () => {
    const hint = document.createElement('div');
    hint.style.display = 'none';
    document.body.appendChild(hint);

    enableGamepadHint(hint);

    // simulate a gamepad connection
    window.dispatchEvent(new Event('gamepadconnected'));
    expect(hint.style.display).not.toBe('none');

    // simulate gamepad disconnection
    window.dispatchEvent(new Event('gamepaddisconnected'));
    expect(hint.style.display).toBe('none');
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
