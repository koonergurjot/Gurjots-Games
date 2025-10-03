# Diagnostics migration guide

Games that previously pulled in `shared/diagnostics.js` or the legacy
`diag-autowire.js` loader should switch to the slimmer
`games/common/diag-adapter.js` helper. The adapter exposes a single
`pushEvent(category, payload)` API that forwards structured diagnostics to the
shared capture shim (`diag-capture.js`) and the modern diagnostics UI.

## Why migrate?

- `shared/diagnostics.js` duplicated queue logic that now lives in the shared
  capture shim. The file is now a thin compatibility layer that only logs a
  deprecation warning.
- `diag-autowire.js` injected several scripts and attempted to manage legacy
  UIs. The adapter keeps the capture shim as the sole source of console, error
  and network instrumentation.
- `pushEvent` guarantees that payloads are normalised and reach the
  diagnostics overlay regardless of load order.

## Updating modules (`type="module"`)

1. Remove the `<script type="module" src="../../shared/diagnostics.js">` (or
   similar) tag from the game HTML.
2. Import the adapter where you previously referenced the shared diagnostics
   helper:

   ```js
   import { pushEvent } from '../games/common/diag-adapter.js';

   pushEvent('game', {
     level: 'info',
     message: '[my-game] bootstrap complete',
     details: { scene: 'intro' },
   });
   ```
3. Keep loading `/games/common/diag-capture.js` (either directly or through the
   shell) so console/error/network hooks remain active.

## Updating HTML-only integrations

If a title only injected scripts (for example via `diag-autowire.js`) without a
module pipeline, replace the legacy loader with a direct reference to the
capture shim and use the global helper when you need to emit manual events:

```html
<script src="/games/common/diag-capture.js" defer></script>
<script>
  window.__GG_DIAG_PUSH_EVENT__?.('game', {
    level: 'info',
    message: '[my-game] ready',
  });
</script>
```

The capture shim now installs `window.__GG_DIAG_PUSH_EVENT__` once it initialises.
Games can safely queue events before it is ready — the helper falls back to the
shared queue until the shim takes over.

## Additional notes

- The adapter returns the normalised entry, which can help during tests:
  `const entry = pushEvent('game', { message: 'test' });`.
- Diagnostics adapters registered through
  `games/common/diagnostics/adapter.js` can continue to use `pushEvent` to feed
  custom panes.
- `shared/diagnostics.js` will keep emitting a warning event until the module
  reference is removed.
