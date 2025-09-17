# Force Refresh + Multi-path JSON Loader

Upload these files to your repo:
- `health/cache-reset.html` — visit once to unregister SW, clear caches, and hard-reload.
- `js/game-loader.js` — smarter loader that tries `/games.json`, `/public/games.json`, and `./games.json` (same folder) with cache-busting.
- `js/health-scan.js` — health page uses the same multi-path strategy.
- `games.json` — reference copy filled with entries.

## Steps (no IDE)

1) **Upload** files to the same paths in GitHub (create folders if missing).
2) Visit `https://<yoursite>/health/cache-reset.html` and click **Do it now**.
3) Open `https://<yoursite>/games.json?t=123` — ensure you see the updated JSON with `entry` fields.
4) Open `https://<yoursite>/health/?t=123` — rows should flip from SCHEMA failures.
5) Click a row to open `/game.html?id=<slug>`; if the loader shows a red box, follow the message (404 path or missing boot function).

If Netlify deploy path differs, the loader will also try `/public/games.json` and a local `./games.json` next to the page.
