# Barebones 3D Starter (Three.js)

A tiny, no-build-tool starter you can run in the browser. It gives you:
- A render loop, lights, ground plane
- A movable "player" (W/A/S/D + Space to jump)
- Orbit camera + soft follow
- A place to start adding your own gameplay

## Quick start

**Option A — VS Code Live Server (easiest)**
1. Open this folder in VS Code.
2. Install the "Live Server" extension if you don't have it.
3. Right-click `index.html` → **Open with Live Server**.

**Option B — Python**
```bash
# from inside this folder
python -m http.server 5173
# then open http://localhost:5173 in your browser
```

> Opening `index.html` directly with `file://` may be blocked by your browser when using ES modules. Use a local server as shown above.

## Files

- `index.html` — basic page + help overlay
- `main.js` — all the Three.js setup and a small game loop
- *(No build step. Three.js & OrbitControls come from a CDN.)*

## Next steps

- Swap OrbitControls for `PointerLockControls` (FPS)
- Load a level or character model via `GLTFLoader`
- Add basic enemy cubes and simple AI
- Integrate a physics engine later (ammo.js, cannon-es, rapier)
- Split your code into modules (`player.js`, `world.js`, `input.js`)

Enjoy!
