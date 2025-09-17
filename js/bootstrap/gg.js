(function () {
  if (window.GG) return;
  const GG = {};
  GG.version = "overlay-v3";
  GG.log = (...args) => console.log("[GG]", ...args);
  GG.assert = (cond, msg) => { if (!cond) console.warn("[GG assert]", msg); };
  GG.raf = (fn) => requestAnimationFrame(fn);
  GG.now = () => performance.now();
  const listeners = {};
  GG.on = (evt, fn) => { (listeners[evt] ||= []).push(fn); };
  GG.emit = (evt, payload) => { (listeners[evt]||[]).forEach(f=>f(payload)); };
  window.GG = GG;
})();