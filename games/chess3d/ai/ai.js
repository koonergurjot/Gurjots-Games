// Stockfish-based AI helper for Chess3D.
import { warn } from '../../../tools/reporters/console-signature.js';

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
    warn('chess3d', '[Chess3D] Stockfish worker not found. AI disabled.', e);
    worker = null;
    readyPromise = Promise.resolve();
  }
  return readyPromise;
}

export async function requestBestMove(fen, {depth=10, skill=4, movetime}={}){
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
    worker.postMessage({ type:'go', depth, skill, movetime });
  });
}

export async function evaluate(fen,{depth=12}={}){
  if (!worker) return { cp: null, mate: null, pv: null };
  await initEngine();
  return new Promise((resolve)=>{
    let lastInfo = null;
    const onMsg = (ev)=>{
      const data = ev.data || {};
      if (data.type === 'info') {
        lastInfo = data;
      } else if (data.type === 'bestmove') {
        worker.removeEventListener('message', onMsg);
        currentResolve = null;
        resolve({ cp: lastInfo?.cp ?? null, mate: lastInfo?.mate ?? null, pv: lastInfo?.pv || '' });
      }
    };
    currentResolve = ()=>{
      worker.removeEventListener('message', onMsg);
      resolve({ cp: null, mate: null, pv: '' });
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ type:'position', fen });
    worker.postMessage({ type:'go', depth });
  });
}

export function cancel(){
  if (!worker) return;
  worker.postMessage({ type:'stop' });
  if (currentResolve) currentResolve();
  currentResolve = null;
}
