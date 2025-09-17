// js/thumb-fallback.js
(function () {
  function onReady(fn){ if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  onReady(function(){
    const imgs = document.querySelectorAll('img[data-game-thumb], img.game-thumb');
    imgs.forEach(img => {
      if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
      if (!img.getAttribute('width')) img.setAttribute('width', '320');
      if (!img.getAttribute('height')) img.setAttribute('height', '180');
      const placeholder = '/assets/placeholder-thumb.png';
      img.addEventListener('error', () => {
        if (img.dataset.fallbackApplied) return;
        img.dataset.fallbackApplied = '1';
        img.src = placeholder;
        img.alt = (img.alt || 'Game thumbnail') + ' (placeholder)';
      }, { once: true });
    });
  });
})();
