// Lightweight runtime controls helper.
//
// The production TypeScript project ships a full-featured implementation
// that exposes keyboard/touch mappings and simple callbacks.  The browser
// build in this repository previously provided only a no-op shim, which
// meant importing games could not react to user input.  This file mirrors
// the behaviour we rely on for the Asteroids implementation: tracking key
// state, allowing listeners to be attached, and (optionally) rendering a
// minimal touch interface.

const DEFAULT_MAP = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  a: 'KeyZ',
  b: 'KeyX',
  pause: 'KeyP',
  restart: 'KeyR'
};

function normalizeMap(mapConfig = {}) {
  const maps = Array.isArray(mapConfig) ? mapConfig : [mapConfig];
  return maps.map((entry, index) =>
    index === 0 ? { ...DEFAULT_MAP, ...(entry || {}) } : { ...(entry || {}) }
  );
}

class RuntimeControls {
  constructor(opts = {}) {
    this.maps = normalizeMap(opts.map);
    this.state = new Map();
    this.handlers = this.maps.map(() => new Map());
    this.disposers = [];
    this.element = null;

    if (typeof window !== 'undefined') {
      this.bindKeyboard();
      if (opts.touch !== false) this.buildTouch();
    }
  }

  on(action, cb, player = 0) {
    let bucket = this.handlers[player].get(action);
    if (!bucket) {
      bucket = new Set();
      this.handlers[player].set(action, bucket);
    }
    bucket.add(cb);
    return () => bucket.delete(cb);
  }

  isDown(action, player = 0) {
    const binding = this.maps[player]?.[action];
    if (!binding) return false;
    if (Array.isArray(binding)) return binding.some(code => this.state.get(code));
    return !!this.state.get(binding);
  }

  setMapping(action, key, player = 0) {
    if (!this.maps[player]) this.maps[player] = {};
    this.maps[player][action] = key;
  }

  dispose() {
    for (const [target, type, handler, options] of this.disposers) {
      target.removeEventListener(type, handler, options);
    }
    this.disposers.length = 0;
    this.handlers.forEach(map => map.clear());
    if (this.element) this.element.remove();
    this.element = null;
  }

  bindKeyboard() {
    const keydown = event => {
      this.state.set(event.code, true);
      this.fireByCode(event.code);
    };
    const keyup = event => {
      this.state.set(event.code, false);
    };

    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    this.disposers.push([window, 'keydown', keydown]);
    this.disposers.push([window, 'keyup', keyup]);
  }

  fire(action, player) {
    const bucket = this.handlers[player].get(action);
    if (!bucket) return;
    for (const cb of Array.from(bucket)) cb();
  }

  fireByCode(code) {
    for (let player = 0; player < this.maps.length; player++) {
      const mapping = this.maps[player];
      for (const action in mapping) {
        const binding = mapping[action];
        if (Array.isArray(binding)) {
          if (binding.includes(code)) this.fire(action, player);
        } else if (binding === code) {
          this.fire(action, player);
        }
      }
    }
  }

  createButton(action, label) {
    if (typeof document === 'undefined') return null;
    const button = document.createElement('button');
    button.textContent = label;
    button.style.minWidth = '56px';
    button.style.minHeight = '56px';
    button.style.borderRadius = '16px';
    button.style.border = '1px solid rgba(255,255,255,0.35)';
    button.style.background = 'rgba(15,23,42,0.65)';
    button.style.color = '#e5e7eb';
    button.style.font = '700 18px/1 Inter,system-ui,sans-serif';
    button.style.pointerEvents = 'auto';

    const binding = this.maps[0]?.[action];
    const setState = pressed => {
      if (!binding) return;
      if (Array.isArray(binding)) {
        this.state.set(binding[0], pressed);
      } else {
        this.state.set(binding, pressed);
      }
    };

    const press = event => {
      event.preventDefault();
      setState(true);
      this.fire(action, 0);
    };
    const release = () => setState(false);

    button.addEventListener('touchstart', press, { passive: false });
    button.addEventListener('touchend', release);
    button.addEventListener('touchcancel', release);
    button.addEventListener('mousedown', press);
    button.addEventListener('mouseup', release);
    button.addEventListener('mouseleave', release);

    this.disposers.push([button, 'touchstart', press, { passive: false }]);
    this.disposers.push([button, 'touchend', release]);
    this.disposers.push([button, 'touchcancel', release]);
    this.disposers.push([button, 'mousedown', press]);
    this.disposers.push([button, 'mouseup', release]);
    this.disposers.push([button, 'mouseleave', release]);

    return button;
  }

  buildTouch() {
    if (typeof document === 'undefined') return;
    const root = document.createElement('div');
    root.style.position = 'fixed';
    root.style.left = '0';
    root.style.right = '0';
    root.style.bottom = '0';
    root.style.pointerEvents = 'none';
    root.style.padding = '12px';
    root.style.display = 'flex';
    root.style.justifyContent = 'space-between';
    root.style.gap = '12px';
    root.style.zIndex = '30';

    const pad = document.createElement('div');
    pad.style.pointerEvents = 'auto';
    pad.style.display = 'grid';
    pad.style.gridTemplateColumns = 'repeat(3, 60px)';
    pad.style.gridTemplateRows = 'repeat(3, 60px)';
    pad.style.gap = '8px';

    const up = this.createButton('up', '▲');
    const down = this.createButton('down', '▼');
    const left = this.createButton('left', '◀');
    const right = this.createButton('right', '▶');
    if (up) up.style.gridArea = '1 / 2';
    if (left) left.style.gridArea = '2 / 1';
    if (right) right.style.gridArea = '2 / 3';
    if (down) down.style.gridArea = '3 / 2';
    [up, left, right, down].forEach(btn => { if (btn) pad.appendChild(btn); });

    const system = document.createElement('div');
    system.style.pointerEvents = 'auto';
    system.style.display = 'flex';
    system.style.flexDirection = 'column';
    system.style.gap = '8px';

    const pause = this.createButton('pause', '⏸');
    const restart = this.createButton('restart', '↻');
    [pause, restart].forEach(btn => { if (btn) system.appendChild(btn); });

    const actions = document.createElement('div');
    actions.style.pointerEvents = 'auto';
    actions.style.display = 'flex';
    actions.style.flexDirection = 'column';
    actions.style.gap = '8px';

    const fire = this.createButton('a', 'A');
    const alt = this.createButton('b', 'B');
    [fire, alt].forEach(btn => { if (btn) actions.appendChild(btn); });

    root.append(pad, system, actions);
    document.body.appendChild(root);
    this.element = root;
  }
}

export function initControls(opts = {}) {
  return new RuntimeControls(opts);
}

export function handleInput() {
  // Legacy hook kept for compatibility. Games that relied on the stub can
  // continue calling Controls.handle() safely.
}

export const Controls = {
  init: initControls,
  handle: handleInput
};

export { RuntimeControls };
