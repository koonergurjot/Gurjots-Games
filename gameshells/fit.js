/**
 * Fit a wrapper page's main canvas inside the iframe, preserving aspect ratio.
 *
 * The wrappers ship <canvas width=800 height=600>; on a phone that is wider than
 * the frame, so the board was cropped. This leaves the backing store and every
 * game coordinate alone and only changes the CSS box (so pointer code that maps
 * through getBoundingClientRect() keeps working). The aspect ratio follows the
 * canvas's own width/height attributes because several games resize their
 * backing store at start-up.
 *
 * Opt out per canvas with data-gg-no-fit.
 */
(function () {
  'use strict';
  var canvas = document.querySelector('canvas');
  if (!canvas || canvas.hasAttribute('data-gg-no-fit')) return;

  var style = document.createElement('style');
  style.textContent =
    'html,body{margin:0;width:100%;height:100%;overflow:hidden}' +
    'canvas.gg-fit{position:absolute;inset:0;margin:auto;display:block;' +
    'aspect-ratio:var(--gg-w,4)/var(--gg-h,3);' +
    'width:min(100vw,calc(100dvh*var(--gg-w,4)/var(--gg-h,3)))!important;height:auto!important}';
  document.head.appendChild(style);
  canvas.classList.add('gg-fit');

  function sync() {
    var w = canvas.width, h = canvas.height;
    if (w > 0 && h > 0) {
      canvas.style.setProperty('--gg-w', String(w));
      canvas.style.setProperty('--gg-h', String(h));
    }
  }
  sync();
  new MutationObserver(sync).observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
})();
