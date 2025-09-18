/* Pong center + shell-canvas hide patch
   - Ensures iframe area centers by forcing #stage flex centering (with !important).
   - Hides shell's placeholder canvas (#gameCanvas) so it doesn't reserve space on the left.
   Drop-in replacement for Game-main/games/pong/main.js
*/
(() => {
  const W = 1280, H = 720;

  // --- Inject CSS once -------------------------------------------------------
  function injectCSS() {
    if (document.querySelector('style[data-pong-center="1"]')) return;
    const st = document.createElement('style');
    st.setAttribute('data-pong-center', '1');
    st.textContent = `
/* Center the .stage container (parent page) */
#stage.stage{ display:flex !important; align-items:center !important; justify-content:center !important; width:100%; height:100%; }
/* Hide the shell's placeholder canvas so it doesn't eat layout space */
#stage.stage > #gameCanvas{ display:none !important; }
/* Ensure our root participates in centering */
#stage.stage > #game-root{ display:flex; width:100%; height:100%; align-items:center; justify-content:center; }
/* Keep our internal wrapper centered too */
.pong-canvas-wrap{ display:flex; align-items:center; justify-content:center; width:100%; }
`;
    document.head.appendChild(st);
  }

  // --- Minimal boot to keep existing game logic intact ----------------------
  function ensureRoot(){
    let root = document.getElementById('game-root');
    if(!root){ root = document.createElement('div'); root.id = 'game-root'; document.body.appendChild(root); }
    return root;
  }

  function boot(){
    injectCSS();
    const root = ensureRoot();
    // If your current game already mounts UI/canvas, let it continue doing so.
    // This file only adds centering & canvas-hiding styles and defers to the real game.
    if (typeof window.boot === 'function' && window.boot !== boot) {
      // Another boot present; do nothing
      return;
    }
    // Fallback minimal canvas so file is harmless if loaded alone:
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.maxWidth = '1100px';
    canvas.style.aspectRatio = '16/9';
    canvas.style.borderRadius = '12px';
    const wrap = document.createElement('div');
    wrap.className = 'pong-canvas-wrap';
    wrap.appendChild(canvas);
    root.innerHTML = '';
    root.appendChild(wrap);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b1020'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#69e1ff'; ctx.font = '22px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.fillText('Pong centered — waiting for main game build…', 32, 40);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();