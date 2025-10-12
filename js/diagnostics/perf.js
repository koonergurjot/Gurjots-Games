(function(global){
  if (!global) return;
  if (global.__DIAG_PERF_PATCHED__) return;
  global.__DIAG_PERF_PATCHED__ = true;

  var perf;
  try { perf = global.performance; } catch(_) { perf = null; }

  var raf = typeof global.requestAnimationFrame === 'function'
    ? global.requestAnimationFrame.bind(global)
    : null;
  var setIntervalFn = typeof global.setInterval === 'function'
    ? global.setInterval.bind(global)
    : null;

  var fpsSamples = [];
  var MAX_SAMPLES = 120;
  var lastRafTime = null;
  var totalLongTasks = 0;
  var pendingLongTasks = 0;

  function getNow() {
    try {
      if (perf && typeof perf.now === 'function') {
        return perf.now();
      }
    } catch(_){ }
    return Date.now();
  }

  function safeEmit(event) {
    if (!event) return;
    try {
      var bus = global.DiagnosticsBus;
      if (bus && typeof bus.emit === 'function') {
        bus.emit(event);
      }
    } catch(_){ }
  }

  function recordSample(deltaMs) {
    if (typeof deltaMs !== 'number' || !isFinite(deltaMs) || deltaMs <= 0) return;
    var fps = 1000 / deltaMs;
    if (!isFinite(fps) || fps <= 0) return;
    fpsSamples.push(fps);
    if (fpsSamples.length > MAX_SAMPLES) {
      fpsSamples.splice(0, fpsSamples.length - MAX_SAMPLES);
    }
  }

  function computeFpsStats() {
    if (!fpsSamples.length) {
      return { latest: null, min: null, max: null, avg: null };
    }
    var latest = fpsSamples[fpsSamples.length - 1];
    var min = latest;
    var max = latest;
    var sum = 0;
    var count = 0;
    for (var i = 0; i < fpsSamples.length; i++) {
      var value = fpsSamples[i];
      if (typeof value !== 'number' || !isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
      sum += value;
      count += 1;
    }
    if (!count) {
      return { latest: null, min: null, max: null, avg: null };
    }
    return {
      latest: latest,
      min: min,
      max: max,
      avg: sum / count
    };
  }

  function emitPerfSample() {
    var fpsStats = computeFpsStats();
    var event = {
      topic: 'performance',
      ts: Date.now(),
      details: {
        fps: fpsStats,
        longTasks: {
          interval: pendingLongTasks,
          total: totalLongTasks
        }
      }
    };
    pendingLongTasks = 0;
    safeEmit(event);
  }

  function rafTick(timestamp) {
    var now = typeof timestamp === 'number' && isFinite(timestamp) ? timestamp : getNow();
    if (lastRafTime != null) {
      var delta = now - lastRafTime;
      if (delta > 0) recordSample(delta);
    }
    lastRafTime = now;
    try {
      raf(rafTick);
    } catch(_){ }
  }

  if (raf) {
    try { raf(rafTick); } catch(_){ }
  }

  var PerformanceObserverCtor = typeof global.PerformanceObserver === 'function'
    ? global.PerformanceObserver
    : null;
  if (PerformanceObserverCtor) {
    try {
      var observer = new PerformanceObserverCtor(function(list){
        if (!list) return;
        var entries = typeof list.getEntries === 'function' ? list.getEntries() : [];
        if (!entries || !entries.length) return;
        for (var i = 0; i < entries.length; i++) {
          totalLongTasks += 1;
          pendingLongTasks += 1;
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch(_){ }
  }

  if (setIntervalFn) {
    setIntervalFn(emitPerfSample, 1000);
  }
  emitPerfSample();
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
