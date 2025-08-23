# Arcade Hub Starter

A tiny Miniclip-style hub with multiple games. Static files only — perfect for GitHub Pages.

## Structure
```
/ (hub index.html)
/games/box3d/   → Three.js starter (WASD + jump, Orbit camera)
/games/pong/    → Simple Pong (canvas 2D)
```

## Deep link to a game
Link directly to a game from the hub using a query parameter:

```
/?game=pong   → /games/pong/
/?game=box3d  → /games/box3d/
```

If `game` is present in the URL, the hub will redirect straight to that game's folder.

## Run locally
- VS Code: use **Live Server** on `index.html`, or
- Python: `python -m http.server 5173` then open http://localhost:5173

## Add a new game
1. Copy one of the folders in `/games/` and rename it, e.g. `/games/maze/`
2. Update its HTML/JS. The hub automatically links via your new folder if you add a tile in the root `index.html`.

## Deploy to GitHub Pages
This repo includes a Pages workflow. After pushing to the `main` branch, your site will auto-deploy.
Enable Pages: **Settings → Pages → Build and deployment → GitHub Actions**.
