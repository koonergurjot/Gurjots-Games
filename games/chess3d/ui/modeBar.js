const MODE_KEY = 'chess3d.mode';
const DIFF_KEY = 'chess3d.difficulty';

export function getMode(){
  return localStorage.getItem(MODE_KEY) || 'pvp';
}

export function getDifficulty(){
  const val = parseInt(localStorage.getItem(DIFF_KEY), 10);
  if (Number.isNaN(val)) return 4;
  return Math.min(8, Math.max(1, val));
}

export function mountModeBar(container,{onChange}={}){
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';

  const modes = [
    { value: 'pvp', label: 'PvP' },
    { value: 'aiw', label: 'Vs AI (Human White)' },
    { value: 'aib', label: 'Vs AI (Human Black)' },
  ];
  const currentMode = getMode();
  modes.forEach(({value,label})=>{
    const lbl = document.createElement('label');
    lbl.style.display = 'flex';
    lbl.style.alignItems = 'center';
    lbl.style.gap = '2px';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'mode';
    input.value = value;
    if (currentMode === value) input.checked = true;
    input.onchange = ()=>{
      localStorage.setItem(MODE_KEY, input.value);
      if (onChange) onChange();
    };
    lbl.appendChild(input);
    lbl.appendChild(document.createTextNode(label));
    wrap.appendChild(lbl);
  });

  const diffLbl = document.createElement('label');
  diffLbl.textContent = 'Difficulty';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '1';
  range.max = '8';
  range.value = String(getDifficulty());
  range.oninput = ()=>{
    localStorage.setItem(DIFF_KEY, range.value);
    if (onChange) onChange();
  };
  diffLbl.appendChild(range);
  wrap.appendChild(diffLbl);

  container.appendChild(wrap);
}
