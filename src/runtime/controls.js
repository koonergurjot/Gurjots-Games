// Simple JS shim to replace controls.ts imports
// Provides no-op or minimal replacements so games don't crash

export function initControls() {
  console.log('[controls.js] initControls called - shim only');
}

export function handleInput() {
  // Placeholder: no-op input handling
}

export const Controls = {
  init: initControls,
  handle: handleInput
};
