# Runtime Asset Reference

This guide explains where runtime assets live in the repository and how to load them through the shared asset loader.

## Directory layout

| Location | Purpose | Notes |
| --- | --- | --- |
| `/assets` | Shared art, audio, icons, and UI elements used across games and shell views. | Served at build/run time as `/assets/...`. Organized by type (e.g., `backgrounds`, `sprites`, `audio`). |
| `/public` | Files served verbatim by the hosting platform (e.g., Netlify). | Use for assets that must be reachable without the app shell (favicons, marketing CSS). |
| `games/<slug>/assets` | Game-specific resources that should be bundled with that game. | Keep paths relative to the game entry point (e.g., `../../assets/...`). |

See the [asset manifest](./ASSETS-MANIFEST.json) for canonical metadata on every distributed file.

## Loading assets through the shared loader

All runtime code should go through `shared/assets.js` so failures are reported consistently and cached appropriately.

```js
import { loadImage, loadAudio, getCachedImage } from '/shared/assets.js';

async function setupHud() {
  // Use absolute paths so the loader can resolve against the application origin.
  const [panel, blip] = await Promise.all([
    loadImage('/assets/ui/panel.png', { slug: 'hud' }),
    loadAudio('/assets/audio/click.wav', { slug: 'hud' })
  ]);

  const cached = getCachedImage('/assets/ui/panel.png');
  // ...render HUD with panel and cached sprite...
}
```

**Key practices**

* Always pass a `slug` (game identifier) so loader errors can be traced back to the failing experience.
* Use root-relative URLs (`/assets/...` or `/public/...`) when calling the loader. It mirrors what goes into [`games.json`](../games.json) and other registries.
* For assets hosted next to a specific game, keep the relative import but still call the loader from runtime code (e.g., `loadImage('./assets/tileset.png', { slug: 'puzzler' })`).

## Maintaining the manifest

The manifest lives next to this document as [`ASSETS-MANIFEST.json`](./ASSETS-MANIFEST.json). When adding, removing, or replacing assets:

1. Update the manifest entry with the new SHA-256 checksum, MIME type, and usage notes.
2. Link the entry back to this document via the `documentation` field if a new asset family requires extra guidance.
3. Keep directory-specific README files in sync (for example, adding an overview inside `games/<slug>/assets` if usage is non-obvious).

The manifest exists to help automated tooling verify integrity and highlight unused media. Whenever you touch an asset, double-check both this README and the manifest stay aligned.
