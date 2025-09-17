export function mountEvalBar(container){
  const wrap=document.createElement('div');
  wrap.style.display='flex';
  wrap.style.flexDirection='column';
  wrap.style.alignItems='stretch';
  wrap.style.gap='4px';
  wrap.style.width='180px';

  const barOuter=document.createElement('div');
  barOuter.style.height='12px';
  barOuter.style.background='#333';
  barOuter.style.border='1px solid #555';
  const barInner=document.createElement('div');
  barInner.style.height='100%';
  barInner.style.width='50%';
  barInner.style.background='#fff';
  barOuter.appendChild(barInner);
  wrap.appendChild(barOuter);

  const lineEl=document.createElement('div');
  lineEl.style.fontSize='12px';
  lineEl.style.minHeight='1.2em';
  wrap.appendChild(lineEl);

  container.appendChild(wrap);

  function update(scoreCp,lineSan){
    if(typeof scoreCp==='number'){
      const max=1000; // centipawns
      const val=Math.max(-max,Math.min(max,scoreCp));
      const pct=(val+max)/(2*max)*100;
      barInner.style.width=pct+'%';
    }else{
      barInner.style.width='50%';
    }
    lineEl.textContent=lineSan||'';
  }

  return { update, el: wrap };
}
