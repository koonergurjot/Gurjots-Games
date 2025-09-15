(async function(){
  if (!window.THREE) {
    const mod = await import('three');
    window.THREE = mod;
    console.log('[hotfix] window.THREE ready');
  }
})();