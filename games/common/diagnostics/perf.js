/* Gurjot's Games — diagnostics/perf.js
   Performance diagnostics collector that samples FPS and long tasks.
*/
(function(globalFactoryScope, factory){
  const scope = globalFactoryScope || (typeof globalThis !== "undefined" ? globalThis : undefined);
  const api = factory(scope);
  if (typeof module === "object" && module && typeof module.exports === "object") {
    module.exports = api;
  }
  if (scope) {
    const existing = scope.GGDiagCollectors && typeof scope.GGDiagCollectors === "object"
      ? scope.GGDiagCollectors
      : {};
    scope.GGDiagCollectors = Object.assign({}, existing, { perf: api });
  }
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : undefined), function(globalScope){
  const MAX_SAMPLES = 120;
  const state = {
    installed: false,
    scope: null,
    emitter: () => {},
    fpsSamples: [],
    lastFrameTime: null,
    rafId: null,
    emitHandle: null,
    emitMode: null,
    longTaskObserver: null,
    longTaskCount: 0,
  };

  function install(options = {}){
    if (state.installed) {
      return { teardown };
    }
    state.scope = options.scope || globalScope;
    if (!state.scope) {
      state.installed = true;
      return { teardown };
    }
    state.emitter = createEmitter(state.scope, options);
    state.fpsSamples = [];
    state.lastFrameTime = null;
    state.longTaskCount = 0;
    state.installed = true;

    startSampling();
    startLongTaskObserver();
    startEmitTimer();
    emitSnapshot();

    return { teardown };
  }

  function teardown(){
    if (!state.installed) return;
    stopEmitTimer();
    stopSampling();
    stopLongTaskObserver();
    state.installed = false;
    state.scope = null;
    state.emitter = () => {};
    state.fpsSamples = [];
    state.lastFrameTime = null;
    state.longTaskCount = 0;
  }

  function createEmitter(scope, options){
    if (options && typeof options.emit === "function") {
      return (entry) => {
        try { options.emit(entry); } catch (_) {}
      };
    }
    return (entry) => {
      if (!entry) return;
      try {
        if (scope.__GG_DIAG && typeof scope.__GG_DIAG.log === "function") {
          scope.__GG_DIAG.log(entry);
        } else {
          const queue = scope.__GG_DIAG_QUEUE || (scope.__GG_DIAG_QUEUE = []);
          queue.push(entry);
        }
      } catch (_) {
        try {
          const queue = scope.__GG_DIAG_QUEUE || (scope.__GG_DIAG_QUEUE = []);
          queue.push(entry);
        } catch (_) {}
      }
    };
  }

  function startSampling(){
    if (!state.scope || typeof state.scope.requestAnimationFrame !== "function") {
      state.rafId = null;
      state.lastFrameTime = null;
      return;
    }
    const raf = state.scope.requestAnimationFrame.bind(state.scope);
    const step = (timestamp) => {
      if (!state.installed) return;
      if (typeof timestamp === "number") {
        recordFrame(timestamp);
      }
      state.rafId = raf(step);
    };
    state.rafId = raf(step);
  }

  function stopSampling(){
    if (!state.scope) return;
    if (state.rafId !== null && typeof state.scope.cancelAnimationFrame === "function") {
      try { state.scope.cancelAnimationFrame(state.rafId); } catch (_) {}
    }
    state.rafId = null;
    state.lastFrameTime = null;
  }

  function recordFrame(timestamp){
    if (state.lastFrameTime !== null) {
      const delta = timestamp - state.lastFrameTime;
      if (delta > 0) {
        const fps = 1000 / delta;
        if (Number.isFinite(fps) && fps > 0 && fps < 240) {
          pushSample(fps);
        }
      }
    }
    state.lastFrameTime = timestamp;
  }

  function pushSample(value){
    const rounded = Math.max(0, Number(value));
    if (!Number.isFinite(rounded)) return;
    state.fpsSamples.push(Number(rounded.toFixed(1)));
    if (state.fpsSamples.length > MAX_SAMPLES) {
      state.fpsSamples.splice(0, state.fpsSamples.length - MAX_SAMPLES);
    }
  }

  function startEmitTimer(){
    if (!state.scope) return;
    if (typeof state.scope.setInterval === "function" && typeof state.scope.clearInterval === "function") {
      state.emitMode = "interval";
      state.emitHandle = state.scope.setInterval(() => emitSnapshot(), 1000);
      return;
    }
    if (typeof state.scope.setTimeout === "function" && typeof state.scope.clearTimeout === "function") {
      state.emitMode = "timeout";
      const tick = () => {
        emitSnapshot();
        if (!state.installed) return;
        state.emitHandle = state.scope.setTimeout(tick, 1000);
      };
      state.emitHandle = state.scope.setTimeout(tick, 1000);
      return;
    }
    state.emitMode = null;
    state.emitHandle = null;
  }

  function stopEmitTimer(){
    if (!state.scope || state.emitHandle === null) {
      state.emitHandle = null;
      state.emitMode = null;
      return;
    }
    try {
      if (state.emitMode === "interval" && typeof state.scope.clearInterval === "function") {
        state.scope.clearInterval(state.emitHandle);
      } else if (state.emitMode === "timeout" && typeof state.scope.clearTimeout === "function") {
        state.scope.clearTimeout(state.emitHandle);
      }
    } catch (_) {}
    state.emitHandle = null;
    state.emitMode = null;
  }

  function startLongTaskObserver(){
    if (!state.scope || typeof state.scope.PerformanceObserver !== "function") return;
    const Observer = state.scope.PerformanceObserver;
    let supported = true;
    try {
      if (Array.isArray(Observer.supportedEntryTypes) && !Observer.supportedEntryTypes.includes("longtask")) {
        supported = false;
      }
    } catch (_) {}
    if (!supported) return;
    try {
      state.longTaskObserver = new Observer((list) => {
        if (!list || typeof list.getEntries !== "function") return;
        const entries = list.getEntries();
        for (const entry of entries){
          if (entry && entry.entryType === "longtask") {
            state.longTaskCount += 1;
          }
        }
      });
      state.longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch (_) {
      state.longTaskObserver = null;
    }
  }

  function stopLongTaskObserver(){
    if (!state.longTaskObserver) return;
    try { state.longTaskObserver.disconnect(); } catch (_) {}
    state.longTaskObserver = null;
  }

  function calculateStats(){
    if (!state.fpsSamples.length) {
      return { avg: 0, min: 0, max: 0 };
    }
    let min = state.fpsSamples[0];
    let max = state.fpsSamples[0];
    let sum = 0;
    for (const sample of state.fpsSamples){
      if (sample < min) min = sample;
      if (sample > max) max = sample;
      sum += sample;
    }
    const avg = sum / state.fpsSamples.length;
    return {
      avg: Number(avg.toFixed(1)),
      min: Number(min.toFixed(1)),
      max: Number(max.toFixed(1)),
    };
  }

  function emitSnapshot(){
    if (!state.installed) return;
    const stats = calculateStats();
    const entry = {
      category: "perf",
      level: "info",
      message: "Performance sample",
      details: {
        fps: stats,
        longTasks: state.longTaskCount,
        samples: state.fpsSamples.slice(),
      },
      timestamp: Date.now(),
    };
    try { state.emitter(entry); } catch (_) {}
  }

  return { install, teardown };
});
