const DEFAULT_NOW = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

const TRANSITION_KEYS = {
  enter: ['enter', 'in'],
  exit: ['exit', 'out'],
  pause: ['pause'],
  resume: ['resume'],
};

function normalizeInputMap(input) {
  if (!input) {
    return new Map();
  }
  if (input instanceof Map) {
    return new Map(input);
  }
  const map = new Map();
  if (Array.isArray(input)) {
    for (const pair of input) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [action, handler] = pair;
      if (typeof action === 'string' && typeof handler === 'function') {
        map.set(action, handler);
      }
    }
    return map;
  }
  if (typeof input === 'object') {
    for (const key of Object.keys(input)) {
      const handler = input[key];
      if (typeof handler === 'function') {
        map.set(key, handler);
      }
    }
  }
  return map;
}

function buildTransitionTable(scene) {
  const table = {};
  if (!scene) return table;
  const source = typeof scene.transition === 'function'
    ? { all: scene.transition }
    : scene.transition;
  if (source && typeof source === 'object') {
    for (const key of Object.keys(source)) {
      if (typeof source[key] === 'function') {
        table[key] = source[key];
      }
    }
  }
  if (typeof scene.onTransition === 'function') {
    table.all = scene.onTransition;
  }
  return table;
}

function pickTransition(override, table, scene, phase) {
  const names = [...(TRANSITION_KEYS[phase] || [phase]), 'all'];
  const sources = [];
  if (override) {
    if (typeof override === 'function') {
      sources.push({ all: override });
    } else {
      sources.push(override);
    }
  }
  if (table) sources.push(table);
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const name of names) {
      const fn = source[name];
      if (typeof fn === 'function') {
        return fn;
      }
    }
  }
  const methodName = `on${phase[0].toUpperCase()}${phase.slice(1)}Transition`;
  if (scene && typeof scene[methodName] === 'function') {
    return scene[methodName].bind(scene);
  }
  return null;
}

function createInfo(kind, fromWrapper, toWrapper, options, now) {
  return {
    type: kind,
    from: fromWrapper ? fromWrapper.instance : null,
    to: toWrapper ? toWrapper.instance : null,
    fromId: fromWrapper ? fromWrapper.id : null,
    toId: toWrapper ? toWrapper.id : null,
    options: options || {},
    timestamp: now(),
  };
}

function defineContext(manager, wrapper, stackRef) {
  if (wrapper.context) {
    return wrapper.context;
  }
  const ctx = {
    id: wrapper.id,
    get scene() {
      return wrapper.instance;
    },
    manager,
    data: wrapper.data,
    options: wrapper.options,
    isActive() {
      return stackRef()[stackRef().length - 1] === wrapper;
    },
    setInputs(handlers) {
      wrapper.inputHandlers = normalizeInputMap(handlers);
      return wrapper.inputHandlers;
    },
    addInput(action, handler) {
      if (typeof action !== 'string' || typeof handler !== 'function') return false;
      wrapper.inputHandlers.set(action, handler);
      return true;
    },
    removeInput(action) {
      return wrapper.inputHandlers.delete(action);
    },
    clearInputs() {
      wrapper.inputHandlers.clear();
      return true;
    },
    setData(patch) {
      if (!patch || typeof patch !== 'object') return wrapper.data;
      wrapper.data = { ...wrapper.data, ...patch };
      ctx.data = wrapper.data;
      return wrapper.data;
    },
  };
  wrapper.context = ctx;
  return ctx;
}

async function runSceneHook(wrapper, hook, info, manager, stackRef) {
  if (!wrapper) return undefined;
  const method = wrapper.instance && wrapper.instance[hook];
  if (typeof method !== 'function') return undefined;
  const ctx = defineContext(manager, wrapper, stackRef);
  try {
    return await method.call(wrapper.instance, ctx, info);
  } catch (err) {
    console.error(`[scene:${manager.id}] ${hook} failed`, err);
    return undefined;
  }
}

async function runSceneTransition(wrapper, phase, info, override, manager, stackRef) {
  if (!wrapper) return undefined;
  const ctx = defineContext(manager, wrapper, stackRef);
  const fn = pickTransition(override, wrapper.transitionTable, wrapper.instance, phase);
  if (typeof fn !== 'function') return undefined;
  try {
    return await fn.call(wrapper.instance, ctx, info);
  } catch (err) {
    console.error(`[scene:${manager.id}] transition(${phase}) failed`, err);
    return undefined;
  }
}

function normalizeSceneDefinition(sceneInit, opts, idBase, counterRef) {
  const scene = typeof sceneInit === 'function' ? sceneInit(opts || {}) : sceneInit;
  if (!scene || typeof scene !== 'object') {
    throw new Error('Scene definition must be an object or scene factory function.');
  }
  const id = scene.id || (opts && opts.id) || `${idBase}:${counterRef.value += 1}`;
  return {
    id,
    instance: scene,
    data: opts && opts.data ? { ...opts.data } : {},
    options: opts || {},
    inputHandlers: normalizeInputMap(scene.input),
    transitionTable: buildTransitionTable(scene),
    context: null,
  };
}

export function createSceneManager(options = {}) {
  const {
    id = 'scene-manager',
    now = DEFAULT_NOW,
  } = options;
  const stack = [];
  const listeners = new Set();
  const counter = { value: 0 };
  let queueTail = Promise.resolve();
  let transitioning = false;

  const stackRef = () => stack;

  function currentWrapper(offset = 0) {
    const index = stack.length - 1 - (offset || 0);
    if (index < 0 || index >= stack.length) return null;
    return stack[index];
  }

  function emit(event) {
    if (!listeners.size) return;
    const payload = {
      ...event,
      stack: stack.map(entry => entry.id),
      timestamp: now(),
    };
    for (const listener of Array.from(listeners)) {
      try {
        listener(payload);
      } catch (err) {
        console.error(`[scene:${id}] change listener failed`, err);
      }
    }
  }

  function enqueue(task) {
    const run = () => Promise.resolve()
      .then(() => {
        transitioning = true;
        return task();
      })
      .finally(() => {
        transitioning = false;
      });
    const exec = queueTail.then(run, run);
    queueTail = exec.catch(() => {});
    return exec;
  }

  async function pushInternal(sceneInit, opts = {}) {
    const wrapper = normalizeSceneDefinition(sceneInit, opts, id, counter);
    const previous = currentWrapper();
    const infoBase = createInfo('push', previous, wrapper, opts, now);

    if (previous) {
      await runSceneHook(previous, 'onPause', { ...infoBase, phase: 'pause' }, manager, stackRef);
      await runSceneTransition(previous, 'pause', { ...infoBase, phase: 'pause' }, opts.transition, manager, stackRef);
    }

    stack.push(wrapper);
    const info = { ...infoBase, phase: 'enter' };

    await runSceneTransition(wrapper, 'enter', info, opts.transition, manager, stackRef);
    await runSceneHook(wrapper, 'onEnter', info, manager, stackRef);

    emit({ type: 'push', scene: wrapper.instance, previous: previous ? previous.instance : null });
    return wrapper.instance;
  }

  async function popInternal(opts = {}) {
    const current = currentWrapper();
    if (!current) return null;
    const next = currentWrapper(1);
    const infoBase = createInfo('pop', current, next, opts, now);

    await runSceneTransition(current, 'exit', { ...infoBase, phase: 'exit' }, opts.transition, manager, stackRef);
    await runSceneHook(current, 'onExit', { ...infoBase, phase: 'exit' }, manager, stackRef);
    stack.pop();
    await runSceneHook(current, 'onDestroy', { ...infoBase, phase: 'destroy' }, manager, stackRef);

    const shouldResume = opts && Object.prototype.hasOwnProperty.call(opts, 'resume') ? opts.resume !== false : true;
    const replacement = currentWrapper();
    if (replacement && shouldResume) {
      const resumeInfo = { ...infoBase, phase: 'resume', to: replacement.instance, toId: replacement.id };
      await runSceneTransition(replacement, 'resume', resumeInfo, opts.transition, manager, stackRef);
      await runSceneHook(replacement, 'onResume', resumeInfo, manager, stackRef);
    }

    emit({ type: 'pop', scene: replacement ? replacement.instance : null, previous: current.instance });
    return replacement ? replacement.instance : null;
  }

  async function replaceInternal(sceneInit, opts = {}) {
    const previous = currentWrapper();
    const wrapper = normalizeSceneDefinition(sceneInit, opts, id, counter);
    const infoBase = createInfo('replace', previous, wrapper, opts, now);

    if (previous) {
      await runSceneTransition(previous, 'exit', { ...infoBase, phase: 'exit' }, opts.transition, manager, stackRef);
      await runSceneHook(previous, 'onExit', { ...infoBase, phase: 'exit' }, manager, stackRef);
      stack.pop();
      await runSceneHook(previous, 'onDestroy', { ...infoBase, phase: 'destroy' }, manager, stackRef);
    }

    stack.push(wrapper);
    const info = { ...infoBase, phase: 'enter' };
    await runSceneTransition(wrapper, 'enter', info, opts.transition, manager, stackRef);
    await runSceneHook(wrapper, 'onEnter', info, manager, stackRef);

    emit({ type: 'replace', scene: wrapper.instance, previous: previous ? previous.instance : null });
    return wrapper.instance;
  }

  async function clearInternal(opts = {}) {
    while (stack.length) {
      const current = currentWrapper();
      const info = createInfo('clear', current, null, opts, now);
      await runSceneTransition(current, 'exit', { ...info, phase: 'exit' }, opts.transition, manager, stackRef);
      await runSceneHook(current, 'onExit', { ...info, phase: 'exit' }, manager, stackRef);
      stack.pop();
      await runSceneHook(current, 'onDestroy', { ...info, phase: 'destroy' }, manager, stackRef);
    }
    emit({ type: 'clear', scene: null, previous: null });
    return null;
  }

  function handleInput(action, payload) {
    if (!action) return false;
    const current = currentWrapper();
    if (!current) return false;
    const ctx = defineContext(manager, current, stackRef);
    const info = payload || {};
    let handled = false;

    if (current.inputHandlers && current.inputHandlers.size) {
      const handler = current.inputHandlers.get(action);
      if (typeof handler === 'function') {
        try {
          const result = handler.call(current.instance, ctx, info);
          if (result !== false) handled = true;
        } catch (err) {
          console.error(`[scene:${id}] input handler "${action}" failed`, err);
        }
      }
    }

    if (!handled) {
      const fallback = current.instance && (current.instance.handleInput || current.instance.onInput);
      if (typeof fallback === 'function') {
        try {
          const result = fallback.call(current.instance, ctx, action, info);
          handled = result !== false;
        } catch (err) {
          console.error(`[scene:${id}] handleInput("${action}") failed`, err);
        }
      }
    }

    return handled;
  }

  const manager = {
    id,
    get size() {
      return stack.length;
    },
    get isTransitioning() {
      return transitioning;
    },
    peek(depth = 0) {
      const wrapper = currentWrapper(depth);
      return wrapper ? wrapper.instance : null;
    },
    peekState(depth = 0) {
      const wrapper = currentWrapper(depth);
      if (!wrapper) return null;
      return { id: wrapper.id, scene: wrapper.instance, data: wrapper.data };
    },
    state() {
      return {
        stack: stack.map(entry => entry.id),
        transitioning,
      };
    },
    push(sceneInit, opts) {
      return enqueue(() => pushInternal(sceneInit, opts));
    },
    pop(opts) {
      return enqueue(() => popInternal(opts));
    },
    replace(sceneInit, opts) {
      return enqueue(() => replaceInternal(sceneInit, opts));
    },
    clear(opts) {
      return enqueue(() => clearInternal(opts));
    },
    update(dt, meta) {
      const wrapper = currentWrapper();
      if (!wrapper) return undefined;
      const fn = wrapper.instance && (wrapper.instance.update || wrapper.instance.onUpdate);
      if (typeof fn !== 'function') return undefined;
      const ctx = defineContext(manager, wrapper, stackRef);
      try {
        return fn.call(wrapper.instance, ctx, dt, meta);
      } catch (err) {
        console.error(`[scene:${id}] update failed`, err);
        return undefined;
      }
    },
    render(meta) {
      const wrapper = currentWrapper();
      if (!wrapper) return undefined;
      const fn = wrapper.instance && (wrapper.instance.render || wrapper.instance.onRender);
      if (typeof fn !== 'function') return undefined;
      const ctx = defineContext(manager, wrapper, stackRef);
      try {
        return fn.call(wrapper.instance, ctx, meta);
      } catch (err) {
        console.error(`[scene:${id}] render failed`, err);
        return undefined;
      }
    },
    handle(action, payload) {
      return handleInput(action, payload);
    },
    handleInput(action, payload) {
      return handleInput(action, payload);
    },
    onChange(listener) {
      if (typeof listener !== 'function') return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  Object.defineProperty(manager, 'current', {
    get() {
      const wrapper = currentWrapper();
      return wrapper ? wrapper.instance : null;
    },
  });

  Object.defineProperty(manager, 'currentId', {
    get() {
      const wrapper = currentWrapper();
      return wrapper ? wrapper.id : null;
    },
  });

  return manager;
}

export default createSceneManager;
