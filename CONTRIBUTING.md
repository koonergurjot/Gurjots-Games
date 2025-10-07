# Contributing

Thank you for considering a contribution.

1. Fork the repository and create your branch.
2. Run `npm test` to ensure the test suite passes.
3. Submit a pull request using the template.
   - Use a descriptive pull request title that summarizes your change. Avoid placeholder titles such as "Update name in Wrangler configuration file to match deployed Worker."

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## How to add a new game

1. Create a new folder under `games/<slug>` containing your HTML entry point and game scripts.
2. Register the game in `games.json` so it appears in the library, then run `npm run sync:games` to regenerate the read-only `public/games.json` copy.
3. Export `init()` and `dispose()` functions from your main module. `init()` should boot the game, while `dispose()` must remove event listeners, timers, and DOM nodes.
4. Use helpers in `shared/` for consistent controls and UI. Most games import `shared/controls.js` to wire keyboard, touch, and gamepad input.

## How to test a game

Run the automated checks before opening a pull request:

```bash
npm run health       # verifies game metadata and assets
npm test             # runs the test suite
```

## Game Doctor continuous integration check

Every push and pull request triggers the **Game Doctor** GitHub Action, which runs `node tools/game-doctor.mjs --strict --baseline=health/baseline.json` and fails the
check when any game needs attention. If you need to re-run the check, open your pull request, switch to the **Checks** tab,
select **Game Doctor**, and click **Re-run**. The workflow uploads `health/report.json` and `health/report.md` as artifacts;
download them from the same check summary to review the full report.

When the catalog is stable and you want to acknowledge the current results as the new baseline, run `npm run doctor` locally,
review the generated `health/report.json`, then copy it to `health/baseline.json` and commit both files. This keeps the strict
CI run focused on new regressions instead of known issues.

## Common errors & quick fixes

- **Game never cleans up resources** – Ensure `dispose()` removes listeners and stops loops.
- **Controls behave differently across games** – Import and use `shared/controls.js` instead of implementing custom input handlers.
- **Health check fails** – Confirm the game is listed in `games.json` and all referenced files exist.
- **Catalog drift** – Never edit `public/games.json` directly; update the root `games.json` and run `npm run sync:games` instead.
