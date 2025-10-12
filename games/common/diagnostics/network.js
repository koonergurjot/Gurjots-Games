/* Gurjot's Games — diagnostics/network.js
   Network diagnostics collector that instruments fetch and XMLHttpRequest.
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
    scope.GGDiagCollectors = Object.assign({}, existing, { network: api });
  }
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : undefined), function(globalScope){
  const state = {
    installed: false,
    teardownCallbacks: [],
  };

  function install(options = {}){
    if (state.installed) {
      return { teardown };
    }
    const scope = options.scope || globalScope;
    if (!scope) {
      state.installed = true;
      return { teardown };
    }
    const emitter = createEmitter(scope, options);
    state.teardownCallbacks = [];

    const fetchUndo = patchFetch(scope, emitter);
    if (fetchUndo) state.teardownCallbacks.push(fetchUndo);

    const xhrUndo = patchXhr(scope, emitter);
    if (xhrUndo) state.teardownCallbacks.push(xhrUndo);

    state.installed = true;
    return { teardown };
  }

  function teardown(){
    if (!state.installed) return;
    state.installed = false;
    const callbacks = state.teardownCallbacks.splice(0);
    for (const callback of callbacks){
      try { callback(); } catch (_) {}
    }
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

  function now(scope){
    const perf = scope && scope.performance;
    if (perf && typeof perf.now === "function") {
      try { return perf.now(); } catch (_) {}
    }
    return Date.now();
  }

  function normalizeUrl(value){
    if (typeof value === "string" && value) return value;
    if (!value) return "";
    try { return String(value); } catch (_) { return ""; }
  }

  function normalizeMethod(value){
    if (typeof value !== "string" || !value) return "GET";
    return value.toUpperCase();
  }

  function deriveLevel(status, error){
    if (error) return "error";
    if (typeof status === "number") {
      if (!Number.isFinite(status) || status <= 0) return "error";
      if (status >= 500) return "error";
      if (status >= 400) return "warn";
    }
    return "info";
  }

  function buildEntry(details){
    const url = normalizeUrl(details.url) || "network request";
    const method = normalizeMethod(details.method);
    const status = typeof details.status === "number" && Number.isFinite(details.status)
      ? Math.round(details.status)
      : null;
    const duration = typeof details.durationMs === "number" && Number.isFinite(details.durationMs)
      ? Math.max(0, Math.round(details.durationMs))
      : null;
    const bytes = typeof details.bytes === "number" && Number.isFinite(details.bytes)
      ? Math.max(0, Math.round(details.bytes))
      : null;
    const error = details.error ? String(details.error) : null;
    const statusText = typeof details.statusText === "string" && details.statusText ? details.statusText : null;
    const level = deriveLevel(status, error);

    const entryDetails = {
      method,
      url,
    };
    if (status !== null) entryDetails.status = status;
    if (duration !== null) entryDetails.durationMs = duration;
    if (bytes !== null) entryDetails.bytes = bytes;
    if (statusText) entryDetails.statusText = statusText;
    if (error) entryDetails.error = error;

    return {
      category: "network",
      level,
      message: url,
      details: entryDetails,
      timestamp: Date.now(),
    };
  }

  function emitRequest(emitter, payload){
    try {
      emitter(buildEntry(payload));
    } catch (_) {}
  }

  function resolveFetchRequest(input, init){
    let method = "GET";
    let url = "";
    try {
      if (init && typeof init.method === "string") {
        method = init.method;
      }
      if (typeof input === "string") {
        url = input;
      } else if (input && typeof input === "object") {
        if (typeof input.method === "string") method = input.method;
        if (typeof input.url === "string") url = input.url;
      }
    } catch (_) {}
    return { method: normalizeMethod(method), url: normalizeUrl(url) };
  }

  function extractResponseBytes(scope, response){
    if (!response) return null;
    try {
      if (response.headers && typeof response.headers.get === "function") {
        const header = response.headers.get("content-length") || response.headers.get("Content-Length");
        if (header) {
          const parsed = Number(header);
          if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
          }
        }
      }
    } catch (_) {}
    try {
      if (typeof response.body === "object" && response.body && typeof response.body.getReader === "function") {
        // Unable to compute without consuming body; skip.
        return null;
      }
    } catch (_) {}
    try {
      if (typeof response._bodyInit === "string") {
        return estimateStringBytes(scope, response._bodyInit);
      }
      if (response._bodyInit && typeof response._bodyInit === "object") {
        const body = response._bodyInit;
        if (typeof body.size === "number" && Number.isFinite(body.size)) return body.size;
        if (typeof body.byteLength === "number" && Number.isFinite(body.byteLength)) return body.byteLength;
      }
    } catch (_) {}
    return null;
  }

  function estimateStringBytes(scope, value){
    if (typeof value !== "string") return null;
    try {
      const Encoder = scope && scope.TextEncoder;
      if (typeof Encoder === "function") {
        return new Encoder().encode(value).length;
      }
    } catch (_) {}
    try {
      const BlobCtor = (scope && scope.Blob) || (typeof Blob === "function" ? Blob : null);
      if (BlobCtor) {
        return new BlobCtor([value]).size;
      }
    } catch (_) {}
    return value.length;
  }

  function patchFetch(scope, emitter){
    const fetchFn = scope && scope.fetch;
    if (typeof fetchFn !== "function") return null;
    if (fetchFn.__ggDiagNetworkPatched) return null;

    const wrappedFetch = function patchedFetch(input, init){
      const started = now(scope);
      const context = resolveFetchRequest(input, init);
      let finished = false;
      const finalize = (response, error) => {
        if (finished) return;
        finished = true;
        const durationMs = now(scope) - started;
        let status = null;
        let statusText = null;
        let bytes = null;
        try {
          if (response && typeof response.status === "number") status = response.status;
          if (response && typeof response.statusText === "string") statusText = response.statusText;
          bytes = extractResponseBytes(scope, response);
        } catch (_) {}
        const errorMessage = error ? (error && error.message ? error.message : String(error)) : null;
        emitRequest(emitter, {
          method: context.method,
          url: context.url,
          status,
          statusText,
          durationMs,
          bytes,
          error: errorMessage,
        });
      };

      try {
        const result = fetchFn.apply(this, arguments);
        if (!result || typeof result.then !== "function") {
          finalize(result, null);
          return result;
        }
        return result.then((response) => {
          finalize(response, null);
          return response;
        }).catch((error) => {
          finalize(null, error);
          throw error;
        });
      } catch (err) {
        finalize(null, err);
        throw err;
      }
    };
    wrappedFetch.__ggDiagNetworkPatched = true;

    scope.fetch = wrappedFetch;

    return () => {
      if (scope.fetch === wrappedFetch) {
        scope.fetch = fetchFn;
      }
    };
  }

  function patchXhr(scope, emitter){
    const XHR = scope && scope.XMLHttpRequest;
    if (!XHR || !XHR.prototype) return null;
    const proto = XHR.prototype;
    if (proto.__ggDiagNetworkPatched) return null;

    const originalOpen = proto.open;
    const originalSend = proto.send;
    const requestMap = new WeakMap();

    const patchedOpen = function patchedOpen(method, url){
      const info = requestMap.get(this) || {};
      info.method = normalizeMethod(method);
      info.url = normalizeUrl(url);
      info.start = null;
      info.done = false;
      requestMap.set(this, info);
      return originalOpen.apply(this, arguments);
    };

    const patchedSend = function patchedSend(){
      const info = requestMap.get(this) || {};
      info.start = now(scope);
      info.done = false;
      requestMap.set(this, info);

      const finalize = (type, error) => {
        if (info.done) return;
        info.done = true;
        try {
          this.removeEventListener("loadend", onLoadEnd);
          this.removeEventListener("error", onError);
          this.removeEventListener("abort", onAbort);
          this.removeEventListener("timeout", onTimeout);
        } catch (_) {}
        const end = now(scope);
        let status = null;
        let statusText = null;
        let bytes = null;
        let url = info.url;
        try {
          if (typeof this.status === "number") status = this.status;
          if (typeof this.statusText === "string") statusText = this.statusText;
          if (typeof this.responseURL === "string" && this.responseURL) url = this.responseURL;
          bytes = estimateXhrBytes(scope, this);
        } catch (_) {}
        let errorMessage = null;
        if (error) {
          errorMessage = error;
        } else if (type === "abort") {
          errorMessage = "Request aborted";
        } else if (type === "timeout") {
          errorMessage = "Request timed out";
        }
        emitRequest(emitter, {
          method: info.method || "GET",
          url,
          status,
          statusText,
          durationMs: info.start ? (end - info.start) : null,
          bytes,
          error: errorMessage,
        });
        requestMap.delete(this);
      };

      const onLoadEnd = () => finalize("loadend", null);
      const onError = () => finalize("error", "Network error");
      const onAbort = () => finalize("abort", null);
      const onTimeout = () => finalize("timeout", null);

      try {
        this.addEventListener("loadend", onLoadEnd);
        this.addEventListener("error", onError);
        this.addEventListener("abort", onAbort);
        this.addEventListener("timeout", onTimeout);
      } catch (_) {}

      return originalSend.apply(this, arguments);
    };

    patchedOpen.__ggDiagNetworkPatched = true;
    patchedSend.__ggDiagNetworkPatched = true;
    proto.__ggDiagNetworkPatched = true;

    proto.open = patchedOpen;
    proto.send = patchedSend;

    return () => {
      try {
        if (proto.open === patchedOpen) proto.open = originalOpen;
      } catch (_) {}
      try {
        if (proto.send === patchedSend) proto.send = originalSend;
      } catch (_) {}
      delete proto.__ggDiagNetworkPatched;
    };
  }

  function estimateXhrBytes(scope, xhr){
    if (!xhr) return null;
    try {
      if (typeof xhr.getResponseHeader === "function") {
        const header = xhr.getResponseHeader("Content-Length") || xhr.getResponseHeader("content-length");
        if (header) {
          const parsed = Number(header);
          if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
          }
        }
      }
    } catch (_) {}
    try {
      const response = xhr.response;
      if (typeof response === "string") {
        return estimateStringBytes(scope, response);
      }
      if (response && typeof response === "object") {
        if (typeof response.size === "number" && Number.isFinite(response.size)) return response.size;
        if (typeof response.byteLength === "number" && Number.isFinite(response.byteLength)) return response.byteLength;
      }
    } catch (_) {}
    return null;
  }

  return { install, teardown };
});
