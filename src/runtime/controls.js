/**
 * Simple runtime controls helper.
 * - Tracks keyboard state based on a mapping of actions to key codes.
 * - Creates a touch D-pad with A/B, pause and restart buttons.
 * - Consumers may register callbacks for actions via `on(action, cb)`.
 * - Call `dispose()` to remove all event listeners and DOM elements.
 */
export class Controls {
  constructor(opts = {}) {
    const defaults = {
      left: 'ArrowLeft',
      right: 'ArrowRight',
      up: 'ArrowUp',
      down: 'ArrowDown',
      a: 'KeyZ',
      b: 'KeyX',
      pause: 'KeyP',
      restart: 'KeyR',
    };

    if (Array.isArray(opts.map)) {
      this.maps = opts.map.map((m, i) => (i === 0 ? { ...defaults, ...m } : { ...m }));
    } else {
      this.maps = [{ ...defaults, ...(opts.map || {}) }];
    }

    this.state = new Map();
    this.handlers = this.maps.map(() => new Map());
    this.disposers = [];
    this.touchBindings = new Map();
    this.element = null;

    this.bindKeyboard();
    if (opts.touch !== false) this.buildTouch();
  }

  /** Register callback for an action. Returns unsubscribe function. */
  on(action, cb, player = 0) {
    if (!this.handlers[player]) this.handlers[player] = new Map();
    let set = this.handlers[player].get(action);
    if (!set) {
      set = new Set();
      this.handlers[player].set(action, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  /** Check whether given action is currently pressed. */
  isDown(action, player = 0) {
    const code = this.maps[player]?.[action];
    if (!code) return false;
    if (Array.isArray(code)) return code.some(c => this.state.get(c));
    return !!this.state.get(code);
  }

  /** Change mapping for an action at runtime */
  setMapping(action, key, player = 0) {
    if (!this.maps[player]) this.maps[player] = {};
    this.maps[player][action] = key;
    if (player === 0) {
      const binding = this.touchBindings.get(action);
      binding?.refresh();
    }
  }

  /** Remove all listeners and DOM nodes. */
  dispose() {
    for (const [target, type, listener, options] of this.disposers) {
      target.removeEventListener(type, listener, options);
    }
    this.disposers = [];
    this.handlers.forEach(h => h.clear());
    this.touchBindings.clear();
    if (this.element) this.element.remove();
    this.element = null;
  }

  match(action, code, player) {
    const mapping = this.maps[player]?.[action];
    if (Array.isArray(mapping)) return mapping.includes(code);
    return mapping === code;
  }

  resolveCodes(action, player) {
    const mapping = this.maps[player]?.[action];
    if (!mapping) return [];
    return Array.isArray(mapping) ? [...mapping] : [mapping];
  }

  bindKeyboard() {
    const down = e => {
      this.state.set(e.code, true);
      this.fireByCode(e.code);
    };
    const up = e => {
      this.state.set(e.code, false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this.disposers.push([window, 'keydown', down]);
    this.disposers.push([window, 'keyup', up]);
  }

  fire(action, player) {
    const set = this.handlers[player]?.get(action);
    if (set) {
      for (const fn of Array.from(set)) fn();
    }
  }

  fireByCode(code) {
    for (let p = 0; p < this.maps.length; p++) {
      const map = this.maps[p];
      if (!this.handlers[p]) this.handlers[p] = new Map();
      for (const action in map) {
        if (this.match(action, code, p)) this.fire(action, p);
      }
    }
  }

  createButton(action, label) {
    const btn = document.createElement('button');
    btn.textContent = label;
    const binding = {
      pressed: false,
      activeCodes: [],
      refresh: () => {
        if (!binding.pressed) return;
        const codes = this.resolveCodes(action, 0);
        const next = new Set(codes);
        for (const code of binding.activeCodes) {
          if (!next.has(code)) this.state.set(code, false);
        }
        for (const code of codes) {
          this.state.set(code, true);
        }
        binding.activeCodes = codes;
      },
    };
    const setActive = active => {
      if (active) {
        const codes = this.resolveCodes(action, 0);
        binding.pressed = true;
        binding.activeCodes = codes;
        for (const code of codes) this.state.set(code, true);
      } else {
        for (const code of binding.activeCodes) this.state.set(code, false);
        binding.activeCodes = [];
        binding.pressed = false;
      }
    };
    this.touchBindings.set(action, binding);
    const start = e => {
      e.preventDefault();
      if (!binding.pressed) {
        setActive(true);
      } else {
        binding.refresh();
      }
      this.fire(action, 0);
    };
    const end = () => {
      if (binding.pressed) setActive(false);
    };
    btn.addEventListener('touchstart', start, { passive: false });
    btn.addEventListener('touchend', end);
    btn.addEventListener('touchcancel', end);
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', end);
    btn.addEventListener('mouseleave', end);
    this.disposers.push([btn, 'touchstart', start, { passive: false }]);
    this.disposers.push([btn, 'touchend', end]);
    this.disposers.push([btn, 'touchcancel', end]);
    this.disposers.push([btn, 'mousedown', start]);
    this.disposers.push([btn, 'mouseup', end]);
    this.disposers.push([btn, 'mouseleave', end]);
    return btn;
  }

  buildTouch() {
    const root = document.createElement('div');
    root.style.position = 'fixed';
    root.style.left = '0';
    root.style.right = '0';
    root.style.bottom = '0';
    root.style.pointerEvents = 'none';

    const leftPad = document.createElement('div');
    leftPad.style.position = 'absolute';
    leftPad.style.left = '10px';
    leftPad.style.bottom = '10px';
    leftPad.style.pointerEvents = 'auto';
    const upBtn = this.createButton('up', '▲');
    const downBtn = this.createButton('down', '▼');
    const leftBtn = this.createButton('left', '◀');
    const rightBtn = this.createButton('right', '▶');
    leftPad.append(upBtn, downBtn, leftBtn, rightBtn);
    leftPad.style.display = 'grid';
    leftPad.style.gridTemplateColumns = 'repeat(3, 40px)';
    leftPad.style.gridTemplateRows = 'repeat(3, 40px)';
    leftPad.style.gap = '4px';
    upBtn.style.gridArea = '1 / 2';
    leftBtn.style.gridArea = '2 / 1';
    rightBtn.style.gridArea = '2 / 3';
    downBtn.style.gridArea = '3 / 2';
    root.appendChild(leftPad);

    const rightPad = document.createElement('div');
    rightPad.style.position = 'absolute';
    rightPad.style.right = '10px';
    rightPad.style.bottom = '10px';
    rightPad.style.pointerEvents = 'auto';
    const aBtn = this.createButton('a', 'A');
    const bBtn = this.createButton('b', 'B');
    rightPad.append(aBtn, bBtn);
    rightPad.style.display = 'flex';
    rightPad.style.gap = '10px';
    root.appendChild(rightPad);

    const sysPad = document.createElement('div');
    sysPad.style.position = 'absolute';
    sysPad.style.left = '50%';
    sysPad.style.bottom = '10px';
    sysPad.style.transform = 'translateX(-50%)';
    sysPad.style.pointerEvents = 'auto';
    const pauseBtn = this.createButton('pause', 'II');
    const restartBtn = this.createButton('restart', '↻');
    sysPad.append(pauseBtn, restartBtn);
    sysPad.style.display = 'flex';
    sysPad.style.gap = '10px';
    root.appendChild(sysPad);

    document.body.appendChild(root);
    this.element = root;
  }
}

/**
 * Basic key state helper.
 * Optionally provide per-player mappings of actions to keys (KeyboardEvent.key).
 */
export function keyState(map = []) {
  const keys = new Set();
  const maps = Array.isArray(map)
    ? map.map(m => ({ ...m }))
    : [typeof map === 'object' && map !== null ? { ...map } : {}];

  const down = e => keys.add(e.key.toLowerCase());
  const up = e => keys.delete(e.key.toLowerCase());
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);

  const has = (action, player = 0) => {
    const m = maps[player]?.[action];
    if (m) {
      if (Array.isArray(m)) return m.some(k => keys.has(k.toLowerCase()));
      return keys.has(m.toLowerCase());
    }
    return keys.has(action.toLowerCase());
  };

  const setMapping = (action, key, player = 0) => {
    if (!maps[player]) maps[player] = {};
    maps[player][action] = key;
  };

  const destroy = () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
  };

  return { has, setMapping, destroy };
}

/** Create a polling loop for the primary gamepad. */
export function createGamepad(fn) {
  let raf = null;
  function loop() {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (pads[0]) fn(pads[0]);
    raf = requestAnimationFrame(loop);
  }
  const start = () => {
    if (!raf) loop();
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  };
  window.addEventListener('gamepadconnected', start);
  window.addEventListener('gamepaddisconnected', stop);
  start();
  const destroy = () => {
    stop();
    window.removeEventListener('gamepadconnected', start);
    window.removeEventListener('gamepaddisconnected', stop);
  };
  return { start, stop, destroy };
}

/** Convert standard gamepad axes to directional x/y values with deadzone. */
export function standardAxesToDir(pad, dead = 0.2) {
  const [lx = 0, ly = 0] = pad.axes || [];
  const dx = Math.abs(lx) > dead ? lx : 0;
  const dy = Math.abs(ly) > dead ? ly : 0;
  return { dx, dy };
}

/** Show/hide a hint element when a gamepad is connected. */
export function enableGamepadHint(hintEl) {
  const show = () => {
    hintEl.style.display = '';
  };
  const hide = () => {
    hintEl.style.display = 'none';
  };
  window.addEventListener('gamepadconnected', show);
  window.addEventListener('gamepaddisconnected', hide);
  hide();
  return {
    destroy: () => {
      window.removeEventListener('gamepadconnected', show);
      window.removeEventListener('gamepaddisconnected', hide);
    },
  };
}

/**
 * Create virtual touch buttons for the given key codes.
 * Returns an element containing the buttons and a read() method
 * that returns a Map of button states.
 */
export function virtualButtons(codes) {
  const element = document.createElement('div');
  const state = new Map();
  const up = code => () => state.set(code, false);
  for (const code of codes) {
    const btn = document.createElement('button');
    btn.dataset.k = code;
    state.set(code, false);
    btn.addEventListener(
      'touchstart',
      e => {
        state.set(code, true);
        e.preventDefault();
      },
      { passive: false }
    );
    btn.addEventListener('touchend', up(code));
    btn.addEventListener('touchcancel', up(code));
    element.appendChild(btn);
  }
  return {
    element,
    read: () => new Map(state),
  };
}

/** Compatibility wrapper used by older call sites expecting a static init. */
export function initControls(options) {
  return new Controls(options);
}

/** Legacy no-op retained for compatibility. */
export function handleInput() {}

Controls.init = initControls;

