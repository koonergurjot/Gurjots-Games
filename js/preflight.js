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
})();