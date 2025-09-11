export interface ControlsOptions {
  /** Mapping of action -> key codes (KeyboardEvent.code). Values may be a string or array of strings. */
  map?: Record<string, string | string[]>;
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
  private map: Record<string, string | string[]>;
  private state = new Map<string, boolean>();
  private handlers = new Map<string, Set<() => void>>();
  private disposers: Array<[EventTarget, string, EventListenerOrEventListenerObject, any?]> = [];
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
    this.map = { ...defaults, ...(opts.map || {}) };
    this.bindKeyboard();
    if (opts.touch !== false) this.buildTouch();
  }

  /** Register callback for an action. Returns unsubscribe function. */
  on(action: string, cb: () => void): () => void {
    let set = this.handlers.get(action);
    if (!set) this.handlers.set(action, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  /** Check whether given action is currently pressed. */
  isDown(action: string): boolean {
    const code = this.map[action];
    if (Array.isArray(code)) return code.some(c => this.state.get(c));
    return !!this.state.get(code);
  }

  /** Remove all listeners and DOM nodes. */
  dispose(): void {
    for (const [t, type, fn, opt] of this.disposers) {
      t.removeEventListener(type, fn as any, opt);
    }
    this.disposers = [];
    this.handlers.clear();
    if (this.element) this.element.remove();
    this.element = null;
  }

  private match(action: string, code: string): boolean {
    const m = this.map[action];
    if (Array.isArray(m)) return m.includes(code);
    return m === code;
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

  private fire(action: string): void {
    const set = this.handlers.get(action);
    if (set) for (const fn of Array.from(set)) fn();
  }

  private fireByCode(code: string): void {
    for (const action in this.map) {
      if (this.match(action, code)) this.fire(action);
    }
  }

  private createButton(action: string, label: string): HTMLElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    const code = this.map[action];
    const start = (e: Event) => {
      e.preventDefault();
      if (Array.isArray(code)) this.state.set(code[0], true); else this.state.set(code, true);
      this.fire(action);
    };
    const end = () => {
      if (Array.isArray(code)) this.state.set(code[0], false); else this.state.set(code, false);
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
