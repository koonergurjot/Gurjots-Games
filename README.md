
# Phase 3 — Visual/UX Polish Pack

This pack adds:
- **Theme Packs / Skins**: Retro CRT, Neon Cyberpunk, Minimal White with dynamic fonts, cards, and backgrounds. Includes basic unlocks.
- **Arcade Cabinet Mode**: Fullscreen kiosk mode that auto-rotates through games every 60s.
- **Stats Dashboard**: Shows play time by game, plays by day, and tokens earned using local Chart.js.

## Install (safe, incremental)
1) Copy **styles.themes.css** into your repo and **import it after** styles.css in pages that use themes.
2) Add **shared/themes.js** and **shared/metrics.js** to your `shared/` folder.
3) Replace or merge **index.html** additions (header buttons + theme chooser).
4) Add the new pages **cabinet.html** and **stats.html** to your root.
5) Commit & deploy. Hard refresh (Ctrl/Cmd+Shift+R).

## Game integration (optional but recommended)
To track session time and scores precisely from each game:
```html
<script type="module">
  import { startSessionTimer, endSessionTimer } from '../../shared/metrics.js';
  // when game loads
  startSessionTimer('SLUG_HERE');
  // when user exits / game over
  endSessionTimer('SLUG_HERE'); // this accumulates time for Stats
</script>
```
If you already call `saveScore`, stats will also aggregate tokens and score trends if desired.

## Unlocks (basic)
- **Neon Cyberpunk** unlocks after **5 total plays**.
- **Retro CRT** unlocks after **10 total plays**.
- **Minimal White** is available by default.
You can tweak thresholds in `shared/themes.js`.
