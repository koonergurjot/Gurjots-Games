# Gurjot's Games — Loader & SW Patch Bundle

This bundle adds:
- A universal **game loader with on-screen diagnostics** (`js/game-loader.js`).
- A **network-first rule for JavaScript** in `sw.js`, so stale caches stop breaking fresh game code.
- A safe **patch script** that injects the minimal changes into your existing repo (with `.bak` backups).

## What this fixes
- Clicking a game but nothing starts (bad slug / wrong entry path / missing export).
- Works locally but not on Netlify (case/caching/path issues).
- Games load with stale code after deploy (service worker cache).

## Files in this bundle
```
scripts/apply-patches.js   # Node script to patch your repo files in-place (creates .bak backups)
js/game-loader.js          # New loader with friendly error panel & module/classic support
README.md
```

## How to use (2 minutes)

1. **Download & unzip** this bundle at the root of your `Game` repo (same folder where `game.html` and `sw.js` live).

2. **Run the patch script** (requires Node 16+):
```bash
# from the repo root
node scripts/apply-patches.js
# (optional dry run)
DRY=1 node scripts/apply-patches.js
```

What it does:
- Copies `js/game-loader.js` into your repo.
- Updates `game.html` to ensure:
  - `<meta name="viewport" ...>` exists.
  - A `<div id="game-root">` mount is present.
  - `<script src="/js/game-loader.js"></script>` is included before `</body>`.
- Appends a network-first JS fetch handler to `sw.js` (if one isn’t already present).
- Creates backups as `game.html.bak` and `sw.js.bak` before writing.

3. **Run locally** (any static server):
```bash
npx serve .
# then open: http://localhost:3000/game.html?id=<slug>
```

4. **Deploy (Netlify)** and hard-refresh once so the updated Service Worker activates.

## Notes
- The loader supports **both** `module` (`type="module"` imports) and classic scripts with globals. In `games.json`, set `"module": true` for ES modules; omit/false for globals.
- If a game doesn’t expose a recognizable boot function, add one of:
  - `export default (ctx) => {...}` **or** `export function init(ctx){...}` for modules
  - `window.GameInit = (ctx) => {...}` **or** `window.startGame = (ctx) => {...}` for classic scripts

## Rollback
Use the `.bak` files to restore originals:
```bash
mv game.html.bak game.html
mv sw.js.bak sw.js
rm -f js/game-loader.js
```

---

**Tip:** After this patch, when a game fails to start you’ll see a red diagnostic panel at the bottom with the exact cause (bad slug, 404 entry, missing export, etc.).
