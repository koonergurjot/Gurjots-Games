# Diagnostics adapters

Per-game diagnostics adapters allow a title to integrate with the shared
`diag-core` overlay. Adapters expose gameplay specific hooks (so the
overlay can react to what the game is doing) and optional control APIs (so
QA can poke at the running game directly from diagnostics tools).

Hosts can customise the overlay bootstrap through `window.__GG_DIAG_OPTS`.
Setting `suppressButton: true` prevents the floating diagnostics button
from being injected so an embedding shell can expose its own trigger while
still opening the modal via `window.__GG_DIAG.open()`.

## Registering an adapter

Use `registerGameDiagnostics(slug, adapter)` from
`games/common/diagnostics/adapter.js` to register an adapter while loading a
game shell. The `slug` must match the value assigned to
`document.body.dataset.gameSlug` by the shell.

```js
import { registerGameDiagnostics } from "../common/diagnostics/adapter.js";

registerGameDiagnostics("cool-game", {
  hooks: {
    onReady(ctx) {
      // Called after the Summary panel has been created.
    },
    onStateChange(ctx) {
      // Inspect ctx.summary for status changes, add custom UI, etc.
    },
  },
  api: {
    start() { /* begin gameplay */ },
    pause() { /* pause */ },
    getScore() { return window.game?.score ?? 0; },
    getEntities() { return window.game?.entities ?? []; },
  },
});
```

The module also exports `getGameDiagnostics(slug)` and
`subscribe(listener)`; they are used internally by `diag-core` but can be
used by tests if necessary.

## Hook contract

All hooks are optional. `diag-core` only calls hooks that are provided and
functions. Hooks receive a single `context` object with the following
fields:

| Field | Description |
| ----- | ----------- |
| `slug` | Game slug detected from the shell. |
| `panel` | The Summary tab `<div>` element. |
| `summaryElement` | Root element of the Summary layout. |
| `summaryRefs` | Collection of DOM references that `diag-core` maintains
  (status badge, metrics, etc.). |
| `summary` | Latest summary snapshot (numbers, last error, etc.). |
| `previousSummary` | Snapshot captured before the most recent update, if
  available. |
| `error` | Provided to `onError` with the summary of the most recent
  error. |
| `score` | Provided to `onScoreChange` when a new score is detected. |
| `api` | The sanitized adapter API that `diag-core` exposes back to hooks. |
| `requestProbeRun(reason)` | Helper that asks `diag-core` to run a manual
  probe (see below). |
| `open`/`close`/`toggle` | Direct access to the diagnostics overlay
  controls. |

Hook semantics:

- **`onReady(context)`** – called once the Summary tab has been built.
  Adapters can use this to add custom UI, wire up buttons that call the
  API, or trigger an initial probe via `context.requestProbeRun()`.
- **`onStateChange(context)`** – called every time the diagnostics summary
  is refreshed. `context.summary` contains the latest snapshot and
  `context.previousSummary` contains the previous one (or `null`).
- **`onError(context)`** – fired when a new error is captured. Includes the
  same data as `onStateChange` plus `context.error` describing the failure.
- **`onScoreChange(context)`** – triggered when the adapter API’s
  `getScore()` function returns a value that differs from the last recorded
  value. The hook receives `context.score` and the latest summary.

## Adapter API surface

The API object is optional and may include any subset of the following
functions:

- `start()`, `pause()`, `resume()`, `reset()` – lifecycle helpers invoked by
  custom UI built on top of diagnostics.
- `getScore()` – should return the current score. The return value can be a
  number or any JSON serialisable object. Returning a `Promise` is allowed.
- `setDifficulty(level)` – allow diagnostics UI to change difficulty.
- `getEntities(options)` – should return the current entity list or any
  other structured snapshot that is useful when debugging. Promises are
  supported.

`diag-core` never calls the control functions automatically, but they are
re-exposed through the hook context so adapters can build buttons or custom
interactions.

### Manual probe runs

`requestProbeRun(label?, options?)` calls the adapter’s `getEntities()` API
and logs the result to the **Probes** tab. Diagnostics will add an info log
with the returned payload (`entities`) or an error log if the call throws.
Adapters can call this helper whenever they need a new snapshot (for
example in response to a custom button).

## Error handling

If a hook or API throws, diagnostics catches the exception, logs a warning
in the console, and keeps the overlay running. Returning rejected promises
from `getScore()` or `getEntities()` is supported – diagnostics will log a
probe failure and stop there.
