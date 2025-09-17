/**
 * No-op shim for 'console-signature' used by some games.
 * Prevents import failures in browsers without bundling.
 */
export function signature() { /* noop */ }
export default { signature };