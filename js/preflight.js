(function(){
  const ids = ["score","status","level","lives","hud","board","game","container","ui","scoreBoard","message","info"];
  for (const id of ids) {
    if (!document.getElementById(id)) {
      const el = document.createElement("div");
      el.id = id;
      if (id === "hud") el.style.position = "fixed";
      document.body.appendChild(el);
      console.warn("[preflight] created missing #"+id);
    }
  }
  const canvasIds = ["game-canvas","canvas","canvas2d"];
  for (const cid of canvasIds) {
    if (!document.getElementById(cid)) {
      const c = document.createElement("canvas");
      c.id = cid; c.width = 800; c.height = 600;
      document.body.appendChild(c);
      console.warn("[preflight] created missing canvas#"+cid);
    }
  }
})();