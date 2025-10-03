/* diag-autowire.js (lightweight loader) */
(function(){
  const win = typeof window === 'undefined' ? null : window;
  const doc = win && win.document ? win.document : null;
  if (!win || !doc) return;

  const currentScript = (() => {
    try { return doc.currentScript || (function(){
      const scripts = doc.getElementsByTagName ? doc.getElementsByTagName('script') : [];
      return scripts && scripts.length ? scripts[scripts.length - 1] : null;
    })(); } catch (_err) { return null; }
  })();

  const scriptBase = (() => {
    try {
      if (currentScript && currentScript.src) {
        return new URL(currentScript.src, doc.baseURI).href;
      }
    } catch (_err) {}
    try {
      return new URL('./diag-autowire.js', doc.baseURI).href;
    } catch (_err) {}
    return null;
  })();

  const resolveUrl = (value) => {
    if (!value) return value;
    if (!scriptBase) return value;
    try { return new URL(value, scriptBase).href; } catch (_err) { return value; }
  };

  const alreadyInitialized = () => {
    const g = win.__GG_DIAG;
    if (g && (g.initialized || g.ready || g.core || g.loaded)) return true;
    try {
      if (doc.querySelector('script[data-gg-diag-core],script[data-gg-diag-capture],script[src*="diag-core"],script[src*="diag-capture"]')) {
        return true;
      }
    } catch (_err) {}
    return false;
  };

  if (alreadyInitialized()) return;

  const onReady = (fn) => {
    if (typeof fn !== 'function') return;
    if (doc.readyState === 'loading') {
      const handler = function(){
        if (doc.removeEventListener) doc.removeEventListener('DOMContentLoaded', handler);
        fn();
      };
      if (doc.addEventListener) {
        doc.addEventListener('DOMContentLoaded', handler);
      }
    } else {
      fn();
    }
  };

  const removeLegacyElements = () => {
    try {
      const selectors = [
        '#diagnostics',
        '.diagnostics-btn',
        '.gg-diagnostics',
        'button[data-gg-diag]',
        'button.gg-diagnostics',
        'a.gg-diagnostics',
        '[data-diag-copy]',
        '.gg-diag-copy'
      ];
      const elements = [];
      for (let i = 0; i < selectors.length; i += 1) {
        const selector = selectors[i];
        try {
          const found = doc.querySelectorAll ? doc.querySelectorAll(selector) : [];
          for (let j = 0; found && j < found.length; j += 1) {
            elements.push(found[j]);
          }
        } catch (_err) {}
      }
      let labeledButtons = [];
      try {
        const candidates = doc.querySelectorAll ? doc.querySelectorAll('button,a') : [];
        const items = [];
        for (let i = 0; candidates && i < candidates.length; i += 1) {
          const el = candidates[i];
          if (!el) continue;
          if (el.id === 'gg-diag-btn') continue;
          const text = typeof el.textContent === 'string' ? el.textContent.trim().toLowerCase() : '';
          if (text === 'diagnostics' || text === 'open diagnostics') {
            items.push(el);
          }
        }
        labeledButtons = items;
      } catch (_err) {}
      const preferred = (() => {
        try { return doc.getElementById ? doc.getElementById('gg-diag-btn') : null; } catch (_err) { return null; }
      })();
      const targets = elements.concat(labeledButtons);
      for (let i = 0; i < targets.length; i += 1) {
        const el = targets[i];
        if (!el || (preferred && el === preferred)) continue;
        try {
          if (typeof el.remove === 'function') {
            el.remove();
          } else if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
            el.parentNode.removeChild(el);
          }
        } catch (_err) {}
      }
    } catch (_err) {}
  };

  const ensureScript = (src, marker) => {
    if (!src || !doc.createElement) return;
    try {
      const existing = doc.querySelector ? doc.querySelector('script[' + marker + ']') : null;
      if (existing) return;
    } catch (_err) {}
    try {
      const script = doc.createElement('script');
      script.defer = true;
      script.src = resolveUrl(src);
      if (script.setAttribute) script.setAttribute(marker, '');
      const parent = doc.head || doc.documentElement || doc.body;
      if (!parent || typeof parent.appendChild !== 'function') return;
      parent.appendChild(script);
    } catch (_err) {}
  };

  onReady(() => {
    if (alreadyInitialized()) return;

    removeLegacyElements();

    win.__GG_DIAG_OPTS = { suppressButton: true };

    ensureScript('../common/diagnostics/report-store.js', 'data-gg-diag-report');
    ensureScript('../common/diag-core.js', 'data-gg-diag-core');
    ensureScript('../common/diag-capture.js', 'data-gg-diag-capture');
  });
})();
