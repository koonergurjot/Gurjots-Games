# Arcade Fresh Starter

A minimal, **known-good** rebuild of your static arcade hub. Drop these files into your repo root to replace broken pieces without touching your existing `games/` or `games.json`.

## What's included
- `index.html` – clean hub that builds cards from `games.json` (if present) and fails gracefully.
- `styles.css` – minimal styling for cards, ribbons, badges, overlays.
- `sw.js` – simple, versioned service worker (no game hardcoding).
- `shared/ui.js` – injectBackButton, record/get last played, best score helpers, pause overlay, fullscreen.
- `shared/controls.js` – keyboard helpers + optional gamepad polling.
- `.github/workflows/pages.yml` – GitHub Pages deploy workflow.
- `tests/*` – small Vitest tests for new helpers.

## Safe install
1) Backup your current root files just in case.
2) Copy these files into your repo **root**, preserving folders.
3) **Delete** any old `shared/sw.js` (legacy/duplicate).  
4) Commit to `main`. Enable Pages: Settings → Pages → Source: **GitHub Actions**.
5) Hard refresh (Ctrl/Cmd+Shift+R). If you had older service workers, you might need an extra refresh.

## Local dev
- Serve statically: `python -m http.server 5173`
- Open: `http://localhost:5173`
- Tests: `npm i && npm test`

## Notes
- If `games.json` isn't found, the hub shows a friendly empty state instead of crashing.
- SW strategy is network-first for JSON/navigation and cache-first for static assets.