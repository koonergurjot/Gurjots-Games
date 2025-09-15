/**
 * Minimal global GG helper to satisfy older games that expect it.
 * Provides tiny event bus + a few utils commonly referenced.
 */
const GG = window.GG || {};
const listeners = {};
GG.on = (evt, fn) => ((listeners[evt] ||= []).push(fn), () => {
  const i = listeners[evt].indexOf(fn); if (i >= 0) listeners[evt].splice(i,1);
});
GG.emit = (evt, data) => (listeners[evt] || []).forEach(fn => { try { fn(data); } catch(e){ console.error(e); } });
GG.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
GG.rand = (lo=0, hi=1) => lo + Math.random() * (hi - lo);
GG.randInt = (lo, hi) => Math.floor(GG.rand(lo, hi + 1));
GG.now = () => performance.now();
GG.assert = (cond, msg='assertion failed') => { if (!cond) { console.warn(msg); } };
if (!window.GG) Object.defineProperty(window, 'GG', { value: GG, writable: false });
export default GG;