// Minimal bootstrap expected by multiple games.
// Load this first (before any game script).
(function () {
  if (window.GG) return;
  const GG = {};
  GG.version = "fixpack-v1";
  GG.log = (...args) => console.log("[GG]", ...args);
  GG.assert = (cond, msg) => { if (!cond) console.warn("[GG assert]", msg); };
  GG.raf = (fn) => requestAnimationFrame(fn);
  GG.now = () => performance.now();
  // simple event bus
  const listeners = {};
  GG.on = (evt, fn) => { (listeners[evt] ||= []).push(fn); };
  GG.emit = (evt, payload) => { (listeners[evt]||[]).forEach(f=>f(payload)); };
  window.GG = GG;
})();
