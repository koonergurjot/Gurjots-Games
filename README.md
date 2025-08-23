# Arcade Hub Starter

A tiny Miniclip-style hub with multiple games. Static files only — perfect for GitHub Pages.

## Features
- Games listed in `games.json` render dynamically with search/filter.
- Each card shows your local high score (if supported).
- Offline ready via `manifest.json` + `sw.js`.
- Mobile friendly: touch controls for included games and a shared back button via `shared/ui.js`.

## Structure
```
/                (hub index.html + games.json + sw.js)
/shared/ui.js    (utility helpers)
/games/box3d/    → Three.js starter (WASD + jump, touch d-pad)
/games/pong/     → Simple Pong (canvas 2D, touch drag)
```

## Run locally
- VS Code: use **Live Server** on `index.html`, or
- Python: `python -m http.server 5173` then open http://localhost:5173

## Add a new game
1. Copy a folder in `/games/` and rename it.
2. Update its HTML/JS. Use `injectBackButton()` and `registerSW()` from `shared/ui.js`.
3. Append an entry in `games.json` so the hub picks it up.

## Deploy to GitHub Pages
This repo includes a Pages workflow. After pushing to the `main` branch, your site will auto-deploy.
Enable Pages: **Settings → Pages → Build and deployment → GitHub Actions**.
