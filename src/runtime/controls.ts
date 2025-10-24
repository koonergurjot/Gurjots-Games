export interface ControlsOptions {
  /**
   * Mapping of action -> key codes (KeyboardEvent.code).
   * Provide an object for a single player or an array of objects for multiple players.
   * Values may be a string or array of strings.
   */
  map?: Record<string, string | string[]> | Array<Record<string, string | string[]>>;
  /** Automatically append touch controls */
  touch?: boolean;
}

/**
 * Simple runtime controls helper.
 * - Tracks keyboard state based on a mapping of actions to key codes.
 * - Creates a touch D‑pad with A/B, pause and restart buttons.
 * - Consumers may register callbacks for actions via `on(action, cb)`.
 * - Call `dispose()` to remove all event listeners and DOM elements.
 */
export class Controls {
  private maps: Array<Record<string, string | string[]>>;
  private state = new Map<string, boolean>();
  private handlers: Array<Map<string, Set<() => void>>>;
  private disposers: Array<[EventTarget, string, EventListenerOrEventListenerObject, any?]> = [];
  private touchBindings = new Map<
    string,
    {
      pressed: boolean;
      activeCodes: string[];
      refresh(): void;
    }
  >();
  /** Root element for touch controls */
  public element: HTMLElement | null = null;

  constructor(opts: ControlsOptions = {}) {
    const defaults: Record<string, string | string[]> = {
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

    this.handlers = this.maps.map(() => new Map());
    this.bindKeyboard();
    if (opts.touch !== false) this.buildTouch();
  }

  private ensureHandlerMap(player: number): Map<string, Set<() => void>> {
    let map = this.handlers[player];
    if (!map) this.handlers[player] = map = new Map();
    return map;
  }

  /** Register callback for an action. Returns unsubscribe function. */
  on(action: string, cb: () => void, player = 0): () => void {
    const handlers = this.ensureHandlerMap(player);
    let set = handlers.get(action);
    if (!set) handlers.set(action, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  /** Check whether given action is currently pressed. */
  isDown(action: string, player = 0): boolean {
    const code = this.maps[player]?.[action];
    if (!code) return false;
    if (Array.isArray(code)) return code.some(c => this.state.get(c));
    return !!this.state.get(code);
  }

  /** Change mapping for an action at runtime */
  setMapping(action: string, key: string | string[], player = 0): void {
    if (!this.maps[player]) {
      this.maps[player] = {};
      if (!this.handlers[player]) this.handlers[player] = new Map();
    }
    this.maps[player][action] = key;
    if (player === 0) {
      const binding = this.touchBindings.get(action);
      binding?.refresh();
    }
  }

  /** Remove all listeners and DOM nodes. */
  dispose(): void {
    for (const [t, type, fn, opt] of this.disposers) {
      t.removeEventListener(type, fn as any, opt);
    }
    this.disposers = [];
    this.handlers.forEach(h => h.clear());
    this.touchBindings.clear();
    if (this.element) this.element.remove();
    this.element = null;
  }

  private match(action: string, code: string, player: number): boolean {
    const m = this.maps[player]?.[action];
    if (Array.isArray(m)) return m.includes(code);
    return m === code;
  }

  private resolveCodes(action: string, player: number): string[] {
    const mapping = this.maps[player]?.[action];
    if (!mapping) return [];
    return Array.isArray(mapping) ? [...mapping] : [mapping];
  }

  private bindKeyboard(): void {
    const down = (e: KeyboardEvent) => {
      this.state.set(e.code, true);
      this.fireByCode(e.code);
    };
    const up = (e: KeyboardEvent) => this.state.set(e.code, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this.disposers.push([window, 'keydown', down]);
    this.disposers.push([window, 'keyup', up]);
  }

  private fire(action: string, player: number): void {
    const set = this.handlers[player]?.get(action);
    if (set) for (const fn of Array.from(set)) fn();
  }

  private fireByCode(code: string): void {
    for (let p = 0; p < this.maps.length; p++) {
      this.ensureHandlerMap(p);
      const map = this.maps[p];
      if (!map) continue;
      for (const action in map) {
        if (this.match(action, code, p)) this.fire(action, p);
      }
    }
  }

  private createButton(action: string, label: string): HTMLElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    const binding = {
      pressed: false,
      activeCodes: [] as string[],
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
    const setActive = (active: boolean) => {
      const codes = this.resolveCodes(action, 0);
      if (active) {
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
    const start = (e: Event) => {
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

  private buildTouch(): void {
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
export function keyState(
  map: Record<string, string | string[]> | Array<Record<string, string | string[]>> = []
) {
  const keys = new Set<string>();
  const maps = Array.isArray(map) ? map.map(m => ({ ...m })) : [
    typeof map === 'object' && map !== null ? { ...map } : {}
  ];
  const down = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
  const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  const has = (action: string, player = 0): boolean => {
    const m = maps[player]?.[action];
    if (m) {
      if (Array.isArray(m)) return m.some(k => keys.has(k.toLowerCase()));
      return keys.has(m.toLowerCase());
    }
    return keys.has(action.toLowerCase());
  };
  const setMapping = (action: string, key: string | string[], player = 0) => {
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
export function createGamepad(fn: (pad: Gamepad) => void) {
  let raf: number | null = null;
  function loop() {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (pads[0]) fn(pads[0]!);
    raf = requestAnimationFrame(loop);
  }
  const start = () => { if (!raf) loop(); };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = null; };
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
export function standardAxesToDir(pad: Gamepad, dead = 0.2) {
  const [lx = 0, ly = 0] = pad.axes || [];
  const dx = Math.abs(lx) > dead ? lx : 0;
  const dy = Math.abs(ly) > dead ? ly : 0;
  return { dx, dy };
}

/** Show/hide a hint element when a gamepad is connected. */
export function enableGamepadHint(hintEl: HTMLElement) {
  const show = () => { hintEl.style.display = ''; };
  const hide = () => { hintEl.style.display = 'none'; };
  window.addEventListener('gamepadconnected', show);
  window.addEventListener('gamepaddisconnected', hide);
  hide();
  return {
    destroy: () => {
      window.removeEventListener('gamepadconnected', show);
      window.removeEventListener('gamepaddisconnected', hide);
    }
  };
}

/**
 * Create virtual touch buttons for the given key codes.
 * Returns an element containing the buttons and a read() method
 * that returns a Map of button states.
 */
export function virtualButtons(codes: string[]) {
  const element = document.createElement('div');
  const state = new Map<string, boolean>();
  const up = (code: string) => () => state.set(code, false);
  for (const code of codes) {
    const btn = document.createElement('button');
    btn.dataset.k = code;
    state.set(code, false);
    btn.addEventListener('touchstart', e => { state.set(code, true); e.preventDefault(); }, { passive: false });
    btn.addEventListener('touchend', up(code));
    btn.addEventListener('touchcancel', up(code));
    element.appendChild(btn);
  }
  return {
    element,
    read: () => new Map(state)
  };
}

