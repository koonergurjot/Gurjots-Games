/* Gurjot's Games — diag-capture.js
   Instrumentation layer that forwards diagnostics to __GG_DIAG.
*/
(function(){
  const global = typeof window !== "undefined" ? window : globalThis;
  if (!global) return;

  const skipMonkeyPatch = !!(global.__DIAG_NO_MONKEYPATCH__ || global.__GG_DIAG_NO_MONKEYPATCH__);

  const queue = global.__GG_DIAG_QUEUE || (global.__GG_DIAG_QUEUE = []);

  function emit(entry){
    try {
      if (global.__GG_DIAG && typeof global.__GG_DIAG.log === "function") {
        global.__GG_DIAG.log(entry);
      } else {
        queue.push(entry);
      }
    } catch (err) {
      queue.push({ category: "capture", level: "error", message: "emit failure", details: safeSerialize(err) });
    }
  }

  function normalizeEvent(category, payload){
    const normalizedCategory = typeof category === "string" && category.trim()
      ? category.trim()
      : "capture";
    const source = payload && typeof payload === "object" ? payload : {};
    const entry = Object.assign({}, source);
    if (!payload || typeof payload !== "object") {
      if (payload !== undefined) entry.message = String(payload);
    }
    entry.category = normalizedCategory;
    if (!entry.level) entry.level = "info";
    if (entry.details !== undefined) {
      entry.details = safeSerialize(entry.details);
    }
    if (entry.error !== undefined) {
      entry.error = safeSerialize(entry.error);
    }
    if (typeof entry.timestamp !== "number") entry.timestamp = Date.now();
    return entry;
  }

  function pushEvent(category, payload){
    const entry = normalizeEvent(category, payload);
    emit(entry);
    return entry;
  }

  function safeSerialize(value, seen = new WeakSet(), depth = 0){
    const MAX_DEPTH = 4;
    if (value === null || value === undefined) return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }
    if (typeof value === "function") {
      return `[Function${value.name ? ` ${value.name}` : ""}]`;
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "bigint") return `${value.toString()}n`;
    if (typeof value === "symbol") return value.toString();
    if (depth >= MAX_DEPTH) {
      return `[Truncated depth ${depth}]`;
    }
    if (typeof value === "object") {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      if (Array.isArray(value)) {
        return value.slice(0, 25).map((item) => safeSerialize(item, seen, depth + 1));
      }
      if (value instanceof HTMLElement) {
        const tag = value.tagName?.toLowerCase() || "element";
        const id = value.id ? `#${value.id}` : "";
        const cls = value.className ? `.${String(value.className).replace(/\s+/g, ".")}` : "";
        return `<${tag}${id}${cls}>`;
      }
      const output = {};
      const keys = Object.keys(value).slice(0, 40);
      for (const key of keys) {
        try {
          output[key] = safeSerialize(value[key], seen, depth + 1);
        } catch (err) {
          output[key] = `[Unserializable: ${err?.message || err}]`;
        }
      }
      return output;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return String(value);
    }
  }

  function coerceMessage(parts){
    return parts.map((part) => {
      if (typeof part === "string") return part;
      try {
        return JSON.stringify(safeSerialize(part));
      } catch (_) {
        return String(part);
      }
    }).join(" ");
  }

  function logConsole(level, args){
    emit({
      category: "console",
      level,
      message: coerceMessage(args),
      details: { args: args.map((item) => safeSerialize(item)) },
      timestamp: Date.now(),
    });
  }

  function installConsoleHooks(){
    const levels = ["log", "info", "warn", "error", "debug"];
    for (const level of levels){
      const original = global.console?.[level];
      if (typeof original !== "function") continue;
      global.console[level] = function(...args){
        try {
          logConsole(level === "log" ? "info" : level, args);
        } catch (_){}
        return original.apply(this, args);
      };
    }
  }

  function installErrorHooks(){
    if (typeof global.addEventListener !== "function") return;
    global.addEventListener("error", (event) => {
      if (event.target && event.target !== global && !(event.error instanceof Error)) {
        const target = event.target;
        const url = target?.src || target?.href || target?.currentSrc;
        const tag = target?.tagName || "resource";
        emit({
          category: "resource",
          level: "error",
          message: `${tag} failed to load`,
          details: { url, node: safeSerialize(target) },
          timestamp: Date.now(),
        });
        return;
      }
      emit({
        category: "error",
        level: "error",
        message: event.message || String(event.error || "Unknown error"),
        details: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: safeSerialize(event.error || event.message),
        },
        timestamp: Date.now(),
      });
    }, { capture: true });

    global.addEventListener("unhandledrejection", (event) => {
      emit({
        category: "promise",
        level: "error",
        message: "Unhandled promise rejection",
        details: { reason: safeSerialize(event.reason) },
        timestamp: Date.now(),
      });
    });

    global.addEventListener("rejectionhandled", (event) => {
      emit({
        category: "promise",
        level: "warn",
        message: "Promise rejection handled late",
        details: { reason: safeSerialize(event.reason) },
        timestamp: Date.now(),
      });
    });
  }

  function now(){
    const perf = global.performance;
    if (perf && typeof perf.now === "function") {
      try {
        return perf.now();
      } catch (_) {}
    }
    return Date.now();
  }

  function measureDuration(start){
    if (typeof start !== "number" || !Number.isFinite(start)) return null;
    const end = now();
    const value = Math.round(end - start);
    return Number.isFinite(value) ? value : null;
  }

  function wrapFetch(){
    if (typeof global.fetch !== "function") return;
    const original = global.fetch;
    global.fetch = function(input, init){
      const start = now();
      return original.apply(this, arguments).then((response) => {
        emit({
          category: "network",
          level: response.ok ? "info" : "warn",
          message: `fetch ${serializeRequestInfo(input)} -> ${response.status}`,
          details: {
            statusText: response.statusText,
            url: response.url,
            ok: response.ok,
            duration: measureDuration(start),
          },
          timestamp: Date.now(),
        });
        return response;
      }).catch((error) => {
        emit({
          category: "network",
          level: "error",
          message: `fetch ${serializeRequestInfo(input)} failed`,
          details: {
            duration: measureDuration(start),
            error: safeSerialize(error),
          },
          timestamp: Date.now(),
        });
        throw error;
      });
    };
  }

  function wrapXHR(){
    if (!global.XMLHttpRequest) return;
    const proto = global.XMLHttpRequest.prototype;
    const open = proto.open;
    const send = proto.send;
    proto.open = function(method, url){
      this.__ggDiag = { method, url: typeof url === "string" ? url : safeSerialize(url) };
      return open.apply(this, arguments);
    };
    proto.send = function(){
      const started = now();
      const context = this.__ggDiag || { method: "GET", url: this.responseURL };
      const done = (status, statusText, level, extra) => {
        emit({
          category: "network",
          level,
          message: `xhr ${context.method} ${context.url} -> ${status}`,
          details: Object.assign({
            status,
            statusText,
            duration: measureDuration(started),
          }, extra || {}),
          timestamp: Date.now(),
        });
      };
      this.addEventListener("load", () => done(this.status, this.statusText, this.status >= 200 && this.status < 400 ? "info" : "warn"));
      this.addEventListener("error", () => done("ERR", "Network error", "error"));
      this.addEventListener("timeout", () => done("TIMEOUT", "Request timed out", "warn"));
      this.addEventListener("abort", () => done("ABORT", "Request aborted", "warn"));
      return send.apply(this, arguments);
    };
  }

  function serializeRequestInfo(input){
    try {
      if (typeof input === "string") return input;
      if (typeof Request !== "undefined" && input instanceof Request) return input.url;
      if (input && typeof input === "object" && "url" in input) return String(input.url);
      return JSON.stringify(safeSerialize(input));
    } catch (_) {
      return "[request]";
    }
  }

  function reportCapabilities(){
    emit({
      category: "environment",
      level: "info",
      message: "Environment snapshot",
      details: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        colorScheme: matchMediaSafe("(prefers-color-scheme: dark)") ? "dark" : "light",
        onLine: navigator.onLine,
        viewport: { width: global.innerWidth, height: global.innerHeight },
        timezone: tryResolveTimeZone(),
      },
      timestamp: Date.now(),
    });
  }

  function reportPerformance(){
    try {
      const perf = global.performance;
      const navEntries = perf?.getEntriesByType?.("navigation") || [];
      const nav = navEntries[0];
      const timing = perf?.timing || {};
      const memory = perf?.memory || null;
      emit({
        category: "performance",
        level: "info",
        message: "Performance snapshot",
        details: {
          navigation: nav ? pick(nav, [
            "type",
            "domContentLoadedEventEnd",
            "loadEventEnd",
            "responseEnd",
            "startTime",
            "duration",
          ]) : null,
          timing: timing ? pick(timing, [
            "navigationStart",
            "domInteractive",
            "domComplete",
            "responseStart",
            "responseEnd",
          ]) : null,
          memory: memory ? pick(memory, ["jsHeapSizeLimit", "totalJSHeapSize", "usedJSHeapSize"]) : null,
        },
        timestamp: Date.now(),
      });
    } catch (err) {
      emit({ category: "performance", level: "warn", message: "Unable to gather performance metrics", details: safeSerialize(err), timestamp: Date.now() });
    }
  }

  function reportServiceWorker(){
    if (!navigator.serviceWorker) {
      emit({ category: "service-worker", level: "warn", message: "Service workers unsupported", timestamp: Date.now() });
      return;
    }
    navigator.serviceWorker.ready.then((registration) => {
      emit({
        category: "service-worker",
        level: "info",
        message: "Service worker ready",
        details: {
          scope: registration.scope,
          active: registration.active ? registration.active.state : null,
        },
        timestamp: Date.now(),
      });
    }).catch((err) => {
      emit({ category: "service-worker", level: "warn", message: "Service worker ready() rejected", details: safeSerialize(err), timestamp: Date.now() });
    });

    navigator.serviceWorker.getRegistrations?.().then((regs) => {
      emit({
        category: "service-worker",
        level: "info",
        message: `Service worker registrations (${regs.length})`,
        details: regs.map((reg) => ({ scope: reg.scope, active: reg.active?.state, installing: reg.installing?.state, waiting: reg.waiting?.state })),
        timestamp: Date.now(),
      });
    }).catch((err) => {
      emit({ category: "service-worker", level: "warn", message: "Unable to enumerate service workers", details: safeSerialize(err), timestamp: Date.now() });
    });

    if (navigator.serviceWorker.controller) {
      emit({
        category: "service-worker",
        level: "info",
        message: "Service worker controller detected",
        details: { state: navigator.serviceWorker.controller.state },
        timestamp: Date.now(),
      });
    }
  }

  function matchMediaSafe(query){
    try {
      return global.matchMedia?.(query)?.matches || false;
    } catch (_) {
      return false;
    }
  }

  function tryResolveTimeZone(){
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (_) {
      return "unknown";
    }
  }

  function pick(source, keys){
    if (!source) return null;
    const out = {};
    for (const key of keys){
      if (key in source) out[key] = source[key];
    }
    return out;
  }

  function heartbeat(){
    const origin = Date.now();
    const perf = global.performance;
    emit({
      category: "heartbeat",
      level: "debug",
      message: "diagnostics heartbeat",
      details: {
        ts: origin,
        uptime: typeof perf?.now === "function" ? Math.round(perf.now()) : null,
        memory: safeSerialize(perf?.memory || null),
        visibilityState: global.document?.visibilityState,
      },
      timestamp: origin,
    });
  }

  function installHeartbeat(){
    heartbeat();
    if (typeof global.setInterval === "function") {
      global.setInterval(heartbeat, 5000);
    }
  }

  function installNetworkListeners(){
    if (typeof global.addEventListener !== "function") return;
    global.addEventListener("online", () => emit({ category: "network", level: "info", message: "navigator.online = true", timestamp: Date.now() }));
    global.addEventListener("offline", () => emit({ category: "network", level: "warn", message: "navigator.online = false", timestamp: Date.now() }));
  }

  installErrorHooks();
  installHeartbeat();
  installNetworkListeners();

  if (!skipMonkeyPatch) {
    installConsoleHooks();
    wrapFetch();
    wrapXHR();
  }

  reportCapabilities();
  reportPerformance();
  reportServiceWorker();

  if (global) {
    global.__GG_DIAG_PUSH_EVENT__ = pushEvent;
    global.__DIAG_CAPTURE_READY = true;
  }

  if (typeof module === "object" && module && typeof module.exports === "object") {
    module.exports = Object.assign(module.exports || {}, { pushEvent });
  }
})();
