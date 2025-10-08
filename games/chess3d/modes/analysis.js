import { evaluate, cancel } from "../ai/ai.js";
import * as logic from "../logic.js";
import Chess from "../../chess/engine/chess.min.js";

export function mountAnalysis(container,{clocks}={}){
  const btn=document.createElement('button');
  btn.textContent='Analysis';
  btn.style.opacity='0.8';
  container.appendChild(btn);

  let active=false;
  let polling=false;
  let evalUI=null;
  let paused=false;

  async function ensureUI(){
    if(evalUI) return evalUI;
    const { mountEvalBar } = await import('../ui/evalBar.js');
    evalUI = mountEvalBar(container);
    evalUI.el.style.display='none';
    return evalUI;
  }

  async function start(){
    await ensureUI();
    evalUI.el.style.display='';
    if(clocks && !paused){ clocks.pause(); paused=true; }
    polling=true;
    loop();
  }

  function stop(){
    polling=false;
    cancel();
    if(clocks && paused){ clocks.resume(); paused=false; }
    if(evalUI) evalUI.el.style.display='none';
  }

  async function loop(){
    if(!polling) return;
    const fen=logic.fen();
    const info=await evaluate(fen,{depth:12});
    if(!polling) return;
    const cp = info.mate!=null ? (info.mate>0?100000:-100000) : info.cp;
    const san=pvToSan(fen,info.pv);
    evalUI.update(cp,san);
    setTimeout(loop,1000);
  }

  function pvToSan(fen,pv){
    if(!pv) return '';
    const moves=pv.trim().split(/\s+/);
    const chess=new Chess(fen);
    const sans=[];
    for(const mv of moves){
      const from=mv.slice(0,2);
      const to=mv.slice(2,4);
      const promotion=mv.length>4?mv.slice(4,5):undefined;
      const res=chess.move({from,to,promotion});
      if(!res) break;
      sans.push(res.san);
    }
    return sans.join(' ');
  }

  btn.onclick=()=>{
    active=!active;
    btn.style.opacity=active?'1':'0.8';
    active?start():stop();
  };

  return { toggle: ()=>btn.onclick() };
}
