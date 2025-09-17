
// shared/juice/mobile.js
export function attachBottomSlider({onChange, label='Control'}){
  const wrap = document.createElement('div');
  wrap.className='gg-mobile-slider';
  Object.assign(wrap.style,{position:'absolute',left:'10%',bottom:'12px',width:'80%',zIndex:30});
  const input=document.createElement('input');
  input.type='range'; input.min='0'; input.max='1'; input.step='0.001'; input.value='0.5';
  input.addEventListener('input', ()=>onChange?.(parseFloat(input.value)));
  wrap.appendChild(input);
  document.body.appendChild(wrap);
  return ()=>wrap.remove();
}
export function attachButtons({buttons=[{id:'left'},{id:'right'},{id:'jump'}], onDown,onUp}={}){
  const bar=document.createElement('div');
  Object.assign(bar.style,{position:'absolute',bottom:'12px',left:'12px',right:'12px',display:'flex',gap:'12px',justifyContent:'space-between',zIndex:30});
  buttons.forEach(b=>{
    const el=document.createElement('button');
    el.textContent=b.id.toUpperCase();
    Object.assign(el.style,{padding:'12px 16px',borderRadius:'12px',opacity:0.8});
    el.addEventListener('touchstart',e=>{e.preventDefault();onDown?.(b.id);});
    el.addEventListener('touchend',e=>{e.preventDefault();onUp?.(b.id);});
    bar.appendChild(el);
  });
  document.body.appendChild(bar);
  return ()=>bar.remove();
}
