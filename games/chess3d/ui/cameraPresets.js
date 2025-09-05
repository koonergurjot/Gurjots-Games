const CAM_KEY = 'chess3d.cameraPreset';

const presets = {
  overhead: { pos: [0, 12, 0.01] },
  angled: { pos: [6, 10, 6] },
  side: { pos: [10, 6, 0] }
};

function tweenCamera(camera, controls, pos, instant=false){
  const [x,y,z] = pos;
  if (instant){
    camera.position.set(x,y,z);
    camera.lookAt(0,0,0);
    controls?.update();
    return;
  }
  const start = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  const end = { x, y, z };
  const dur = 500;
  const t0 = performance.now();
  function step(t){
    const k = Math.min(1, (t - t0) / dur);
    camera.position.x = start.x + (end.x - start.x) * k;
    camera.position.y = start.y + (end.y - start.y) * k;
    camera.position.z = start.z + (end.z - start.z) * k;
    camera.lookAt(0,0,0);
    controls?.update();
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function mountCameraPresets(container, camera, controls){
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';

  const lbl = document.createElement('label');
  lbl.textContent = 'Camera';
  const select = document.createElement('select');
  Object.keys(presets).forEach((key)=>{
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key[0].toUpperCase() + key.slice(1);
    select.appendChild(opt);
  });
  select.onchange = ()=>{
    const val = select.value;
    localStorage.setItem(CAM_KEY, val);
    tweenCamera(camera, controls, presets[val].pos);
  };
  lbl.appendChild(select);
  wrap.appendChild(lbl);
  container.appendChild(wrap);

  const saved = localStorage.getItem(CAM_KEY) || 'angled';
  select.value = saved;
  tweenCamera(camera, controls, presets[saved].pos, true);
}
