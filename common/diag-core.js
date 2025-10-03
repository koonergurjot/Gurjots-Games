(function(){
  try {
    const doc = document;
    if (!doc) return;
    const current = doc.currentScript;
    const script = doc.createElement('script');
    script.defer = true;
    script.src = '/games/common/diag-core.js';
    if (current && current.parentNode) {
      current.parentNode.insertBefore(script, current.nextSibling);
    } else {
      (doc.head || doc.documentElement || doc.body || doc).appendChild(script);
    }
  } catch (err) {
    console.warn('[diag-core proxy] failed to load /games/common/diag-core.js', err);
  }
})();
