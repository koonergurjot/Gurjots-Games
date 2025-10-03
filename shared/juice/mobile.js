// shared/juice/mobile.js

const TOUCH_ASSETS = {
  dpad: '/assets/ui/touch/dpad.png',
  jump: '/assets/ui/touch/jump.png',
  fire: '/assets/ui/touch/fire.png',
};

const MEDIA_QUERY = '(max-width: 768px)';
const STYLE_ID = 'gg-mobile-touch-style';

function ensureTouchStyles(){
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .gg-mobile-touch-bar {
      position: absolute;
      bottom: 12px;
      left: 12px;
      right: 12px;
      z-index: 30;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 24px;
      pointer-events: none;
    }
    .gg-mobile-action-button,
    .gg-mobile-dpad__hotspot {
      pointer-events: auto;
      touch-action: manipulation;
    }
    .gg-mobile-action-button {
      width: clamp(64px, 20vw, 92px);
      aspect-ratio: 1 / 1;
      border: none;
      border-radius: 20px;
      background: rgba(8, 8, 8, 0.55);
      backdrop-filter: blur(6px);
      padding: clamp(8px, 3vw, 14px);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      transition: transform 120ms ease, background 120ms ease;
      position: relative;
      isolation: isolate;
    }
    .gg-mobile-action-button:active {
      transform: scale(0.94);
      background: rgba(16,16,16,0.7);
    }
    .gg-mobile-action-button:focus-visible,
    .gg-mobile-dpad__hotspot:focus-visible {
      outline: 3px solid rgba(255,255,255,0.85);
      outline-offset: 4px;
    }
    .gg-mobile-action-button img,
    .gg-mobile-dpad img {
      width: 100%;
      height: 100%;
      image-rendering: pixelated;
      filter: drop-shadow(0 6px 14px rgba(0,0,0,0.4));
      user-select: none;
      pointer-events: none;
    }
    .gg-mobile-action-button img {
      object-fit: contain;
    }
    .gg-mobile-dpad {
      pointer-events: none;
      position: relative;
      width: clamp(140px, 32vw, 180px);
      aspect-ratio: 1 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .gg-mobile-dpad__hotspot {
      position: absolute;
      width: 44%;
      height: 44%;
      border: none;
      border-radius: 18px;
      background: rgba(0,0,0,0.05);
      transform: translate(-50%, -50%);
      display: block;
      padding: 0;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05);
    }
    .gg-mobile-dpad__hotspot:active {
      background: rgba(0,0,0,0.15);
    }
    .gg-mobile-dpad__hotspot--left { top: 50%; left: 22%; }
    .gg-mobile-dpad__hotspot--right { top: 50%; left: 78%; }
    .gg-mobile-dpad__hotspot--up { top: 22%; left: 50%; }
    .gg-mobile-dpad__hotspot--down { top: 78%; left: 50%; }

    .gg-mobile-slider {
      position: absolute;
      left: 10%;
      bottom: 12px;
      width: 80%;
      z-index: 30;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      pointer-events: none;
    }
    .gg-mobile-slider__label {
      color: rgba(255,255,255,0.9);
      font-size: clamp(14px, 4vw, 18px);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-family: 'Inter', system-ui, sans-serif;
      text-shadow: 0 4px 12px rgba(0,0,0,0.55);
      pointer-events: none;
    }
    .gg-mobile-slider__track {
      position: relative;
      width: min(420px, 92vw);
      pointer-events: none;
    }
    .gg-mobile-slider__track img {
      width: 100%;
      height: auto;
      display: block;
      image-rendering: pixelated;
      user-select: none;
      pointer-events: none;
      filter: drop-shadow(0 10px 20px rgba(0,0,0,0.45));
    }
    .gg-mobile-slider__track input[type="range"] {
      position: absolute;
      left: 10%;
      width: 80%;
      top: 50%;
      transform: translateY(-50%);
      -webkit-appearance: none;
      appearance: none;
      height: clamp(26px, 7vw, 40px);
      border-radius: 20px;
      background: rgba(0,0,0,0.25);
      pointer-events: auto;
      touch-action: none;
    }
    .gg-mobile-slider__track input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: clamp(36px, 10vw, 52px);
      height: clamp(36px, 10vw, 52px);
      border-radius: 50%;
      background: rgba(255,255,255,0.9);
      border: 3px solid rgba(0,0,0,0.35);
      box-shadow: 0 6px 14px rgba(0,0,0,0.35);
    }
    .gg-mobile-slider__track input[type="range"]::-moz-range-thumb {
      width: clamp(36px, 10vw, 52px);
      height: clamp(36px, 10vw, 52px);
      border-radius: 50%;
      background: rgba(255,255,255,0.9);
      border: 3px solid rgba(0,0,0,0.35);
      box-shadow: 0 6px 14px rgba(0,0,0,0.35);
    }
    .gg-mobile-slider__track input[type="range"]:focus-visible {
      outline: 3px solid rgba(255,255,255,0.85);
      outline-offset: 6px;
    }
  `;
  document.head.appendChild(style);
}

function addMediaListener(mediaQueryList, handler){
  if (mediaQueryList.addEventListener) {
    mediaQueryList.addEventListener('change', handler);
    return () => mediaQueryList.removeEventListener('change', handler);
  }
  mediaQueryList.addListener(handler);
  return () => mediaQueryList.removeListener(handler);
}

function isDirection(id){
  return id === 'left' || id === 'right' || id === 'up' || id === 'down';
}

function createTouchImage(src, alt=''){
  const img = new Image();
  img.src = src;
  img.alt = alt;
  img.decoding = 'async';
  img.draggable = false;
  img.style.imageRendering = 'pixelated';
  return img;
}

export function attachBottomSlider({onChange, label='Control'}={}){
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  ensureTouchStyles();
  const mediaQuery = window.matchMedia(MEDIA_QUERY);
  let wrap = null;
  let input = null;

  const handleInput = ()=>{
    if (!input) return;
    const value = parseFloat(input.value);
    onChange?.(value);
  };

  const mount = ()=>{
    if (wrap || !mediaQuery.matches) return;

    wrap = document.createElement('div');
    wrap.className = 'gg-mobile-slider';

    const labelEl = document.createElement('span');
    labelEl.className = 'gg-mobile-slider__label';
    labelEl.textContent = label;
    wrap.appendChild(labelEl);

    const track = document.createElement('div');
    track.className = 'gg-mobile-slider__track';

    const art = createTouchImage(TOUCH_ASSETS.dpad, `${label} touch control`);
    track.appendChild(art);

    input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.001';
    input.value = '0.5';
    input.setAttribute('aria-label', label);
    input.addEventListener('input', handleInput);
    input.addEventListener('change', handleInput);
    track.appendChild(input);

    wrap.appendChild(track);
    document.body.appendChild(wrap);
  };

  const unmount = ()=>{
    if (!wrap) return;
    if (input){
      input.removeEventListener('input', handleInput);
      input.removeEventListener('change', handleInput);
    }
    wrap.remove();
    wrap = null;
    input = null;
  };

  const handleChange = event => {
    if (event.matches) {
      mount();
    } else {
      unmount();
    }
  };

  const removeMediaListener = addMediaListener(mediaQuery, handleChange);
  mount();

  return ()=>{
    removeMediaListener();
    unmount();
  };
}

export function attachButtons({buttons=[{id:'left'},{id:'right'},{id:'jump'}], onDown, onUp}={}){
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  ensureTouchStyles();
  const mediaQuery = window.matchMedia(MEDIA_QUERY);
  let bar = null;
  const listenerCleanups = [];

  const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;

  const attachActionListeners = (target, id)=>{
    const handleStart = event => {
      event.preventDefault();
      onDown?.(id);
    };
    const handleEnd = event => {
      event.preventDefault();
      onUp?.(id);
    };
    const handleCancel = event => {
      event.preventDefault();
      onUp?.(id);
    };

    const listenerOptions = {passive: false};

    const pointerDown = event => {
      if (event.pointerType !== 'touch') return;
      handleStart(event);
    };
    const pointerUp = event => {
      if (event.pointerType !== 'touch') return;
      handleEnd(event);
    };
    const pointerCancel = event => {
      if (event.pointerType !== 'touch') return;
      handleCancel(event);
    };
    const preventContextMenu = event => event.preventDefault();

    if (!supportsPointer) {
      target.addEventListener('touchstart', handleStart, listenerOptions);
      target.addEventListener('touchend', handleEnd, listenerOptions);
      target.addEventListener('touchcancel', handleCancel, listenerOptions);
    } else {
      target.addEventListener('pointerdown', pointerDown, listenerOptions);
      target.addEventListener('pointerup', pointerUp, listenerOptions);
      target.addEventListener('pointercancel', pointerCancel, listenerOptions);
    }
    target.addEventListener('contextmenu', preventContextMenu);

    listenerCleanups.push(()=>{
      if (!supportsPointer) {
        target.removeEventListener('touchstart', handleStart, listenerOptions);
        target.removeEventListener('touchend', handleEnd, listenerOptions);
        target.removeEventListener('touchcancel', handleCancel, listenerOptions);
      } else {
        target.removeEventListener('pointerdown', pointerDown, listenerOptions);
        target.removeEventListener('pointerup', pointerUp, listenerOptions);
        target.removeEventListener('pointercancel', pointerCancel, listenerOptions);
      }
      target.removeEventListener('contextmenu', preventContextMenu);
    });
  };

  const mount = ()=>{
    if (bar || !mediaQuery.matches) return;

    bar = document.createElement('div');
    bar.className = 'gg-mobile-touch-bar';

    let dpadWrapper = null;
    const actionNodes = [];
    const ensureDpad = ()=>{
      if (dpadWrapper) return dpadWrapper;
      const wrapper = document.createElement('div');
      wrapper.className = 'gg-mobile-dpad';
      wrapper.appendChild(createTouchImage(TOUCH_ASSETS.dpad, 'Direction pad'));
      dpadWrapper = wrapper;
      return wrapper;
    };

    buttons.forEach(btn => {
      const id = btn.id;
      if (!id) return;
      if (isDirection(id)) {
        const wrapper = ensureDpad();
        const hotspot = document.createElement('button');
        hotspot.type = 'button';
        hotspot.className = `gg-mobile-dpad__hotspot gg-mobile-dpad__hotspot--${id}`;
        hotspot.setAttribute('aria-label', btn.label || `${id} direction`);
        attachActionListeners(hotspot, id);
        wrapper.appendChild(hotspot);
        return;
      }

      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = 'gg-mobile-action-button';
      const asset = btn.asset || (id === 'jump' ? TOUCH_ASSETS.jump : id === 'fire' ? TOUCH_ASSETS.fire : TOUCH_ASSETS.dpad);
      const img = createTouchImage(asset, btn.label || `${id} button`);
      actionButton.appendChild(img);
      actionButton.setAttribute('aria-label', btn.label || `${id} button`);
      attachActionListeners(actionButton, id);
      actionNodes.push(actionButton);
    });

    if (dpadWrapper) {
      bar.appendChild(dpadWrapper);
    }
    actionNodes.forEach(node => bar.appendChild(node));

    document.body.appendChild(bar);
  };

  const unmount = ()=>{
    if (!bar) return;
    listenerCleanups.splice(0).forEach(clean => clean());
    bar.remove();
    bar = null;
  };

  const handleChange = event => {
    if (event.matches) {
      mount();
    } else {
      unmount();
    }
  };

  const removeMediaListener = addMediaListener(mediaQuery, handleChange);
  mount();

  return ()=>{
    removeMediaListener();
    unmount();
  };
}
