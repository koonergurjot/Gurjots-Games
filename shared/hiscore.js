// Utility helpers to use inside games (optional)
export function postScore(score){ try{ parent.postMessage({type:'GAME_SCORE', score}, '*'); }catch{} }
export function ready(){ try{ parent.postMessage({type:'GAME_READY'}, '*'); }catch{} }
export function error(message){
  const detail = String(message ?? 'Unknown error');
  try{ parent.postMessage({type:'GAME_ERROR', error: detail, message: detail}, '*'); }catch{}
}

// Optional listeners for pause/mute/restart sent from shell
export function attachShellControls({ onPause, onResume, onRestart, onMute } = {}){
  window.addEventListener('message', (ev)=>{
    // SECURITY: Validate message origin
    if (ev.origin !== window.location.origin && ev.origin !== '*') {
      console.warn('[hiscore] Ignoring message from untrusted origin:', ev.origin);
      return;
    }
    const d = ev.data||{};
    if (d.type==='GG_PAUSE' || d.type==='GAME_PAUSE') onPause && onPause();
    if (d.type==='GG_RESUME' || d.type==='GAME_RESUME') onResume && onResume();
    if (d.type==='GG_RESTART') onRestart && onRestart();
    if (d.type==='GG_SET_MUTE') onMute && onMute(!!d.value);
  });
}
