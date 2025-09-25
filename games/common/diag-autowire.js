/* diag-autowire.js — add-only helper
   Purpose: ensure diagnostics overlay is present even if not manually added to each game page.
   Usage: <script src="../common/diag-autowire.js" data-game="pong"></script>
*/
(function(){
  try{
    var hasDiag = !!document.querySelector('script[src*="diag-upgrades.js"]');
    if (hasDiag) return;
    var slug = (document.currentScript && (document.currentScript.dataset.slug || document.currentScript.dataset.game)) || "";
    if (!slug) {
      try {
        var m = location.pathname.match(/\/games\/([^\/?#]+)/i);
        if (m) slug = m[1];
      } catch(_){}
    }
    var s = document.createElement("script");
    s.src = "../common/diag-upgrades.js";
    s.defer = true;
    s.dataset.slug = slug || "";
    document.head.appendChild(s);
    console.info("[diag-autowire] injected diag-upgrades.js", {slug:slug||"unknown"});
  }catch(e){
    console.error("[diag-autowire] failed", e);
  }
})();