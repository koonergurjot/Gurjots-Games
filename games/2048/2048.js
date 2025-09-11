// Minimal 2048 stub so the entry path resolves (no more 404).
// You can replace this with your real 2048 implementation later.
//
// Classic boot signature expected by the universal loader:
window.startGame = function(ctx) {
  var mount = document.querySelector(ctx && ctx.mount || '#game-root');
  if (!mount) {
    // Fallback: create a container if game-root isn't present
    mount = document.createElement('div');
    mount.id = 'game-root';
    document.body.appendChild(mount);
  }
  // Simple placeholder UI
  mount.innerHTML = [
    '<div style="display:grid;place-items:center;min-height:70vh;gap:16px;text-align:center;font-family:system-ui,Segoe UI,Roboto,Arial">',
    '  <div style="font-size:28px;font-weight:700">2048 — Placeholder Loaded</div>',
    '  <div style="max-width:640px;color:#566">This is a temporary entry file (<code>/games/2048/2048.js</code>) to stop 404s.',
    '  Replace it with the real game later. The loader is working.</div>',
    '  <button id="btn" style="padding:10px 16px;border-radius:10px;border:1px solid #99a;background:#eef">OK</button>',
    '</div>'
  ].join('');

  var btn = document.getElementById('btn');
  if (btn) btn.onclick = function(){ alert('2048 placeholder running. Replace this file with the real game when ready.'); };
};
