/**
 * Idempotent DOM preflight: create common nodes games expect.
 * Safe to run multiple times.
 */
(function(){
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
      try { window.parent && window.parent.postMessage({type:'GAME_ERROR', slug: slug, message: (kind?('['+kind+'] '):'') + String(msg||'error')}, '*'); } catch(e){}
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