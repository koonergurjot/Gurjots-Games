# Gurjot's Games — Clean Downloadable Build

This is a polished, static arcade hub you can drop onto Netlify or GitHub Pages. It fixes common issues (home not rendering, missing `games.json`, broken back button) and adds visual upgrades + theming.

## Highlights
- Robust `games.json` loading with a **graceful fallback** if the fetch fails
- **Search**, **tag filter**, and **sort** (A→Z / Z→A / Newest)
- **Theme packs**: Default, Retro CRT, Neon Cyberpunk, Minimal White (saved to localStorage)
- **Accessible, responsive** card grid and keyboard-friendly controls
- Shared `injectBackButton.js` to provide a consistent **Back to Hub** on game pages
- Three working games included:
  - Pong (canvas)
  - Snake (canvas)
  - 3D Box Playground (Three.js via CDN)

## Local Dev
Just open `index.html` in a local server (recommended). For example with Python:
```bash
python3 -m http.server 8080
```
Then visit http://localhost:8080

> If you open from `file://`, some browsers block fetch for `games.json`. The hub **falls back** to an embedded list so you can still test locally.

## Add a Game
1. Copy an existing folder under `/games/your-game/`.
2. Point `path` in `games.json` to your new `index.html` file.
3. Include `<script src="../../js/injectBackButton.js"></script>` inside your game page so players can return.

## Deploy
- **Netlify**: drag & drop this folder in the deploy UI or connect to Git.
- **GitHub Pages**: push the folder to a repo and enable Pages (root or `/docs`).

Enjoy!
