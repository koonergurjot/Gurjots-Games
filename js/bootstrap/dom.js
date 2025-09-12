// DOM helpers for game pages.
export function ensureElement(selector, fallbackTag = "div", attrs = {}) {
  let el = document.querySelector(selector);
  if (!el) {
    el = document.createElement(fallbackTag);
    Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
    document.body.appendChild(el);
    console.warn("[fixpack] created missing element", selector);
  }
  return el;
}

export function ensureCanvas(id = "game-canvas") {
  const canvas = ensureElement(`#${id}`, "canvas", { id });
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.error("[fixpack] Canvas.getContext returned null. Check browser support.");
  }
  return { canvas, ctx };
}
