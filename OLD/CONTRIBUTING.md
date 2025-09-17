# Contributing

Thank you for considering a contribution.

1. Fork the repository and create your branch.
2. Run `npm test` to ensure the test suite passes.
3. Submit a pull request using the template.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## How to add a new game

1. Create a new folder under `games/<slug>` containing your HTML entry point and game scripts.
2. Register the game in `games.json` so it appears in the library.
3. Export `init()` and `dispose()` functions from your main module. `init()` should boot the game, while `dispose()` must remove event listeners, timers, and DOM nodes.
4. Use helpers in `shared/` for consistent controls and UI. Most games import `shared/controls.js` to wire keyboard, touch, and gamepad input.

## How to test a game

Run the automated checks before opening a pull request:

```bash
npm run health       # verifies game metadata and assets
npm test             # runs the test suite
```

## Common errors & quick fixes

- **Game never cleans up resources** – Ensure `dispose()` removes listeners and stops loops.
- **Controls behave differently across games** – Import and use `shared/controls.js` instead of implementing custom input handlers.
- **Health check fails** – Confirm the game is listed in `games.json` and all referenced files exist.
