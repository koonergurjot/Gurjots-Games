# Supplying bespoke game thumbnails

High quality thumbnails help each game stand out in catalogs and storefronts. The Game Doctor tooling now surfaces placeholder art usage as a warning so teams can quickly spot where bespoke imagery is still needed. This guide walks through replacing the shared placeholder thumbnail with custom art for each title.

## Where thumbnails live

Game Doctor searches for thumbnails in the following locations, in order:

1. `assets/thumbs/<slug>.png`
2. `games/<slug>/thumb.png`
3. `assets/placeholder-thumb.png`

If neither of the slug-specific files exist, the scanner falls back to `assets/placeholder-thumb.png` and emits a warning in the health report.

## Creating a custom thumbnail

1. Export a 512×512 PNG (square art works best) with transparency disabled.
2. Name the file after the game slug (for example, `pong` becomes `pong.png`).
3. Save the file to `assets/thumbs/<slug>.png`.
   - Alternatively, place the file beside the shell HTML at `games/<slug>/thumb.png` if you prefer to keep art with the game implementation.
4. Commit the new asset.

The Game Doctor report will automatically pick up the tailored art on the next run.

## Verifying locally

After adding thumbnails, run the health check locally:

```bash
npm run health:games
```

The summary now includes a "with warnings" count. If your game still references the placeholder art, you will see a ⚠️ warning entry under the game section with remediation guidance.

## Tips for better catalog polish

- Keep important details centered so they remain visible when cropped.
- Use bold silhouettes and minimal text for clarity at smaller sizes.
- Update thumbnails whenever the visual identity of the game changes.

Publishing bespoke thumbnails alongside your game ensures the catalog experience remains consistent and polished.
