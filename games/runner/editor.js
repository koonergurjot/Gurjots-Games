// Simple level editor for Runner
// Provides drag-and-drop placement for obstacles and background layers

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas element #game not found');
}
const ctx = canvas.getContext('2d');
if (!ctx) {
  throw new Error('2D rendering context not available');
}

const level = {
  obstacles: [],
  background: { clouds: [], buildings: [], foreground: [] }
};

let current=null; let offX=0,offY=0;

function redraw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#93c5fd'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#333'; ctx.fillRect(0,canvas.height-60,canvas.width,60);
  ctx.fillStyle='#fff';
  level.background.clouds.forEach(c=>{ctx.beginPath();ctx.ellipse(c.x,c.y,c.w/2,c.h/2,0,0,Math.PI*2);ctx.fill();});
  ctx.fillStyle='#6b7280';
  level.background.buildings.forEach(b=>ctx.fillRect(b.x,canvas.height-60-b.h,b.w,b.h));
  ctx.fillStyle='#374151';
  level.background.foreground.forEach(f=>ctx.fillRect(f.x,canvas.height-60-f.h,f.w,f.h));
  ctx.fillStyle='#e11d48';
  level.obstacles.forEach(o=>ctx.fillRect(o.x,o.y,o.w,o.h));
}

function addItem(type,x,y){
  if(type==='obstacle') level.obstacles.push({x,y,w:30,h:30});
  if(type==='cloud') level.background.clouds.push({x,y,w:100,h:40});
  if(type==='building') level.background.buildings.push({x,w:80,h:120});
  if(type==='foreground') level.background.foreground.push({x,w:40,h:20});
  redraw();
}

document.querySelectorAll('.palette .item').forEach(it=>{
  it.draggable=true;
  it.addEventListener('dragstart',e=>e.dataTransfer.setData('type',it.dataset.type));
});

canvas.addEventListener('dragover',e=>e.preventDefault());
canvas.addEventListener('drop',e=>{
  e.preventDefault();
  const type=e.dataTransfer.getData('type');
  const rect=canvas.getBoundingClientRect();
  addItem(type,e.clientX-rect.left,e.clientY-rect.top);
});

canvas.addEventListener('mousedown',e=>{
  const rect=canvas.getBoundingClientRect();
  const x=e.clientX-rect.left; const y=e.clientY-rect.top;
  const all=[...level.obstacles.map(o=>({o,type:'obstacle'})),
             ...level.background.clouds.map(o=>({o,type:'cloud'})),
             ...level.background.buildings.map(o=>({o,type:'building'})),
             ...level.background.foreground.map(o=>({o,type:'foreground'}))];
  for(const entry of all){
    const o=entry.o; let top=o.y, h=o.h; let w=o.w; let left=o.x;
    if(entry.type==='building'){top=canvas.height-60-o.h;}
    if(entry.type==='foreground'){top=canvas.height-60-o.h;}
    if(x>=left&&x<=left+w&&y>=top&&y<=top+h){
      current=entry; offX=x-left; offY=y-top; return;
    }
  }
});
canvas.addEventListener('mousemove',e=>{
  if(!current) return;
  const rect=canvas.getBoundingClientRect();
  const x=e.clientX-rect.left; const y=e.clientY-rect.top;
  if(current.type==='obstacle'||current.type==='cloud'){
    current.o.x=x-offX; current.o.y=y-offY;
  } else {
    current.o.x=x-offX;
  }
  redraw();
});
['mouseup','mouseleave'].forEach(ev=>canvas.addEventListener(ev,()=>current=null));

function downloadLevel(){
  const blob=new Blob([JSON.stringify(level)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='runner-level.json'; a.click();
}

function importLevel(data){
  level.obstacles=data.obstacles||[];
  level.background=data.background||{clouds:[],buildings:[],foreground:[]};
  redraw();
  if(window.loadRunnerLevel) window.loadRunnerLevel(data);
}

const saveBtn=document.getElementById('saveLevelBtn');
const importBtn=document.getElementById('importLevelBtn');
const fileInput=document.getElementById('importLevelInput');
saveBtn?.addEventListener('click',downloadLevel);
importBtn?.addEventListener('click',()=>fileInput?.click());
fileInput?.addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return; f.text().then(t=>{try{importLevel(JSON.parse(t));}catch{}});
});

const community=document.getElementById('communitySelect');
if(community){
  fetch('./levels.json').then(r=>r.json()).then(list=>{
    list.forEach(l=>{const opt=document.createElement('option');opt.value=l.url;opt.textContent=l.name;community.appendChild(opt);});
  }).catch(()=>{});
  community.addEventListener('change',()=>{
    const url=community.value; if(!url) return;
    fetch(url).then(r=>r.json()).then(data=>importLevel(data));
  });
}

redraw();
window.getRunnerLevel=()=>level;

