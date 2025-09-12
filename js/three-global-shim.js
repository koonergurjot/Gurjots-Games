// If a game expects window.THREE, load module and assign global.
(async function(){
  if (!window.THREE) {
    const mod = await import('three');
    window.THREE = mod;
    console.log('[hotfix] window.THREE is now available');
  }
})();
