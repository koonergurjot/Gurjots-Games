/**
 * Simple runtime controls helper.
 * - Tracks keyboard state based on a mapping of actions to key codes.
 * - Creates a touch D‑pad with A/B, pause and restart buttons.
 * - Consumers may register callbacks for actions via `on(action, cb)`.
 * - Call `dispose()` to remove all event listeners and DOM elements.
 */
export class Controls {
    constructor(opts = {}) {
        this.state = new Map();
        this.handlers = new Map();
        this.disposers = [];
        /** Root element for touch controls */
        this.element = null;
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
        this.map = { ...defaults, ...(opts.map || {}) };
        this.bindKeyboard();
        if (opts.touch !== false)
            this.buildTouch();
    }
    /** Register callback for an action. Returns unsubscribe function. */
    on(action, cb) {
        let set = this.handlers.get(action);
        if (!set)
            this.handlers.set(action, (set = new Set()));
        set.add(cb);
        return () => set.delete(cb);
    }
    /** Check whether given action is currently pressed. */
    isDown(action) {
        const code = this.map[action];
        if (Array.isArray(code))
            return code.some(c => this.state.get(c));
        return !!this.state.get(code);
    }
    /** Remove all listeners and DOM nodes. */
    dispose() {
        for (const [t, type, fn, opt] of this.disposers) {
            t.removeEventListener(type, fn, opt);
        }
        this.disposers = [];
        this.handlers.clear();
        if (this.element)
            this.element.remove();
        this.element = null;
    }
    match(action, code) {
        const m = this.map[action];
        if (Array.isArray(m))
            return m.includes(code);
        return m === code;
    }
    bindKeyboard() {
        const down = (e) => {
            this.state.set(e.code, true);
            this.fireByCode(e.code);
        };
        const up = (e) => this.state.set(e.code, false);
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        this.disposers.push([window, 'keydown', down]);
        this.disposers.push([window, 'keyup', up]);
    }
    fire(action) {
        const set = this.handlers.get(action);
        if (set)
            for (const fn of Array.from(set))
                fn();
    }
    fireByCode(code) {
        for (const action in this.map) {
            if (this.match(action, code))
                this.fire(action);
        }
    }
    createButton(action, label) {
        const btn = document.createElement('button');
        btn.textContent = label;
        const code = this.map[action];
        const start = (e) => {
            e.preventDefault();
            if (Array.isArray(code))
                this.state.set(code[0], true);
            else
                this.state.set(code, true);
            this.fire(action);
        };
        const end = () => {
            if (Array.isArray(code))
                this.state.set(code[0], false);
            else
                this.state.set(code, false);
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
