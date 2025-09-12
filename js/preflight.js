/**
 * Preflight DOM setup for games that assume certain IDs exist.
 * Create if missing: #score, #status, #level, #lives, #hud, #board, #game, #container
 * Also ensures a canvas#game-canvas exists.
 */
(function(){
  const ids = ["score","status","level","lives","hud","board","game","container"];
  for (const id of ids) {
    if (!document.getElementById(id)) {
      const el = document.createElement(id === "hud" ? "div" : "div");
      el.id = id;
      if (id === "hud") el.style.position = "fixed";
      document.body.appendChild(el);
      console.warn("[preflight] created missing #"+id);
    }
  }
  if (!document.getElementById("game-canvas")) {
    const c = document.createElement("canvas");
    c.id = "game-canvas";
    c.width = 800; c.height = 600;
    document.body.appendChild(c);
    console.warn("[preflight] created missing canvas#game-canvas");
  }
})();
