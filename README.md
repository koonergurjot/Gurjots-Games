
# Arcade Fix Pack

This pack merges the Phase‑3 header (themes + Stats/Cabinet links) with the **real game grid**,
cleans `games.json` (removes `?new=true`, adds `isNew` flags), adds a **single SW register** at the hub,
and provides an easy way to patch games with a **boot script** (back button + last played).
Also includes **placeholder thumbnails** for each game.

## How to use
1) Backup your repo (or work in a branch).
2) Copy **index.html** and **games.json** from this pack to your repo root (overwrite existing).
3) Copy **shared/game-boot.js** into your repo.
4) In each game's `index.html`, add this right before `</body>` (adjust path depth if needed):
   ```html
   <script type="module" src="../../shared/game-boot.js" data-slug="SLUG_HERE"></script>
   ```
   This auto-injects the back button and records last played.
5) Put the provided placeholder thumbs in each game folder (they're at `games/<slug>/thumb.png` here).
6) Commit → deploy → hard refresh (Ctrl/Cmd+Shift+R).

Notes:
- The hub now ignores any `?new=true` in paths and uses `isNew` from the JSON to show ribbons.
- If you want to keep your existing SW, no change is required; we only register it globally from the hub.
