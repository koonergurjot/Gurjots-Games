/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableGamepadHint } from '../shared/controls.js';

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
