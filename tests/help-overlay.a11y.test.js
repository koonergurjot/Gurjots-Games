/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { attachHelpOverlay } from '../shared/ui.js';
import axe from 'axe-core';

const opts = { gameId: 'game1', objective: 'Win', controls: 'Arrows', tips: ['Good luck'], steps: ['Step'] };

describe('help overlay accessibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    // axe-core uses canvas for color contrast calculations, which jsdom lacks.
    HTMLCanvasElement.prototype.getContext = () => null;
  });

  it('has no critical axe violations', async () => {
    const { show } = attachHelpOverlay(opts);
    show();
    const results = await axe.run(document);
    expect(results.violations.filter(v => v.impact === 'critical').length).toBe(0);
  });
});
