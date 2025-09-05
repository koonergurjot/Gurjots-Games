
let worker = null;
let readyPromise = null;
let currentResolve = null;

export async function initEngine(){
  if (worker) return readyPromise;
  try{
    const url = new URL('./stockfish.worker.js', import.meta.url);
    worker = new Worker(url, { type: 'module' });
    readyPromise = new Promise((resolve)=>{
      const onMsg = (ev)=>{
        const data = ev.data || {};
        if (data.type === 'ready'){
          worker.removeEventListener('message', onMsg);
          resolve();
        }
      };
      worker.addEventListener('message', onMsg);
    });
  }catch(e){
    console.warn('[Chess3D] Stockfish worker not found. AI disabled.', e);
    worker = null;
    readyPromise = Promise.resolve();
  }
  return readyPromise;
}

export async function requestBestMove(fen, {depth=10, skill=4}={}){
  if (!worker) return { uci: null };
  await initEngine();
  return new Promise((resolve) => {
    const onMsg = (ev)=>{
      const data = ev.data || {};
      if (data.type === 'bestmove'){
        worker.removeEventListener('message', onMsg);
        currentResolve = null;
        resolve({ uci: data.uci });
      }
    };
    currentResolve = () => {
      worker.removeEventListener('message', onMsg);
      resolve({ uci: null });
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ type:'position', fen });
    worker.postMessage({ type:'go', depth, skill });
  });
}

export function cancel(){
  if (!worker) return;
  worker.postMessage({ type:'stop' });
  if (currentResolve) currentResolve();
  currentResolve = null;
}
