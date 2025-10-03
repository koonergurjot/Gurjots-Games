/**
 * Idempotent DOM preflight: create common nodes games expect.
 * Safe to run multiple times.
 */
(function(){
  var DIAG_SCRIPT_ID = 'gg-diag-autowire';
  var diagRequested = false;

  function findExistingDiagAnchor(){
    try {
      return document.querySelector('script[data-shell-diag], [data-shell-diag]');
    } catch (_) {
      return null;
    }
  }

  function computeDiagSrc(){
    try {
      var path = String(location.pathname || '');
      var markers = ['/gameshells/', '/games/'];
      for (var i = 0; i < markers.length; i += 1) {
        var idx = path.indexOf(markers[i]);
        if (idx !== -1) {
          return path.slice(0, idx) + '/games/common/diag-autowire.js';
        }
      }
    } catch (_) {}
    return '/games/common/diag-autowire.js';
  }

  function ensureDiag(requestedSrc){
    if (diagRequested) return;
    if (findExistingDiagAnchor()) {
      diagRequested = true;
      return;
    }
    diagRequested = true;
    try {
      var script = document.createElement('script');
      script.id = DIAG_SCRIPT_ID;
      script.defer = true;
      script.dataset.shellDiag = 'true';
      script.src = requestedSrc || computeDiagSrc();
      (document.head || document.documentElement || document.body || document).appendChild(script);
    } catch (_) {}
  }

  function need(id, tag, attrs){
    tag = tag || 'div';
    attrs = attrs || {};
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement(tag);
      el.id = id;
      for (var k in attrs) el[k] = attrs[k];
      document.body.appendChild(el);
      try { console.info('[preflight] created missing #'+id); } catch(e){}
    }
    return el;
  }
  need('status'); need('level'); need('lives'); need('board');
  need('game-root');
  var pinged = false;
  try {
    window.addEventListener('message', function(e){
      if (!e || !e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'GAME_READY' || e.data.type === 'GAME_ERROR') pinged = true;
      if (e.data.type === 'GG_ENABLE_DIAG') {
        if (typeof e.data.src === 'string') ensureDiag(e.data.src);
        else ensureDiag();
        if (e.data.slug) {
          try {
            window.GG = window.GG || {};
            if (window.GG && !window.GG.slug) {
              window.GG.slug = e.data.slug;
            }
          } catch(_){}
        }
      }
    });
  } catch(e){}
  setTimeout(function(){
    if (pinged) return;
    var slug = (window.GG && window.GG.slug) ||
               (document.body && document.body.dataset && document.body.dataset.slug) ||
               (new URLSearchParams(location.search).get('slug')) || 'game';
    try { window.parent && window.parent.postMessage({type:'GAME_READY', slug: slug, synthetic:true}, '*'); } catch(e){}
  }, 800);

  // ---- Diagnostics error forwarders (only once) ----
  try {
    var __ggDiagErrorSent = false;
    function sendDiagError(kind, msg) {
      if (__ggDiagErrorSent) return;
      __ggDiagErrorSent = true;
      var slug = (window.GG && window.GG.slug) ||
                 (document.body && document.body.dataset && document.body.dataset.slug) ||
                 (new URLSearchParams(location.search).get('slug')) || 'game';
      var detail = (kind?('['+kind+'] '):'') + String(msg||'error');
      try { window.parent && window.parent.postMessage({type:'GAME_ERROR', slug: slug, error: detail, message: detail}, '*'); } catch(e){}
    }
    window.addEventListener('error', function(e){
      var m = (e && (e.message || (e.error && e.error.message))) || 'Script error';
      sendDiagError('error', m);
    });
    window.addEventListener('unhandledrejection', function(e){
      var m = (e && (e.reason && (e.reason.message || e.reason))) || 'Unhandled promise rejection';
      sendDiagError('unhandledrejection', m);
    });
    // Patch console.error to surface fatal errors during bootstrap
    var _cerr = console.error;
    console.error = function(){
      try {
        var m = Array.prototype.map.call(arguments, function(a){ try{return typeof a==='string'?a:JSON.stringify(a);}catch(_){return String(a);} }).join(' ');
        if (/TypeError|ReferenceError|cannot|not defined|is not a constructor/i.test(m)) sendDiagError('console.error', m);
      } catch(_){}
      try { return _cerr.apply(console, arguments); } catch(_){}
    };
  } catch(_) {}
  // -----------------------------------------------

})();