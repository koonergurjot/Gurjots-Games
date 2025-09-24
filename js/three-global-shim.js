// three-global-shim.js (classic) — exposes the ESM build on window.THREE
import * as THREE from '/vendor/three/0.161.0/build/three.module.js';

if (!('THREE' in window)) {
  Object.defineProperty(window, 'THREE', {
    value: THREE,
    configurable: false,
    writable: false,
  });
}

export default THREE;