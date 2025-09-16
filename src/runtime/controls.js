// Simple runtime controls helper that mimics the TypeScript implementation
// shipped in production.  It keeps track of key state and lets games register
// callbacks for particular actions.  The interface intentionally mirrors the
// old shim so existing imports keep working.

const DEFAULT_MAP = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  a: 'Space',
  b: 'ShiftRight',
  pause: 'KeyP',
  restart: 'KeyR'
};

function normaliseMap(map = {}) {
  const config = { ...DEFAULT_MAP, ...map };
  const result = {};
  for (const [action, binding] of Object.entries(config)) {
    if (!binding) continue;
    if (Array.isArray(binding)) {
      result[action] = binding.map(code => String(code));
    } else {
      result[action] = [String(binding)];
    }
  }
  return result;
}

class RuntimeControls {
  constructor(options = {}) {
    this.map = normaliseMap(options.map);
    this.state = new Map();
    this.listeners = new Map();
    this.bound = false;
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
      window.addEventListener('keyup', this.handleKeyUp);
      this.bound = true;
    }
  }

  codesFor(action) {
    return this.map[action] ?? [];
  }

  isDown(action) {
    return this.codesFor(action).some(code => this.state.get(code));
  }

  on(action, callback) {
    if (typeof callback !== 'function') return () => {};
    let bucket = this.listeners.get(action);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(action, bucket);
    }
    bucket.add(callback);
    return () => bucket.delete(callback);
  }

  fire(action) {
    const bucket = this.listeners.get(action);
    if (!bucket) return;
    for (const cb of Array.from(bucket)) {
      try {
        cb();
      } catch (err) {
        console.error('[controls] listener error', err);
      }
    }
  }

  fireForCode(code) {
    for (const [action, codes] of Object.entries(this.map)) {
      if (codes.includes(code)) this.fire(action);
    }
  }

  handleKeyDown(event) {
    this.state.set(event.code, true);
    this.fireForCode(event.code);
  }

  handleKeyUp(event) {
    this.state.set(event.code, false);
  }

  dispose() {
    if (this.bound) {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
      this.bound = false;
    }
    this.listeners.clear();
    this.state.clear();
  }
}

export function initControls(options) {
  return new RuntimeControls(options);
}

export function handleInput() {
  // Legacy shim kept for compatibility with older imports.
}

export const Controls = {
  init: initControls,
  handle: handleInput
};

export { RuntimeControls };
