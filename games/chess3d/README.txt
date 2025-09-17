
Chess 3D (Local) — drop-in folder

This folder is designed to work in your static multi-game repo without external CDNs.
What you still need to vendor locally:

1) games/chess3d/lib/three.module.js
2) games/chess3d/lib/OrbitControls.js (ESM that imports from ./three.module.js)
3) games/chess/engine/chess.min.js (chess.js single-file build)

After adding those, open games/chess3d/index.html.
If you see "Engine thinking…" later, you can integrate Stockfish via the AI stubs.
