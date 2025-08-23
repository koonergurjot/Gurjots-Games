/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableGamepadHint, virtualButtons } from '../shared/controls.js';

describe('enableGamepadHint', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    navigator.getGamepads = undefined;
  });

  it('toggles visibility based on connected gamepads', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    navigator.getGamepads = () => [null];
    enableGamepadHint(el);
    expect(el.style.display).toBe('none');

    navigator.getGamepads = () => [{}];
    window.dispatchEvent(new Event('gamepadconnected'));
    expect(el.style.display).toBe('');

    navigator.getGamepads = () => [null];
    window.dispatchEvent(new Event('gamepaddisconnected'));
    expect(el.style.display).toBe('none');
  });
});

describe('virtualButtons', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    window.matchMedia = () => ({ matches: true });
  });

  it('creates buttons and reports pressed state', () => {
    const controls = virtualButtons({ left: true, jump: 'A' });
    const left = document.querySelector('button.vb-left');
    const jump = document.querySelector('button.vb-jump');
    expect(left).toBeTruthy();
    expect(jump).toBeTruthy();

    left.dispatchEvent(new Event('pointerdown'));
    expect(controls.read().left).toBe(true);
    left.dispatchEvent(new Event('pointerup'));
    expect(controls.read().left).toBe(false);
  });
});
