import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.resolve(process.cwd(), 'games/common/diag-modal.css'), 'utf8');

// The closed diagnostics panel is transparent but still laid out 720px wide and
// centred, so anything inside it that takes pointer events covers the board of
// every game. A descendant setting pointer-events:auto receives clicks even when
// an ancestor sets pointer-events:none, so the backdrop's own rule cannot
// contain it -- the selector has to be scoped to the open state.
describe('diagnostics modal pointer capture', () => {
  it('only lets the panel take clicks while it is open', () => {
    const rule = css.match(/^([^{}]*\.gg-diag-modal)\s*\{[^}]*pointer-events:\s*auto/m);
    expect(rule, 'expected a rule enabling pointer events on .gg-diag-modal').toBeTruthy();
    expect(rule[1]).toMatch(/\[data-open="true"\]/);
  });

  it('hides the closed backdrop outright rather than only fading it', () => {
    const backdrop = css.match(/\.gg-diag-backdrop\s*\{([^}]*)\}/);
    expect(backdrop).toBeTruthy();
    expect(backdrop[1]).toMatch(/visibility:\s*hidden/);

    const open = css.match(/\.gg-diag-backdrop\[data-open="true"\]\s*\{([^}]*)\}/);
    expect(open).toBeTruthy();
    expect(open[1]).toMatch(/visibility:\s*visible/);
  });
});
