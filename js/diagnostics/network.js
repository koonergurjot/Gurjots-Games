(function(global){
  if (!global) return;
  if (global.__DIAG_NETWORK_PATCHED__) return;
  global.__DIAG_NETWORK_PATCHED__ = true;

  var perf;
  try { perf = global.performance; } catch(_) { perf = null; }

  function getPerfNow() {
    try {
      if (perf && typeof perf.now === 'function') {
        return perf.now();
      }
    } catch(_){ }
    return null;
  }

  function computeDuration(startPerf, endPerf, startWall, endWall) {
    if (typeof startPerf === 'number' && typeof endPerf === 'number') {
      var diff = endPerf - startPerf;
      return diff >= 0 ? diff : 0;
    }
    if (typeof startWall === 'number' && typeof endWall === 'number') {
      var delta = endWall - startWall;
      return delta >= 0 ? delta : 0;
    }
    return null;
  }

  function toNumber(value) {
    if (value == null || value === '') return null;
    var num = Number(value);
    if (typeof num === 'number' && isFinite(num)) return num;
    return null;
  }

  function parseMethod(method) {
    if (!method && method !== 0) return 'GET';
    try {
      return String(method).toUpperCase();
    } catch(_){
      return 'GET';
    }
  }

  function parseUrl(value) {
    if (value == null) return '';
    try {
      return String(value);
    } catch(_){
      return '';
    }
  }

  function emitNetwork(startWall, payload) {
    if (!payload) return;
    var event = {
      topic: 'network',
      ts: typeof startWall === 'number' ? startWall : Date.now(),
      details: {
        method: parseMethod(payload.method),
        url: parseUrl(payload.url)
      }
    };
    var status = toNumber(payload.status);
    if (status != null) {
      event.details.status = status;
    } else if (payload.status === 0) {
      event.details.status = 0;
    }
    var duration = toNumber(payload.duration);
    if (duration != null) {
      event.details.duration = duration;
    }
    var bytes = toNumber(payload.bytes);
    if (bytes != null) {
      event.details.bytes = bytes;
    }
    if (payload.ok != null) {
      event.details.ok = !!payload.ok;
    }
    if (payload.error) {
      try {
        event.details.error = String(payload.error);
      } catch(_){
        event.details.error = 'error';
      }
    }
    try {
      var bus = global.DiagnosticsBus;
      if (bus && typeof bus.emit === 'function') {
        bus.emit(event);
      }
    } catch(_){ }
  }

  function describeError(err) {
    if (!err && err !== 0) return null;
    try {
      if (err && typeof err === 'object' && err.message) {
        return String(err.message);
      }
      return String(err);
    } catch(_){
      return 'error';
    }
  }

  function getRequestInfo(input, init) {
    var method = (init && init.method) || (input && input.method) || 'GET';
    var url = '';
    if (typeof input === 'string') {
      url = input;
    } else if (input && typeof input.url === 'string') {
      url = input.url;
    } else if (input && input.href) {
      url = input.href;
    }
    return {
      method: parseMethod(method),
      url: parseUrl(url)
    };
  }

  function extractFetchBytes(response) {
    if (!response) return null;
    try {
      if (response.headers && typeof response.headers.get === 'function') {
        var len = response.headers.get('content-length');
        var parsed = toNumber(len);
        if (parsed != null) return parsed;
      }
    } catch(_){ }
    try {
      if (response.headers && typeof response.headers.get === 'function') {
        var lenAlt = response.headers.get('Content-Length');
        var parsedAlt = toNumber(lenAlt);
        if (parsedAlt != null) return parsedAlt;
      }
    } catch(_){ }
    return null;
  }

  function extractXHRBytes(xhr) {
    if (!xhr) return null;
    try {
      if (typeof xhr.getResponseHeader === 'function') {
        var header = xhr.getResponseHeader('Content-Length');
        var parsed = toNumber(header);
        if (parsed != null) return parsed;
      }
    } catch(_){ }
    try {
      var response = xhr.response;
      if (response == null) {
        if (typeof xhr.responseText === 'string') {
          if (typeof global.Blob === 'function') {
            return new global.Blob([xhr.responseText]).size;
          }
          return xhr.responseText.length;
        }
        return null;
      }
      if (typeof response === 'string') {
        if (typeof global.Blob === 'function') {
          return new global.Blob([response]).size;
        }
        return response.length;
      }
      if (typeof ArrayBuffer !== 'undefined' && response instanceof ArrayBuffer) {
        return response.byteLength;
      }
      if (response && typeof response.size === 'number') {
        return response.size;
      }
      if (response && typeof response.byteLength === 'number') {
        return response.byteLength;
      }
    } catch(_){ }
    return null;
  }

  var originalFetch = typeof global.fetch === 'function' ? global.fetch : null;
  if (originalFetch) {
    global.fetch = function patchedFetch(input, init) {
      var info = getRequestInfo(input, init);
      var startWall = Date.now();
      var startPerf = getPerfNow();
      function finalize(response, error) {
        var endWall = Date.now();
        var endPerf = getPerfNow();
        var duration = computeDuration(startPerf, endPerf, startWall, endWall);
        var status = null;
        var ok = null;
        var bytes = null;
        if (response) {
          try { status = response.status; } catch(_){ status = null; }
          try { ok = response.ok; } catch(_){ ok = null; }
          bytes = extractFetchBytes(response);
        }
        if (status == null && error) {
          status = 0;
        }
        if (error && ok == null) {
          ok = false;
        }
        emitNetwork(startWall, {
          method: info.method,
          url: info.url,
          status: status,
          ok: ok,
          duration: duration,
          bytes: bytes,
          error: describeError(error)
        });
      }
      return originalFetch.apply(this, arguments).then(function(response){
        finalize(response, null);
        return response;
      }).catch(function(err){
        finalize(null, err);
        throw err;
      });
    };
  }

  var OriginalXHR = typeof global.XMLHttpRequest === 'function' ? global.XMLHttpRequest : null;
  if (OriginalXHR && OriginalXHR.prototype) {
    var originalOpen = OriginalXHR.prototype.open;
    var originalSend = OriginalXHR.prototype.send;
    if (typeof originalOpen === 'function' && typeof originalSend === 'function') {
      OriginalXHR.prototype.open = function(method, url) {
        this.__diagNetwork = this.__diagNetwork || {};
        this.__diagNetwork.method = parseMethod(method);
        this.__diagNetwork.url = parseUrl(url);
        return originalOpen.apply(this, arguments);
      };
      OriginalXHR.prototype.send = function() {
        this.__diagNetwork = this.__diagNetwork || {};
        var info = this.__diagNetwork;
        if (!info.method) info.method = 'GET';
        var startWall = Date.now();
        var startPerf = getPerfNow();
        var xhr = this;
        var settled = false;
        function cleanup(reason) {
          if (settled) return;
          settled = true;
          try { xhr.removeEventListener('loadend', onLoadEnd); } catch(_){ }
          try { xhr.removeEventListener('error', onError); } catch(_){ }
          try { xhr.removeEventListener('abort', onAbort); } catch(_){ }
          try { xhr.removeEventListener('timeout', onTimeout); } catch(_){ }
          var endWall = Date.now();
          var endPerf = getPerfNow();
          var duration = computeDuration(startPerf, endPerf, startWall, endWall);
          var status = null;
          try { status = xhr.status; } catch(_){ status = null; }
          if ((status == null || !isFinite(status)) && reason && reason !== 'loadend') {
            status = 0;
          }
          var bytes = extractXHRBytes(xhr);
          emitNetwork(startWall, {
            method: info.method,
            url: info.url,
            status: status,
            duration: duration,
            bytes: bytes,
            error: reason && reason !== 'loadend' ? describeError(reason) : null
          });
        }
        function onLoadEnd(){ cleanup('loadend'); }
        function onError(){ cleanup('error'); }
        function onAbort(){ cleanup('abort'); }
        function onTimeout(){ cleanup('timeout'); }
        try {
          xhr.addEventListener('loadend', onLoadEnd);
          xhr.addEventListener('error', onError);
          xhr.addEventListener('abort', onAbort);
          xhr.addEventListener('timeout', onTimeout);
        } catch(_){ }
        return originalSend.apply(this, arguments);
      };
    }
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
