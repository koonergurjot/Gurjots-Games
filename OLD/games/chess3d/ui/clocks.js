export function mountClocks(container,{onFlag}={}){
  const wrap=document.createElement('div');
  wrap.style.display='flex';
  wrap.style.alignItems='center';
  wrap.style.gap='4px';

  const select=document.createElement('select');
  [3,5,10,30].forEach(m=>{
    const opt=document.createElement('option');
    opt.value=String(m);
    opt.textContent=`${m}+0`;
    select.appendChild(opt);
  });
  wrap.appendChild(select);

  const wSpan=document.createElement('span');
  const bSpan=document.createElement('span');
  wrap.appendChild(wSpan);
  wrap.appendChild(bSpan);

  const btnPause=document.createElement('button');
  btnPause.textContent='Pause';
  wrap.appendChild(btnPause);

  container.appendChild(wrap);

  let times={w:0,b:0};
  let active=null;
  let timer=null;
  let last=0;
  let paused=false;

  function fmt(ms){
    const s=Math.max(0,Math.ceil(ms/1000));
    const m=Math.floor(s/60);
    const sec=String(s%60).padStart(2,'0');
    return `${m}:${sec}`;
  }

  function update(){
    wSpan.textContent=fmt(times.w);
    bSpan.textContent=fmt(times.b);
  }

  function tick(){
    if(!active) return;
    const now=Date.now();
    const diff=now-last; last=now;
    times[active]-=diff;
    if(times[active]<=0){
      times[active]=0;
      const side=active;
      clearInterval(timer); timer=null; active=null;
      update();
      if(onFlag) onFlag(side);
      return;
    }
    update();
  }

  function startTurn(side){
    if(paused) return;
    active=side;
    last=Date.now();
    if(timer) clearInterval(timer);
    timer=setInterval(tick,200);
  }

  function pause(){
    if(timer){ clearInterval(timer); timer=null; }
    paused=true; btnPause.textContent='Resume';
  }

  function resume(){
    if(!paused) return;
    paused=false; btnPause.textContent='Pause';
    if(active){ last=Date.now(); timer=setInterval(tick,200);} 
  }

  btnPause.onclick=()=>{ paused?resume():pause(); };

  function reset(){
    const mins=parseInt(select.value,10)||3;
    times.w=times.b=mins*60*1000;
    active=null; paused=false; btnPause.textContent='Pause';
    if(timer){ clearInterval(timer); timer=null; }
    update();
  }
  select.onchange=reset;
  reset();

  return { startTurn, pause, resume, reset };
}
