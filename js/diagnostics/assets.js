(function(global){
  var DEFAULT_TIMEOUT = 5000;
  var SLOW_THRESHOLD = 2000;

  function now(){
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function createTimeoutError(){
    var err = new Error('Request timed out');
    err.name = 'TimeoutError';
    return err;
  }

  function fetchWithTimeout(url, options, timeout){
    timeout = typeof timeout === 'number' && timeout > 0 ? timeout : DEFAULT_TIMEOUT;
    options = options ? Object.assign({}, options) : {};
    var controller = null;
    if (typeof AbortController !== 'undefined') {
      try {
        controller = new AbortController();
        options.signal = controller.signal;
      } catch(_){ controller = null; }
    }
    return new Promise(function(resolve, reject){
      var finished = false;
      var timer = setTimeout(function(){
        if (finished) return;
        finished = true;
        if (controller && typeof controller.abort === 'function') {
          try { controller.abort(); } catch(_){ }
        }
        reject(createTimeoutError());
      }, timeout);
      try {
        fetch(url, options).then(function(response){
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolve(response);
        }).catch(function(err){
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          reject(err);
        });
      } catch(err) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  function normalizeAssets(assets){
    var out = [];
    function visit(item){
      if (item == null) return;
      if (typeof item === 'string') {
        var trimmed = item.trim();
        if (trimmed) out.push(trimmed);
        return;
      }
      if (Array.isArray(item)) {
        for (var i = 0; i < item.length; i++) {
          visit(item[i]);
        }
        return;
      }
      if (typeof item === 'object') {
        for (var key in item) {
          if (Object.prototype.hasOwnProperty.call(item, key)) {
            visit(item[key]);
          }
        }
      }
    }
    visit(assets);
    var seen = Object.create(null);
    var deduped = [];
    for (var j = 0; j < out.length; j++) {
      var entry = out[j];
      if (!seen[entry]) {
        seen[entry] = true;
        deduped.push(entry);
      }
    }
    return deduped;
  }

  function classifyResult(result){
    if (!result || !result.ok) {
      return {
        level: 'error',
        message: result && result.status ? 'Asset missing (' + result.status + ')' : 'Asset missing'
      };
    }
    if (result.duration > SLOW_THRESHOLD) {
      return {
        level: 'warn',
        message: 'Asset slow (' + Math.round(result.duration) + ' ms)'
      };
    }
    if (result.fallback) {
      return {
        level: 'info',
        message: 'Asset reachable (GET fallback)'
      };
    }
    return {
      level: 'info',
      message: 'Asset reachable'
    };
  }

  function parseStatus(error){
    if (!error) return 'error';
    if (error.name === 'TimeoutError') return 'timeout';
    if (error.name === 'AbortError') return 'aborted';
    return 'error';
  }

  function checkAsset(url, timeout){
    var start = now();
    var absoluteStart = Date.now();
    var fallback = false;
    var finalStatus = null;
    var ok = false;
    var finalError = null;

    function finalize(response){
      if (response) {
        ok = !!response.ok;
        if (typeof response.status === 'number') {
          finalStatus = response.status;
        }
      }
      var duration = now() - start;
      var summary = classifyResult({
        ok: ok,
        duration: duration,
        fallback: fallback,
        status: finalStatus
      });
      if (!ok && !finalStatus && finalError) {
        finalStatus = parseStatus(finalError);
      }
      return {
        url: url,
        ok: ok,
        status: finalStatus,
        duration: duration,
        fallback: fallback,
        ts: absoluteStart + duration,
        level: summary.level,
        message: summary.message
      };
    }

    function attempt(method){
      return fetchWithTimeout(url, { method: method, cache: 'no-cache' }, timeout);
    }

    return attempt('HEAD').then(function(res){
      if (res && res.ok) {
        return finalize(res);
      }
      fallback = true;
      return attempt('GET').then(function(res2){
        return finalize(res2);
      }).catch(function(err){
        finalError = err;
        return finalize(null);
      });
    }).catch(function(err){
      fallback = true;
      return attempt('GET').then(function(res){
        return finalize(res);
      }).catch(function(err2){
        finalError = err2 || err;
        return finalize(null);
      });
    });
  }

  function emitEvents(events){
    var bus = global && global.DiagnosticsBus && typeof global.DiagnosticsBus.emit === 'function'
      ? global.DiagnosticsBus
      : null;
    var emitted = false;
    if (bus) {
      emitted = true;
      for (var i = 0; i < events.length; i++) {
        try { bus.emit(events[i]); } catch(_){ }
      }
    }
    return emitted;
  }

  function preflight(assets, timeout){
    var list = normalizeAssets(assets);
    if (!list.length) {
      return Promise.resolve({ items: [], events: [], emitted: false });
    }
    timeout = typeof timeout === 'number' && timeout > 0 ? timeout : DEFAULT_TIMEOUT;
    var promises = [];
    for (var i = 0; i < list.length; i++) {
      promises.push(checkAsset(list[i], timeout));
    }
    return Promise.all(promises).then(function(results){
      var events = [];
      for (var j = 0; j < results.length; j++) {
        var item = results[j];
        events.push({
          topic: 'asset',
          level: item.level,
          message: item.message,
          details: {
            url: item.url,
            status: item.status,
            duration: item.duration
          },
          ts: item.ts
        });
      }
      var emitted = emitEvents(events);
      return { items: results, events: events, emitted: emitted };
    }).catch(function(err){
      return { items: [], events: [], emitted: false, error: err };
    });
  }

  if (global) {
    global.DiagnosticsAssets = {
      preflight: preflight
    };
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
