// Utility helpers to use inside games (optional)
export function postScore(score){ try{ parent.postMessage({type:'GAME_SCORE', score}, '*'); }catch{} }
export function ready(){ try{ parent.postMessage({type:'GAME_READY'}, '*'); }catch{} }
export function error(message){ try{ parent.postMessage({type:'GAME_ERROR', message}, '*'); }catch{} }

// Optional listeners for pause/mute/restart sent from shell
export function attachShellControls({ onPause, onResume, onRestart, onMute } = {}){
  window.addEventListener('message', (ev)=>{
    const d = ev.data||{};
    if (d.type==='GG_PAUSE') onPause && onPause();
    if (d.type==='GG_RESUME') onResume && onResume();
    if (d.type==='GG_RESTART') onRestart && onRestart();
    if (d.type==='GG_SET_MUTE') onMute && onMute(!!d.value);
  });
}
