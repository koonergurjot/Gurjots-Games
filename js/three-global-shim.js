// Make THREE available as a global for non-ESM game code.
import * as THREE from "three";
if (!('THREE' in window)) {
  Object.defineProperty(window, 'THREE', { value: THREE, writable: false });
}
export default THREE;