/* diag-autowire.js (lightweight loader) */
(function(){
  const win = typeof window === 'undefined' ? null : window;
  const doc = win && win.document ? win.document : null;
  if (!win || !doc) return;

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
      script.src = src;
      if (script.setAttribute) script.setAttribute(marker, '');
      const parent = doc.head || doc.documentElement || doc.body;
      if (!parent || typeof parent.appendChild !== 'function') return;
      parent.appendChild(script);
    } catch (_err) {}
  };

  const resolveBase = () => {
    const getSrc = () => {
      try {
        const current = doc.currentScript;
        if (current && current.src) return current.src;
      } catch (_err) {}
      try {
        const byId = doc.querySelector ? doc.querySelector('#gg-diag-autowire') : null;
        if (byId && byId.src) return byId.src;
      } catch (_err) {}
      try {
        const scripts = doc.getElementsByTagName ? doc.getElementsByTagName('script') : [];
        for (let i = 0; scripts && i < scripts.length; i += 1) {
          const script = scripts[i];
          if (!script || !script.src) continue;
          if (script.src.indexOf('diag-autowire') !== -1) return script.src;
        }
      } catch (_err) {}
      return null;
    };

    const src = getSrc();
    if (src) {
      try {
        return new URL('.', src).href;
      } catch (_err) {}
    }
    try {
      const baseURI = doc.baseURI || (win.location && win.location.href) || '';
      if (baseURI) return new URL('./', baseURI).href;
    } catch (_err) {}
    return '';
  };

  const buildRootUrl = (path) => {
    if (!path) return null;
    const getBase = () => {
      try {
        if (win && win.location && win.location.href) return win.location.href;
      } catch (_err) {}
      try {
        if (doc && doc.baseURI) return doc.baseURI;
      } catch (_err) {}
      const base = resolveBase();
      return base || null;
    };
    const base = getBase();
    if (!base) return null;
    try {
      return new URL(path, base).toString();
    } catch (_err) {}
    return null;
  };

  onReady(() => {
    if (alreadyInitialized()) return;

    removeLegacyElements();

    const existingOpts = (() => {
      const opts = win.__GG_DIAG_OPTS;
      if (!opts || typeof opts !== 'object') return {};
      return opts;
    })();
    win.__GG_DIAG_OPTS = Object.assign({ suppressButton: true }, existingOpts);

    ensureScript(buildRootUrl('/games/common/diagnostics/report-store.js'), 'data-gg-diag-report');
    ensureScript(buildRootUrl('/games/common/diag-core.js'), 'data-gg-diag-core');
    ensureScript(buildRootUrl('/games/common/diag-capture.js'), 'data-gg-diag-capture');
  });
})();
