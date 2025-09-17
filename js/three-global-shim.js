// three-global-shim.js (classic) — never uses top-level import
(function(){
  if (window.THREE || window.__THREE_MODULE_LOADING__) return;
  window.__THREE_MODULE_LOADING__ = true;
  var s=document.createElement('script');
  s.type='module';
  s.textContent = `
    import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js?module';
    if (!('THREE' in window)) Object.defineProperty(window, 'THREE', { value: THREE, configurable:false, writable:false });
    delete window.__THREE_MODULE_LOADING__;
    export default THREE;
  `;
  s.addEventListener('error', () => { delete window.__THREE_MODULE_LOADING__; });
  document.head.appendChild(s);
})();