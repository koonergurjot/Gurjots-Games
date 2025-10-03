/* Gurjot's Games — diagnostics/adapter.js
   Registry for per-game diagnostics adapters that integrate with diag-core.
*/

const HOOK_KEYS = Object.freeze(["onReady", "onError", "onStateChange", "onScoreChange"]);
const API_KEYS = Object.freeze(["start", "pause", "resume", "reset", "getScore", "setDifficulty", "getEntities"]);

const registry = new Map();
const listeners = new Set();

function registerGameDiagnostics(slug, adapter){
  const normalizedSlug = normalizeSlug(slug);
  const hooks = normalizeHooks(adapter);
  const api = normalizeApi(adapter);
  const record = Object.freeze({
    slug: normalizedSlug,
    hooks: Object.freeze(hooks),
    api: Object.freeze(api),
  });
  registry.set(normalizedSlug, record);
  notifyListeners(normalizedSlug, record);
  return record;
}

function getGameDiagnostics(slug){
  if (typeof slug !== "string" || !slug.trim()) return null;
  return registry.get(slug.trim()) || null;
}

function subscribe(listener){
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function normalizeSlug(value){
  if (typeof value !== "string") {
    throw new TypeError("registerGameDiagnostics requires a slug string");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TypeError("registerGameDiagnostics requires a non-empty slug");
  }
  return trimmed;
}

function normalizeHooks(adapter){
  const hooks = {};
  const source = adapter && typeof adapter === "object" ? adapter.hooks || {} : {};
  for (const key of HOOK_KEYS){
    if (typeof source[key] === "function") {
      hooks[key] = source[key];
    }
  }
  return hooks;
}

function normalizeApi(adapter){
  const api = {};
  const source = adapter && typeof adapter === "object" ? (adapter.api || adapter.apis || {}) : {};
  for (const key of API_KEYS){
    if (typeof source[key] === "function") {
      api[key] = source[key];
    }
  }
  return api;
}

function notifyListeners(slug, record){
  if (!listeners.size) return;
  listeners.forEach((listener) => {
    try {
      listener(slug, record);
    } catch (err) {
      console.warn("[gg-diag] adapter listener failed", err);
    }
  });
}

const exportedApi = {
  registerGameDiagnostics,
  getGameDiagnostics,
  subscribe,
  HOOK_KEYS: Array.from(HOOK_KEYS),
  API_KEYS: Array.from(API_KEYS),
};

const globalScope = typeof window !== "undefined"
  ? window
  : (typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : undefined));

if (typeof module === "object" && module && typeof module.exports === "object") {
  module.exports = exportedApi;
}

if (globalScope) {
  const existing = globalScope.GGDiagAdapters && typeof globalScope.GGDiagAdapters === "object"
    ? globalScope.GGDiagAdapters
    : {};
  globalScope.GGDiagAdapters = Object.assign({}, existing, exportedApi);
}

export { registerGameDiagnostics, getGameDiagnostics, subscribe, HOOK_KEYS, API_KEYS };
