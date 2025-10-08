const CAM_KEY = 'chess3d.cameraPreset';

const presets = {
  overhead: { pos: [0, 12, 0.01] },
  angled: { pos: [6, 10, 6] },
  side: { pos: [10, 6, 0] }
};

const easeInOut = (t) => (t < 0.5) ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function ensureStyles(){
  if (document.getElementById('camera-presets-style')) return;
  const style = document.createElement('style');
  style.id = 'camera-presets-style';
  style.textContent = `
    .camera-presets { display:flex; flex-direction:column; gap:6px; align-items:stretch; }
    .camera-presets__label { font-size:0.72rem; letter-spacing:0.08em; text-transform:uppercase; display:flex; align-items:center; gap:8px; color:inherit; }
    .camera-presets__select { padding:6px 10px; border-radius:8px; border:1px solid rgba(82,100,150,0.6); background:rgba(16,24,42,0.8); color:inherit; font:inherit; text-transform:uppercase; letter-spacing:0.05em; }
    .camera-presets__previews { display:flex; gap:8px; flex-wrap:wrap; }
    .camera-presets__preview { position:relative; width:58px; height:42px; border-radius:10px; border:1px solid rgba(255,255,255,0.18); background:rgba(18,24,46,0.6); cursor:pointer; transition:transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease; overflow:hidden; }
    .camera-presets__preview::before { content:''; position:absolute; inset:7px; border-radius:7px; border:1px solid rgba(255,255,255,0.22); background-image:repeating-linear-gradient(45deg, rgba(255,255,255,0.12) 0 6px, transparent 6px 12px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.25) 0 6px, transparent 6px 12px); opacity:0.85; box-shadow:0 4px 10px rgba(0,0,0,0.3); }
    .camera-presets__preview::after { content:''; position:absolute; inset:0; background:var(--preview-gradient, linear-gradient(160deg, rgba(130,180,255,0.45), rgba(24,34,72,0.82))); mix-blend-mode:screen; opacity:0.7; transition:opacity 160ms ease; }
    .camera-presets__preview:hover { transform:translateY(-2px); }
    .camera-presets__preview:focus-visible { outline:2px solid rgba(255,224,130,0.85); outline-offset:2px; }
    .camera-presets__preview.is-active { border-color:rgba(255,224,130,0.8); box-shadow:0 0 0 2px rgba(255,224,130,0.35); }
    .camera-presets__preview.is-active::after { opacity:0.95; }
    .camera-presets__preview[data-preset="overhead"] { --preview-gradient:linear-gradient(160deg, rgba(134,194,255,0.72), rgba(36,64,124,0.82)); }
    .camera-presets__preview[data-preset="angled"] { --preview-gradient:linear-gradient(160deg, rgba(255,212,142,0.72), rgba(148,96,54,0.86)); }
    .camera-presets__preview[data-preset="side"] { --preview-gradient:linear-gradient(160deg, rgba(164,255,220,0.68), rgba(46,108,92,0.85)); }
  `;
  document.head.appendChild(style);
}

function tweenCamera(camera, controls, pos, options = {}) {
  if (!camera?.position) return;
  let instant = false;
  let duration = 520;
  let easing = easeInOut;
  let onComplete;
  if (typeof options === 'boolean') {
    instant = options;
  } else if (options && typeof options === 'object') {
    instant = !!options.instant;
    if (Number.isFinite(options.duration)) duration = Math.max(0, options.duration);
    if (typeof options.easing === 'function') easing = options.easing;
    onComplete = typeof options.onComplete === 'function' ? options.onComplete : undefined;
  }
  const [x, y, z] = pos;
  if (instant || duration === 0) {
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    controls?.update?.();
    if (onComplete) onComplete();
    return;
  }
  const start = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  const end = { x, y, z };
  const t0 = performance.now();
  const step = (time) => {
    const elapsed = Math.min(1, (time - t0) / duration);
    const k = easing(elapsed);
    camera.position.x = start.x + (end.x - start.x) * k;
    camera.position.y = start.y + (end.y - start.y) * k;
    camera.position.z = start.z + (end.z - start.z) * k;
    camera.lookAt(0, 0, 0);
    controls?.update?.();
    if (elapsed < 1) requestAnimationFrame(step);
    else if (onComplete) onComplete();
  };
  requestAnimationFrame(step);
}

export function mountCameraPresets(container, camera, controls){
  ensureStyles();
  const wrap = document.createElement('div');
  wrap.className = 'camera-presets';

  const label = document.createElement('label');
  label.className = 'camera-presets__label';
  label.textContent = 'Camera';

  const select = document.createElement('select');
  select.className = 'camera-presets__select';
  Object.keys(presets).forEach((key)=>{
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key[0].toUpperCase() + key.slice(1);
    select.appendChild(opt);
  });

  const previews = document.createElement('div');
  previews.className = 'camera-presets__previews';

  const getPositionSnapshot = () => {
    if (!camera?.position) return null;
    const pos = camera.position;
    if (typeof pos.clone === 'function') {
      const clone = pos.clone();
      return { x: clone.x, y: clone.y, z: clone.z };
    }
    return { x: pos.x, y: pos.y, z: pos.z };
  };

  let activeKey = localStorage.getItem(CAM_KEY) || 'angled';
  if (!presets[activeKey]) activeKey = 'angled';
  let previewState = null;

  const highlightActive = () => {
    select.value = activeKey;
    previews.querySelectorAll('.camera-presets__preview').forEach((btn) => {
      const isActive = btn.dataset.preset === activeKey;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  const cancelPreview = () => {
    if (!previewState) return;
    const { original } = previewState;
    previewState = null;
    if (original) {
      tweenCamera(camera, controls, [original.x, original.y, original.z], { duration: 260 });
    }
  };

  const applyPreset = (key, { immediate = false } = {}) => {
    if (!presets[key]) return;
    activeKey = key;
    try { localStorage.setItem(CAM_KEY, key); } catch {}
    highlightActive();
    if (previewState?.key === key) {
      previewState = null;
    } else {
      cancelPreview();
    }
    tweenCamera(camera, controls, presets[key].pos, { duration: immediate ? 0 : 520 });
  };

  const previewPreset = (key) => {
    if (!camera?.position || !presets[key] || key === activeKey) return;
    const original = getPositionSnapshot();
    previewState = { key, original };
    tweenCamera(camera, controls, presets[key].pos, { duration: 320 });
  };

  select.addEventListener('change', () => {
    applyPreset(select.value);
  });

  Object.keys(presets).forEach((key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'camera-presets__preview';
    btn.dataset.preset = key;
    btn.setAttribute('aria-label', `${key[0].toUpperCase() + key.slice(1)} view`);
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('pointerenter', () => previewPreset(key));
    btn.addEventListener('focus', () => previewPreset(key));
    btn.addEventListener('pointerleave', cancelPreview);
    btn.addEventListener('blur', cancelPreview);
    btn.addEventListener('click', () => applyPreset(key));
    previews.appendChild(btn);
  });

  label.appendChild(select);
  wrap.appendChild(label);
  wrap.appendChild(previews);
  container.appendChild(wrap);

  highlightActive();
  applyPreset(activeKey, { immediate: true });
}
