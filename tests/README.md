# Test Suite Notes

## Runner smoke test

The `tests/runner.smoke.test.js` case boots the Runner game inside a JSDOM
environment, advances the animation loop manually, and verifies two critical
states:

1. The score increases after the engine starts (gameplay begins).
2. A forced collision via `window.loadRunnerLevel()` stops the engine and
   exposes the share button (gameplay ended).

## Running the smoke test

- `npm run test:smoke` – executes only the smoke test.
- `npm test` – runs the health check followed by the full Vitest suite
  (including the smoke test).
