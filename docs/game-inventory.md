# Game Inventory

| slug | title | entry file | main files | shared utils | input methods | current known issues | suggested quick wins |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pong | Pong Classic | games/pong/index.html | pong.js, career.js | injectBackButton.js, canvasLoop.global.js, gameUtil.js, sfx.js | keyboard, touch | — (pause overlay toggled via **P**/**Esc**) | — |
| snake | Snake | games/snake/index.html | snake.js | injectBackButton.js, resizeCanvas.global.js, gameUtil.js, sfx.js, shared/leaderboard.js, shared/ui/hud.js, shared/skins/index.js, shared/fx/canvasFx.js | keyboard, touch | Delta-based `requestAnimationFrame` engine still rough; no game‑over screen | Add restart overlay for clearer game-over flow |
| tetris | Tetris | games/tetris/play.html | tetris.js, replay.js | injectBackButton.js, resizeCanvas.global.js, gameUtil.js, sfx.js | keyboard | No touch controls; update loop not delta‑based | Add swipe controls and separate update vs. render |
| breakout | Breakout | games/breakout/index.html | breakout.js, levels.js | injectBackButton.js, resizeCanvas.global.js, gameUtil.js, sfx.js, shared/leaderboard.js | keyboard, mouse | Lacks touch controls; pause only via **P** | Add touch paddle and ESC pause |
| chess | Chess (2D) | games/chess/index.html | chess.js, ai.js, net.js, puzzles.js, ratings.js | hud.js, sfx.js | mouse, minimal keyboard | No touch support | Use pointer events for touch play |
| chess3d | Chess 3D (Local) | games/chess3d/index.html | main.js, board.js, input.js | hud.js, sfx.js | pointer | No restart/pause UI | Add restart button and pause state |
| g2048 | 2048 | games/2048/index.html | g2048.js, net.js | hud.js, input.js, remapUI.js, perfHud.js | keyboard, touch | Game‑over reset unclear | Show explicit restart prompt |
| asteroids | Asteroids | games/asteroids/index.html | main.js, net.js | shared/game-boot.js | keyboard | No touch controls | Add virtual buttons for rotate/thrust/fire |
| maze3d | Maze 3D | games/maze3d/index.html | main.js, net.js | shared/ui.js, shared/achievements.js | keyboard | Keyboard only; pointer-lock UX rough | Add touch/gyro movement and clearer start prompt |
| platformer | Pixel Platformer | games/platformer/index.html | main.js, net.js | shared/ui.js, shared/achievements.js | keyboard, pointer | Pause via **P** only | Integrate shared pause overlay |
| runner | City Runner | games/runner/index.html | main.js, editor.js | shared/controls.js, shared/ui.js, shared/metrics.js, shared/achievements.js, shared/missions.js | keyboard, touch | Baseline smoke test covers boot/score/collision but mission progress + Runner.onScore hooks remain unverified | Extend coverage to assert mission rotation and score bridge events |
| shooter | Alien Shooter | games/shooter/index.html | main.js, net.js | shared/ui.js, shared/achievements.js | keyboard | No touch controls | Add tap/virtual joystick and ESC pause |

*Most games also include `sfx.js` for audio and `resizeCanvas.global.js`, `canvasLoop.global.js`, or `shared/ui.js` for layout helpers.*
