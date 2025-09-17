// three-global-shim.js (classic) — never uses top-level import
(function(){
  if (window.THREE) return;
  var s=document.createElement('script');
  s.type='module';
  s.textContent = `
    import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
    if (!('THREE' in window)) Object.defineProperty(window, 'THREE', { value: THREE, configurable:false, writable:false });
    export default THREE;
  `;
  document.head.appendChild(s);
})();