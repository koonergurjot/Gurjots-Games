import * as logic from '../logic.js';
export function mountMoveList(container,{onJump}={}){
  const wrap=document.createElement('div');
  wrap.style.display='flex';
  wrap.style.flexDirection='column';
  wrap.style.alignItems='flex-start';
  wrap.style.gap='4px';

  const list=document.createElement('ol');
  list.style.maxHeight='200px';
  list.style.overflowY='auto';
  wrap.appendChild(list);

  const controls=document.createElement('div');
  controls.style.display='flex';
  controls.style.gap='4px';
  const btnUndo=document.createElement('button'); btnUndo.textContent='Undo';
  const btnRedo=document.createElement('button'); btnRedo.textContent='Redo';
  controls.appendChild(btnUndo); controls.appendChild(btnRedo);
  wrap.appendChild(controls);

  container.appendChild(wrap);

  let index=logic.historySAN().length;

  function refresh(){
    const moves=logic.historySAN();
    list.innerHTML='';
    moves.forEach((san,i)=>{
      const li=document.createElement('li');
      li.textContent=san;
      li.style.cursor='pointer';
      li.onclick=()=>{ if(onJump) onJump(i+1); };
      list.appendChild(li);
    });
  }

  function setIndex(i){ index=i; }

  btnUndo.onclick=()=>{ if(index>0 && onJump) onJump(index-1); };
  btnRedo.onclick=()=>{ const moves=logic.historySAN(); if(index<moves.length && onJump) onJump(index+1); };

  refresh();
  return { refresh, setIndex };
}
