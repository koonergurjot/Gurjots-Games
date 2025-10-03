# UI Overlay Asset Guide

This directory contains pixel-perfect overlay art that is shared by several games for HUDs, tutorials, and pause screens. The assets are intentionally exported at low resolutions so they can be scaled up crisply with CSS (`image-rendering: pixelated`).

## Quick reference

| Asset | Dimensions | Purpose & notes |
| --- | --- | --- |
| `panel.png` | 256×128 | Decorative HUD frame used for copy-heavy overlays. Apply as an absolutely positioned `<img>` that stretches to the container bounds (see the `.pixel-panel__frame` rules in the Chess overlay). Works best when the parent container has padding to keep text off the frame border. |
| `star.png` | 64×64 | Accent sprite layered above `panel.png`. The Chess overlay uses `.pixel-panel__star`, `.pixel-panel__star--top`, and `.pixel-panel__star--bottom` utility classes to position the badge art at opposing corners. |
| `button.png` / `button-hover.png` | 128×64 | Retro-styled call-to-action buttons. Use them as CSS backgrounds or inline images, keeping hover-state swaps tied to focus/hover for accessibility. |
| `healthbar-empty.png` / `healthbar-filled.png` | 128×16 | Meter components for stamina/health style overlays. Layer the filled bar on top of the empty bar and clip/scale the width based on the current value. |
| [`../powerups/shield.png`](../powerups/shield.png) | 64×64 | Shared iconography for defensive power-ups. Match the pixel aesthetic of the UI elements when showing shield availability (e.g., Maze3D opponent shields). |

All files are authored with a 1px outline and 4–8px internal padding. When scaling, stick to whole-number multiples (2×, 3×, 4×, …) to preserve crisp edges.

## Where the assets are used

- **Chess (2D)** – `games/chess/index.html` wraps the HUD content in a `.pixel-panel` container and uses `panel.png` and `star.png` as layered `<img>` elements (`.pixel-panel__frame` and `.pixel-panel__star`). The surrounding CSS enforces `image-rendering: pixelated`, `object-fit: fill`, and absolute positioning so the frame scales cleanly with the panel content.
- **Chess3D** – `games/chess3d/index.html` keeps its controls in a `.chess3d-panel` stack and loads the shared overlay helper (`shared/juice/overlay.js`, via `<script … data-game="chess3d">`). That helper injects a full-viewport `<div class="gg-overlay"><canvas></canvas></div>` which sits above the stage for pixel particle effects. When Chess3D needs static instructions, reuse the `panel.png`/`star.png` pairing for stylistic parity with 2D Chess.
- **Maze3D** – `games/maze3d/index.html` mounts an always-on overlay container (`#overlay`) for matchmaking and pause controls, and likewise includes the shared juice overlay (`<script … data-game="maze3d">`). The DOM panel can adopt `panel.png` as a background image, while the [`../powerups/shield.png`](../powerups/shield.png) art keeps HUD shield indicators visually consistent with the pickups.

## Implementation tips

1. **Keep images separate from content.** Mount `<img>` tags for `panel.png`/`star.png` as siblings of the copy so screen readers ignore them (`aria-hidden="true"`).
2. **Scale via the container.** Set `width: 100%` on `panel.png` and adjust the parent width to control overall size. This avoids uneven scaling that can blur pixels.
3. **Use CSS classes consistently.** Reuse the `.pixel-panel__*` utilities from Chess for future overlays, and add hover/focus classes when swapping between `button.png` and `button-hover.png`.
4. **Align with power-up art.** When showing shield/boost states in overlays, reference the matching icons in [`assets/powerups/`](../powerups/) so the HUD matches the in-game pickups.

Following these practices keeps overlays consistent across Chess, Chess3D, Maze3D, and other future games that adopt the shared UI kit.
