
let worker = null;
export async function initEngine(){
  try{
    const url = new URL('./stockfish.worker.js', import.meta.url);
    worker = new Worker(url, { type: 'module' });
  }catch(e){
    console.warn('[Chess3D] Stockfish worker not found. AI disabled.', e);
    worker = null;
  }
}
export async function requestBestMove(fen, {depth=10, skill=4}={}){
  if (!worker) return { uci: null };
  return new Promise((resolve) => {
    const onMsg = (ev)=>{
      const data = ev.data || {};
      if (data.type === 'bestmove'){
        worker.removeEventListener('message', onMsg);
        resolve({ uci: data.uci });
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ type:'position', fen });
    worker.postMessage({ type:'go', depth, skill });
  });
}
export function cancel(){
  if (worker){
    worker.terminate();
    worker = null;
  }
}
