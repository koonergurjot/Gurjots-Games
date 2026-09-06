/**
 * Helpers for installing and restoring globals inside tests.
 *
 * Node 22 exposes `globalThis.navigator` as a getter-only accessor property, so
 * the usual `global.navigator = {...}` or `Object.assign(global, env)` now throws:
 *
 *   TypeError: Cannot set property navigator of #<Object> which has only a getter
 *
 * Defining the property instead of assigning to it works on every Node version,
 * so tests that need to stub browser or service-worker globals go through here.
 */

const OWNER = globalThis;

/** Install a single global, replacing any accessor already in place. */
export function defineGlobal(key, value) {
  Object.defineProperty(OWNER, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Install every own property of `values` as a global.
 * Drop-in replacement for `Object.assign(global, values)`.
 * Returns the keys it defined, ready to hand to `snapshotGlobals`.
 */
export function assignGlobals(values) {
  const keys = Reflect.ownKeys(values);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(values, key);
    if ('value' in descriptor) {
      defineGlobal(key, descriptor.value);
    } else {
      // Preserve getters/setters the mock defined deliberately.
      Object.defineProperty(OWNER, key, { ...descriptor, configurable: true });
    }
  }
  return keys;
}

/**
 * Record the current property descriptors for `keys` so they can be put back
 * later. Captures descriptors rather than values, so an accessor global such as
 * `navigator` is restored as the accessor it was, not as a plain data property.
 */
export function snapshotGlobals(keys) {
  const snapshot = new Map();
  for (const key of keys) {
    snapshot.set(key, Object.getOwnPropertyDescriptor(OWNER, key));
  }
  return snapshot;
}

/** Undo `assignGlobals`, using a snapshot taken before it ran. */
export function restoreGlobals(snapshot) {
  for (const [key, descriptor] of snapshot) {
    if (descriptor) {
      Object.defineProperty(OWNER, key, descriptor);
    } else {
      delete OWNER[key];
    }
  }
}
