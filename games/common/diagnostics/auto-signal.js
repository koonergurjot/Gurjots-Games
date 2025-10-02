const win = typeof window === "undefined" ? null : window;
const doc = win && win.document ? win.document : null;
let installed = false;

const MAX_ERROR_LENGTH = 500;
const OMIT_KEYS = new Set(["type", "status", "signal", "event", "action", "payload"]);

function normalizeType(input) {
  if (!input && input !== 0) return null;
  const normalized = String(input).trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!normalized) return null;
  if (normalized === "READY" || normalized === "GAME_READY") return "ready";
  if (normalized === "ERROR" || normalized === "GAME_ERROR" || normalized === "FAIL" || normalized === "FAILURE") {
    return "error";
  }
  return null;
}

function toErrorMessage(value) {
  if (value === null || value === undefined) return "Unknown error";
  if (typeof value === "string") return value.slice(0, MAX_ERROR_LENGTH);
  if (typeof value === "object") {
    if (value instanceof Error) {
      const msg = value.message || String(value);
      return msg.slice(0, MAX_ERROR_LENGTH);
    }
    const message =
      (typeof value.error === "string" && value.error) ||
      (typeof value.message === "string" && value.message) ||
      (typeof value.reason === "string" && value.reason);
    if (message) return message.slice(0, MAX_ERROR_LENGTH);
    try {
      const serialized = JSON.stringify(value);
      if (serialized) return serialized.slice(0, MAX_ERROR_LENGTH);
    } catch (_err) {}
    return "Unknown error";
  }
  return String(value).slice(0, MAX_ERROR_LENGTH);
}

function extractPayload(detail) {
  if (!detail || typeof detail !== "object") return undefined;
  if (detail.payload && typeof detail.payload === "object") return { ...detail.payload };
  const payload = {};
  for (const key of Object.keys(detail)) {
    if (OMIT_KEYS.has(key)) continue;
    const value = detail[key];
    if (value !== undefined) payload[key] = value;
  }
  return Object.keys(payload).length ? payload : undefined;
}

function extractErrorPayload(detail) {
  const payload = extractPayload(detail) || {};
  const source =
    detail && typeof detail === "object"
      ? detail.error || detail.reason || detail.message
      : detail;
  const message = toErrorMessage(source);
  if (typeof payload.error !== "string" || !payload.error) {
    payload.error = message;
  }
  return payload;
}

function detectType(event, detail) {
  const byDetail = detail && typeof detail === "object" ? detail.type || detail.status || detail.signal || detail.event || detail.action : null;
  const fromDetail = normalizeType(byDetail || (typeof detail === "string" ? detail : null));
  if (fromDetail) return fromDetail;
  const inferred = event && typeof event.type === "string" ? normalizeType(event.type.split(":").pop()) : null;
  if (inferred) return inferred;
  if (detail && typeof detail === "object") {
    if (detail.ready === true) return "ready";
    if (detail.error || detail.reason || detail.failure || detail.failed === true) return "error";
  }
  return null;
}

function install() {
  if (installed || !win) return;
  installed = true;
  if (win.__gg_autoSignalInstalled) return;
  win.__gg_autoSignalInstalled = true;

  let signalled = false;

  const send = (type, payload) => {
    try {
      if (!win.parent) return;
      const data = payload && typeof payload === "object" ? { ...payload } : undefined;
      win.parent.postMessage(Object.assign({ type }, data || {}), "*");
    } catch (_err) {}
  };

  const markSignalled = () => {
    signalled = true;
  };

  const emitReady = (detail) => {
    if (signalled) return;
    send("GAME_READY", detail);
    markSignalled();
  };

  const emitError = (detail) => {
    send("GAME_ERROR", detail);
    markSignalled();
  };

  win.addEventListener("message", (event) => {
    const type = event && event.data && event.data.type;
    if (type === "GAME_READY" || type === "GAME_ERROR") {
      markSignalled();
    }
  });

  win.addEventListener("error", (event) => {
    const payload = extractErrorPayload({ error: event && (event.message || event.error) });
    emitError(payload);
  });

  win.addEventListener("unhandledrejection", (event) => {
    const payload = extractErrorPayload({ error: event && event.reason });
    emitError(payload);
  });

  const handleCustomEvent = (event) => {
    if (!event) return;
    const detail = event.detail;
    const type = detectType(event, detail);
    if (!type) return;
    if (type === "ready") {
      const payload = extractPayload(detail);
      emitReady(payload);
    } else if (type === "error") {
      const payload = extractErrorPayload(detail);
      emitError(payload);
    }
  };

  const customEvents = [
    "gg:auto-signal",
    "gg:auto-signal:ready",
    "gg:auto-signal:error",
    "ggshell:auto-signal",
    "ggshell:auto-signal:ready",
    "ggshell:auto-signal:error",
    "gg:game-ready",
    "gg:game-error"
  ];

  for (const target of [win, doc]) {
    if (!target || typeof target.addEventListener !== "function") continue;
    for (const evt of customEvents) {
      target.addEventListener(evt, handleCustomEvent);
    }
  }

  win.__gg_autoSignal = {
    ready(payload) {
      emitReady(payload && typeof payload === "object" ? payload : undefined);
    },
    error(detail) {
      emitError(extractErrorPayload(detail));
    },
  };

  const emitReadyOnce = () => {
    if (!signalled) {
      emitReady();
    }
  };

  if (doc && doc.readyState === "complete") {
    setTimeout(emitReadyOnce, 0);
  } else if (win.addEventListener) {
    win.addEventListener("load", () => setTimeout(emitReadyOnce, 0));
  }
}

export function installAutoSignal() {
  install();
}

if (typeof document !== "undefined") {
  installAutoSignal();
}
