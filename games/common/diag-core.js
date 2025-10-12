/* Gurjot's Games — diag-core.js
   Modern diagnostics console UI and runtime helpers.
*/
(function(){
  const global = typeof window !== "undefined" ? window : globalThis;
  if (!global) return;
  if (global.__GG_DIAG && typeof global.__GG_DIAG.log === "function") {
    return;
  }

  const existingQueue = Array.isArray(global.__GG_DIAG_QUEUE) ? global.__GG_DIAG_QUEUE.splice(0) : [];

  const featureFlags = resolveFeatureFlags();
  const diagV2Enabled = !!featureFlags.diag_v2;

  const mergedOpts = Object.assign({}, global.__GG_DIAG_OPTS || {});
  if (!Object.prototype.hasOwnProperty.call(mergedOpts, "suppressButton")) {
    mergedOpts.suppressButton = false;
  }
  if (diagV2Enabled) {
    mergedOpts.suppressButton = true;
  }
  mergedOpts.diagV2 = diagV2Enabled;
  global.__GG_DIAG_OPTS = mergedOpts;

  const ADAPTER_READY_TIMEOUT_MS = 5000;
  const ADAPTER_READY_POLL_INTERVAL_MS = 50;
  const adapterReadyWaiters = [];
  let adapterReadyTimer = null;
  let adapterReadyDeadline = 0;

  function resolveFeatureFlags(){
    const flags = {};
    try {
      const globalFlags = global.__GG_FEATURES;
      if (globalFlags && typeof globalFlags === "object") {
        if (Object.prototype.hasOwnProperty.call(globalFlags, "diag_v2")) {
          flags.diag_v2 = !!globalFlags.diag_v2;
        }
      }
    } catch (_) {}
    if (!Object.prototype.hasOwnProperty.call(flags, "diag_v2")) {
      try {
        if (typeof global.localStorage !== "undefined" && global.localStorage) {
          const stored = global.localStorage.getItem("diag_v2");
          if (stored === "1" || stored === "true") {
            flags.diag_v2 = true;
          } else if (stored === "0" || stored === "false") {
            flags.diag_v2 = false;
          }
        }
      } catch (_) {}
    }
    if (!Object.prototype.hasOwnProperty.call(flags, "diag_v2")) {
      flags.diag_v2 = false;
    }
    return flags;
  }

  function ensureDiagnosticsAdapterModule(){
    const resolved = resolveDiagnosticsAdapterModule();
    if (resolved) return resolved;
    const required = loadDiagnosticsAdapterModule();
    const normalized = normalizeDiagnosticsAdapterModule(required);
    if (normalized) {
      const attached = attachDiagnosticsAdapterModule(normalized);
      notifyDiagnosticsAdapterReady(attached);
      return attached;
    }
    requestDiagnosticsAdapterScript();
    return resolveDiagnosticsAdapterModule();
  }

  function resolveDiagnosticsAdapterModule(){
    return normalizeDiagnosticsAdapterModule(global.GGDiagAdapters);
  }

  function normalizeDiagnosticsAdapterModule(candidate){
    if (!candidate) return null;
    if (typeof candidate === "object") {
      if (typeof candidate.registerGameDiagnostics === "function" && typeof candidate.getGameDiagnostics === "function") {
        return candidate;
      }
      if (candidate.default && candidate.default !== candidate) {
        return normalizeDiagnosticsAdapterModule(candidate.default);
      }
    }
    return null;
  }

  function attachDiagnosticsAdapterModule(moduleApi){
    if (!moduleApi) return null;
    const existing = normalizeDiagnosticsAdapterModule(global.GGDiagAdapters);
    if (existing === moduleApi) return moduleApi;
    const merged = Object.assign({}, existing || {}, moduleApi);
    global.GGDiagAdapters = merged;
    return merged;
  }

  function loadDiagnosticsAdapterModule(){
    let required = null;
    if (typeof module === "object" && module && typeof module.require === "function") {
      try { required = module.require("./diagnostics/adapter.js"); } catch (_) {}
    }
    if (!required && typeof require === "function") {
      try { required = require("./diagnostics/adapter.js"); } catch (_) {}
    }
    if (!required) {
      requestDiagnosticsAdapterScript();
    }
    return required;
  }

  function requestDiagnosticsAdapterScript(){
    if (typeof document === "undefined") return;
    try {
      const doc = document;
      if (!doc) return;
      if (doc.querySelector('script[data-gg-diag-adapter]')) return;
      const script = doc.createElement("script");
      script.type = "module";
      script.src = "/games/common/diagnostics/adapter.js";
      script.setAttribute("data-gg-diag-adapter", "true");
      script.setAttribute("data-origin", "diag-core");
      const parent = doc.head || doc.documentElement || doc.body;
      parent?.appendChild(script);
    } catch (_) {}
  }

  function whenDiagnosticsAdapterReady(callback){
    if (typeof callback !== "function") return;
    const resolved = resolveDiagnosticsAdapterModule();
    if (resolved) {
      callback(resolved);
      return;
    }
    adapterReadyWaiters.push(callback);
    requestDiagnosticsAdapterScript();
    scheduleDiagnosticsAdapterPoll();
  }

  function scheduleDiagnosticsAdapterPoll(){
    if (!adapterReadyWaiters.length) return;
    if (adapterReadyTimer) return;
    const scheduler = typeof global.setTimeout === "function" ? global.setTimeout : (typeof setTimeout === "function" ? setTimeout : null);
    if (!scheduler) return;
    if (!adapterReadyDeadline) adapterReadyDeadline = Date.now() + ADAPTER_READY_TIMEOUT_MS;
    adapterReadyTimer = scheduler(() => {
      adapterReadyTimer = null;
      const moduleApi = resolveDiagnosticsAdapterModule();
      if (moduleApi) {
        notifyDiagnosticsAdapterReady(moduleApi);
        return;
      }
      if (adapterReadyDeadline && Date.now() >= adapterReadyDeadline) {
        adapterReadyWaiters.length = 0;
        adapterReadyDeadline = 0;
        return;
      }
      scheduleDiagnosticsAdapterPoll();
    }, ADAPTER_READY_POLL_INTERVAL_MS);
  }

  function notifyDiagnosticsAdapterReady(moduleApi){
    const resolved = normalizeDiagnosticsAdapterModule(moduleApi);
    if (!resolved) return;
    attachDiagnosticsAdapterModule(resolved);
    if (!adapterReadyWaiters.length) return;
    const waiters = adapterReadyWaiters.splice(0);
    adapterReadyDeadline = 0;
    for (const waiter of waiters){
      try { waiter(resolved); } catch (err) { console.warn("[gg-diag] adapter waiter failed", err); }
    }
  }

  const COLLECTOR_CONFIG = {
    network: { path: "./diagnostics/network.js" },
    perf: { path: "./diagnostics/perf.js" },
  };
  const COLLECTOR_RETRY_DELAY_MS = 800;

  function ensureDiagnosticsCollector(name){
    const resolved = resolveDiagnosticsCollector(name);
    if (resolved) return resolved;
    const required = loadDiagnosticsCollector(name);
    const normalized = normalizeDiagnosticsCollector(required);
    if (normalized) {
      return attachDiagnosticsCollector(name, normalized);
    }
    requestDiagnosticsCollectorScript(name);
    return resolveDiagnosticsCollector(name);
  }

  function resolveDiagnosticsCollector(name){
    if (!name) return null;
    const store = global.GGDiagCollectors;
    if (!store || typeof store !== "object") return null;
    const direct = store[name];
    if (direct) return normalizeDiagnosticsCollector(direct);
    if (store.default && store.default !== store) {
      const fallback = store.default[name];
      if (fallback) return normalizeDiagnosticsCollector(fallback);
    }
    return null;
  }

  function normalizeDiagnosticsCollector(candidate){
    if (!candidate) return null;
    if (typeof candidate.install === "function") return candidate;
    if (candidate.default && candidate.default !== candidate) {
      return normalizeDiagnosticsCollector(candidate.default);
    }
    return null;
  }

  function attachDiagnosticsCollector(name, moduleApi){
    if (!name || !moduleApi) return null;
    const existing = global.GGDiagCollectors && typeof global.GGDiagCollectors === "object"
      ? global.GGDiagCollectors
      : {};
    const merged = Object.assign({}, existing, { [name]: moduleApi });
    global.GGDiagCollectors = merged;
    return merged[name];
  }

  function loadDiagnosticsCollector(name){
    const config = COLLECTOR_CONFIG[name];
    if (!config) return null;
    const path = config.path;
    let required = null;
    if (typeof module === "object" && module && typeof module.require === "function") {
      try { required = module.require(path); } catch (_) {}
    }
    if (!required && typeof require === "function") {
      try { required = require(path); } catch (_) {}
    }
    if (!required) {
      requestDiagnosticsCollectorScript(name);
    }
    return required;
  }

  function requestDiagnosticsCollectorScript(name){
    if (typeof document === "undefined") return;
    const config = COLLECTOR_CONFIG[name];
    if (!config) return;
    try {
      const selector = `script[data-gg-diag-collector="${name}"]`;
      if (document.querySelector(selector)) return;
      const script = document.createElement("script");
      script.type = "module";
      script.src = `/games/common/diagnostics/${name}.js`;
      script.setAttribute("data-gg-diag-collector", name);
      script.setAttribute("data-origin", "diag-core");
      const parent = document.head || document.documentElement || document.body;
      parent?.appendChild(script);
    } catch (_) {}
  }

  function registerDiagnosticsCollector(name){
    const collector = ensureDiagnosticsCollector(name);
    if (!collector || typeof collector.install !== "function") {
      scheduleCollectorRetry(name);
      return;
    }
    let teardown = null;
    try {
      const result = collector.install({ scope: global, emit: emitCollectorEvent });
      if (result && typeof result.teardown === "function") {
        teardown = result.teardown;
      } else if (typeof collector.teardown === "function") {
        teardown = collector.teardown.bind(collector);
      }
    } catch (err) {
      if (typeof console !== "undefined" && console && typeof console.warn === "function") {
        console.warn(`[gg-diag] ${name} collector install failed`, err);
      }
      scheduleCollectorRetry(name);
      return;
    }
    if (typeof teardown === "function") {
      state.collectorTeardowns.push(() => {
        try { teardown(); }
        catch (error) {
          if (typeof console !== "undefined" && console && typeof console.warn === "function") {
            console.warn(`[gg-diag] ${name} collector teardown failed`, error);
          }
        }
      });
    }
  }

  function scheduleCollectorRetry(name){
    if (!name || !COLLECTOR_CONFIG[name]) return;
    if (state.collectorRetryTimers[name]) return;
    const scheduler = typeof global.setTimeout === "function"
      ? global.setTimeout
      : (typeof setTimeout === "function" ? setTimeout : null);
    if (!scheduler) return;
    state.collectorRetryTimers[name] = scheduler(() => {
      state.collectorRetryTimers[name] = null;
      registerDiagnosticsCollector(name);
    }, COLLECTOR_RETRY_DELAY_MS);
  }

  function setupCollectorCleanupListeners(){
    if (state.collectorCleanupHandler || typeof global.addEventListener !== "function") return;
    const handler = () => cleanupCollectors();
    try {
      global.addEventListener("beforeunload", handler);
      global.addEventListener("pagehide", handler);
      state.collectorCleanupHandler = handler;
    } catch (_) {}
  }

  function cleanupCollectors(){
    if (state.collectorCleanupHandler && typeof global.removeEventListener === "function") {
      try { global.removeEventListener("beforeunload", state.collectorCleanupHandler); } catch (_) {}
      try { global.removeEventListener("pagehide", state.collectorCleanupHandler); } catch (_) {}
      state.collectorCleanupHandler = null;
    }
    const teardowns = state.collectorTeardowns.splice(0);
    for (const teardown of teardowns){
      try { teardown(); }
      catch (err) {
        if (typeof console !== "undefined" && console && typeof console.warn === "function") {
          console.warn("[gg-diag] collector teardown failed", err);
        }
      }
    }
    const clearTimer = typeof global.clearTimeout === "function"
      ? global.clearTimeout
      : (typeof clearTimeout === "function" ? clearTimeout : null);
    if (state.collectorRetryTimers) {
      for (const key of Object.keys(state.collectorRetryTimers)){
        const timer = state.collectorRetryTimers[key];
        if (timer && clearTimer) {
          try { clearTimer(timer); } catch (_) {}
        }
        state.collectorRetryTimers[key] = null;
      }
    }
  }

  function emitCollectorEvent(entry){
    if (!entry) return;
    try {
      log(entry);
    } catch (err) {
      safeEnqueue(entry);
      if (typeof console !== "undefined" && console && typeof console.warn === "function") {
        console.warn("[gg-diag] collector emit failed", err);
      }
    }
  }

  function safeEnqueue(entry){
    try {
      const queue = global.__GG_DIAG_QUEUE || (global.__GG_DIAG_QUEUE = []);
      queue.push(entry);
    } catch (_) {}
  }

  const reportStoreModule = ensureReportStoreModule();
  const reportStore = reportStoreModule.createReportStore({
    maxEntries: 500,
    maxConsole: 500,
    maxNetwork: 200,
    maxProbes: 200,
    maxEnvHistory: 12,
  });

  const TABS = [
    { id: "summary", label: "Summary" },
    { id: "errors", label: "Errors" },
    { id: "console", label: "Console" },
    { id: "assets", label: "Assets" },
    { id: "probes", label: "Probes" },
    { id: "network", label: "Network" },
    { id: "perf", label: "Performance" },
    { id: "env", label: "Env" },
  ];

  const state = {
    store: reportStore,
    maxLogs: reportStore?.config?.maxConsole || 500,
    injected: false,
    root: null,
    fab: null,
    backdrop: null,
    modal: null,
    tablist: null,
    panels: {},
    tabButtons: {},
    logList: null,
    metaCounts: {},
    summaryRefs: {},
    probesList: null,
    networkTable: null,
    networkSort: { key: "timestamp", dir: "desc" },
    lastNetworkEntries: [],
    errorsList: null,
    assetsList: null,
    envContainer: null,
    perfPanel: null,
    perfRefs: null,
    lastPerfSnapshot: null,
    autoScroll: true,
    isOpen: false,
    activeTab: "summary",
    lastFocus: null,
    styleInjected: false,
    cssHref: null,
    adapterModule: null,
    gameSlug: null,
    gameAdapter: null,
    adapterUnsubscribe: null,
    adapterReadyFired: false,
    lastSummarySnapshot: null,
    lastErrorSignature: null,
    lastScoreSerialized: null,
    lastScoreCheck: 0,
    probesModule: null,
    probeRunner: null,
    probeRunPromise: null,
    probeAutoTriggered: false,
    externalButton: null,
    buttonObserver: null,
    shortcutHandler: null,
    busBound: false,
    busPollTimer: null,
    busSeenEvents: typeof Set === "function" ? new Set() : null,
    collectorTeardowns: [],
    collectorRetryTimers: {},
    collectorCleanupHandler: null,
  };

  state.adapterModule = ensureDiagnosticsAdapterModule();
  state.gameSlug = detectGameSlug();
  state.probesModule = ensureDiagnosticsProbesModule();
  setupAdapterIntegration(state.adapterModule);
  whenDiagnosticsAdapterReady(setupAdapterIntegration);

  if (diagV2Enabled) {
    setupExternalDiagnosticsButton();
    setupAltShortcut();
    setupDiagnosticsBusIntegration();
    setupCollectorCleanupListeners();
    registerDiagnosticsCollector("network");
    registerDiagnosticsCollector("perf");
  }

  const LEVEL_ORDER = ["debug", "info", "warn", "error"];
  const LEGACY_SELECTORS = [
    "[data-gg-diag-root]",
    "#gg-diag-overlay",
    "#gg-diag-floating",
    "[data-diag-legacy]",
  ];

  const diag = {
    open,
    close,
    toggle,
    log,
    exportJSON,
    exportText,
    copyToClipboard,
    download,
    openInNewTab,
  };

  Object.defineProperty(global, "__GG_DIAG", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: diag,
  });

  if (existingQueue.length){
    for (const entry of existingQueue){
      try { log(entry); } catch(_){}
    }
  }

  function open(){
    ensureUI();
    if (state.isOpen) return;
    state.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.backdrop?.setAttribute("data-open", "true");
    state.fab?.setAttribute("aria-expanded", "true");
    syncExternalButtonState();
    state.isOpen = true;
    document.body.classList.add("gg-diag-scroll-locked");
    requestAnimationFrame(() => {
      const first = firstFocusable();
      (first || state.modal)?.focus({ preventScroll: true });
    });
    document.addEventListener("keydown", trapKeydown, true);
  }

  function close(){
    if (!state.isOpen) return;
    state.isOpen = false;
    state.backdrop?.setAttribute("data-open", "false");
    state.fab?.setAttribute("aria-expanded", "false");
    syncExternalButtonState();
    document.body.classList.remove("gg-diag-scroll-locked");
    document.removeEventListener("keydown", trapKeydown, true);
    if (state.lastFocus && document.contains(state.lastFocus)) {
      try { state.lastFocus.focus({ preventScroll: true }); } catch(_){}
    } else {
      state.fab?.focus({ preventScroll: true });
    }
  }

  function toggle(){
    if (state.isOpen) close(); else open();
  }

  function log(entry){
    if (!entry) return;
    ensureUI();
    const normalized = normalizeEntry(entry);
    const snapshot = state.store.add(normalized);
    const category = typeof normalized.category === "string" ? normalized.category.toLowerCase() : "";
    if (category === "perf") {
      handlePerfEntry(normalized);
    }
    appendConsoleEntry(normalized);
    updateMetaCounts(snapshot.summary);
    renderSummaryPanel(snapshot.summary);
    renderErrorsPanel(snapshot);
    renderProbesPanel(snapshot.probes || []);
    renderNetworkPanel(snapshot.network || []);
    renderAssetsPanel(snapshot.assets || []);
    renderEnvironmentPanel(snapshot.environment || null);
    if (category !== "perf") {
      renderPerfPanel();
    }
  }

  function exportJSON(){
    const data = typeof state.store.toJSON === "function" ? state.store.toJSON() : state.store.snapshot?.();
    return JSON.stringify(data || [], null, 2);
  }

  function exportText(){
    if (typeof state.store.toText === "function") {
      return state.store.toText();
    }
    const snapshot = state.store.snapshot?.();
    if (!snapshot || !Array.isArray(snapshot.console)) return "";
    return snapshot.console.map((item) => {
      return `[${new Date(item.timestamp).toISOString()}] ${item.category}/${item.level} ${item.message}`;
    }).join("\n");
  }

  async function copyToClipboard(format = "text"){
    try {
      const text = format === "json" ? exportJSON() : exportText();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      const formatLabel = format === "json" ? "JSON" : "report";
      announce(`Copied diagnostics ${formatLabel} to clipboard`);
    } catch (err) {
      const formatLabel = format === "json" ? "JSON" : "report";
      announce(`Unable to copy diagnostics ${formatLabel}`);
      console.warn("__GG_DIAG copy failed", err);
    }
  }

  function download(){
    try {
      const blob = new Blob([exportJSON()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gg-diag-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      announce("Diagnostics exported");
    } catch (err) {
      announce("Unable to export diagnostics");
      console.warn("__GG_DIAG export failed", err);
    }
  }

  function openInNewTab(){
    let url = "";
    try {
      const blob = new Blob([exportJSON()], { type: "application/json" });
      url = URL.createObjectURL(blob);
      const opener = typeof window !== "undefined" && typeof window.open === "function"
        ? window.open(url, "_blank", "noopener")
        : global?.open?.(url, "_blank", "noopener");
      if (opener) {
        announce("Diagnostics opened in new tab");
      } else {
        announce("Unable to open diagnostics in new tab");
        console.warn("__GG_DIAG open in new tab blocked or failed");
      }
    } catch (err) {
      announce("Unable to open diagnostics in new tab");
      console.warn("__GG_DIAG open in new tab failed", err);
    } finally {
      if (url) {
        setTimeout(() => {
          try { URL.revokeObjectURL(url); } catch (_) {}
        }, 0);
      }
    }
  }

  function setupAdapterIntegration(adapterModule){
    const resolved = normalizeDiagnosticsAdapterModule(adapterModule);
    if (!resolved) return;
    state.adapterModule = resolved;
    if (typeof state.adapterUnsubscribe === "function") {
      try { state.adapterUnsubscribe(); } catch (_) {}
      state.adapterUnsubscribe = null;
    }
    if (state.gameSlug && typeof resolved.getGameDiagnostics === "function") {
      assignGameAdapter(resolved.getGameDiagnostics(state.gameSlug));
    }
    if (typeof resolved.subscribe === "function") {
      state.adapterUnsubscribe = resolved.subscribe((slug, record) => {
        if (!slug || slug !== state.gameSlug) return;
        assignGameAdapter(record);
      });
    }
  }

  function assignGameAdapter(record){
    resetProbeRunner();
    if (record && typeof record === "object") {
      state.gameAdapter = {
        slug: typeof record.slug === "string" ? record.slug : state.gameSlug,
        hooks: record.hooks && typeof record.hooks === "object" ? record.hooks : {},
        api: record.api && typeof record.api === "object" ? record.api : {},
      };
    } else {
      state.gameAdapter = null;
    }
    state.adapterReadyFired = false;
    if (state.summaryRefs?.root) {
      maybeInvokeAdapterReady(state.summaryRefs.root);
      if (state.lastSummarySnapshot) {
        notifyAdapterSummaryUpdate(state.lastSummarySnapshot, null);
      }
    }
    if (state.activeTab === "probes") {
      triggerAutoProbeRun("adapter-change");
    }
  }

  function detectGameSlug(){
    try {
      const doc = typeof document !== "undefined" ? document : null;
      if (!doc) return "";
      const bodySlug = doc.body?.dataset?.gameSlug;
      if (typeof bodySlug === "string" && bodySlug.trim()) {
        return bodySlug.trim();
      }
      const shell = doc.querySelector?.('[data-shell-diag][data-slug]');
      if (shell && typeof shell.dataset?.slug === "string" && shell.dataset.slug.trim()) {
        return shell.dataset.slug.trim();
      }
      return "";
    } catch (_) {
      return "";
    }
  }

  function ensureDiagnosticsAdapterModule(){
    const resolved = resolveDiagnosticsAdapterModule();
    if (resolved) return resolved;
    const required = loadDiagnosticsAdapterModule();
    const normalized = normalizeDiagnosticsAdapterModule(required);
    if (normalized) {
      const attached = attachDiagnosticsAdapterModule(normalized);
      notifyDiagnosticsAdapterReady(attached);
      return attached;
    }
    requestDiagnosticsAdapterScript();
    return resolveDiagnosticsAdapterModule();
  }

  function resolveDiagnosticsAdapterModule(){
    return normalizeDiagnosticsAdapterModule(global.GGDiagAdapters);
  }

  function normalizeDiagnosticsAdapterModule(candidate){
    if (!candidate) return null;
    if (typeof candidate === "object") {
      if (typeof candidate.registerGameDiagnostics === "function" && typeof candidate.getGameDiagnostics === "function") {
        return candidate;
      }
      if (candidate.default && candidate.default !== candidate) {
        return normalizeDiagnosticsAdapterModule(candidate.default);
      }
    }
    return null;
  }

  function attachDiagnosticsAdapterModule(moduleApi){
    if (!moduleApi) return null;
    const existing = normalizeDiagnosticsAdapterModule(global.GGDiagAdapters);
    if (existing === moduleApi) return moduleApi;
    const merged = Object.assign({}, existing || {}, moduleApi);
    global.GGDiagAdapters = merged;
    return merged;
  }

  function loadDiagnosticsAdapterModule(){
    let required = null;
    if (typeof module === "object" && module && typeof module.require === "function") {
      try { required = module.require("./diagnostics/adapter.js"); } catch (_) {}
    }
    if (!required && typeof require === "function") {
      try { required = require("./diagnostics/adapter.js"); } catch (_) {}
    }
    if (!required) {
      requestDiagnosticsAdapterScript();
    }
    return required;
  }

  function requestDiagnosticsAdapterScript(){
    if (typeof document === "undefined") return;
    try {
      const doc = document;
      if (!doc) return;
      if (doc.querySelector('script[data-gg-diag-adapter]')) return;
      const script = doc.createElement("script");
      script.type = "module";
      script.src = "/games/common/diagnostics/adapter.js";
      script.setAttribute("data-gg-diag-adapter", "true");
      script.setAttribute("data-origin", "diag-core");
      const parent = doc.head || doc.documentElement || doc.body;
      parent?.appendChild(script);
    } catch (_) {}
  }

  function whenDiagnosticsAdapterReady(callback){
    if (typeof callback !== "function") return;
    const resolved = resolveDiagnosticsAdapterModule();
    if (resolved) {
      callback(resolved);
      return;
    }
    adapterReadyWaiters.push(callback);
    requestDiagnosticsAdapterScript();
    scheduleDiagnosticsAdapterPoll();
  }

  function scheduleDiagnosticsAdapterPoll(){
    if (!adapterReadyWaiters.length) return;
    if (adapterReadyTimer) return;
    const scheduler = typeof global.setTimeout === "function" ? global.setTimeout : (typeof setTimeout === "function" ? setTimeout : null);
    if (!scheduler) return;
    if (!adapterReadyDeadline) adapterReadyDeadline = Date.now() + ADAPTER_READY_TIMEOUT_MS;
    adapterReadyTimer = scheduler(() => {
      adapterReadyTimer = null;
      const moduleApi = resolveDiagnosticsAdapterModule();
      if (moduleApi) {
        notifyDiagnosticsAdapterReady(moduleApi);
        return;
      }
      if (adapterReadyDeadline && Date.now() >= adapterReadyDeadline) {
        adapterReadyWaiters.length = 0;
        adapterReadyDeadline = 0;
        return;
      }
      scheduleDiagnosticsAdapterPoll();
    }, ADAPTER_READY_POLL_INTERVAL_MS);
  }

  function notifyDiagnosticsAdapterReady(moduleApi){
    const resolved = normalizeDiagnosticsAdapterModule(moduleApi);
    if (!resolved) return;
    attachDiagnosticsAdapterModule(resolved);
    if (!adapterReadyWaiters.length) return;
    const waiters = adapterReadyWaiters.splice(0);
    adapterReadyDeadline = 0;
    for (const waiter of waiters){
      try { waiter(resolved); } catch (err) { console.warn("[gg-diag] adapter waiter failed", err); }
    }
  }

  function ensureDiagnosticsProbesModule(){
    if (global.GGDiagProbes && typeof global.GGDiagProbes.createProbeRunner === "function") {
      return global.GGDiagProbes;
    }
    if (typeof module === "object" && module && typeof module.require === "function") {
      try {
        const required = module.require("./diagnostics/probes.js");
        if (required && typeof required.createProbeRunner === "function") {
          global.GGDiagProbes = required;
          return required;
        }
      } catch (_) {}
    }
    if (typeof require === "function") {
      try {
        const required = require("./diagnostics/probes.js");
        if (required && typeof required.createProbeRunner === "function") {
          global.GGDiagProbes = required;
          return required;
        }
      } catch (_) {}
    }
    const fallback = createFallbackProbesModule();
    global.GGDiagProbes = fallback;
    return fallback;
  }

  function createFallbackProbesModule(){
    function createProbeRunner(options = {}){
      const logFn = typeof options.log === "function" ? options.log : () => {};
      let hasRun = false;
      return {
        run(reason){
          if (hasRun) return Promise.resolve([]);
          hasRun = true;
          const entry = {
            category: "probe",
            level: "info",
            message: "Probe module unavailable",
            details: {
              reason: "missing-module",
              requested: reason || "unknown",
            },
            timestamp: Date.now(),
          };
          try { logFn(entry); } catch (_) {}
          return Promise.resolve([entry]);
        },
        reset(){ hasRun = false; },
      };
    }
    return { createProbeRunner };
  }

  function setupExternalDiagnosticsButton(){
    if (typeof document === "undefined") return;
    const doc = document;

    const attach = () => {
      if (state.externalButton && doc.contains(state.externalButton)) {
        syncExternalButtonState();
        return true;
      }
      const button = doc.getElementById?.("diagnostics-btn");
      if (!button || !doc.contains(button)) {
        state.externalButton = null;
        return false;
      }
      state.externalButton = button;
      try {
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-expanded", state.isOpen ? "true" : "false");
        button.dataset.ggDiagCoreManaged = "true";
      } catch (_) {}
      syncExternalButtonState();
      return true;
    };

    const ensureObserver = () => {
      if (state.buttonObserver || typeof MutationObserver !== "function") return;
      try {
        const observer = new MutationObserver(() => {
          if (attach()) {
            observer.disconnect();
            state.buttonObserver = null;
          }
        });
        observer.observe(doc.documentElement || doc.body || doc, { childList: true, subtree: true });
        state.buttonObserver = observer;
      } catch (_) {}
    };

    const init = () => {
      if (!attach()) {
        ensureObserver();
      } else if (state.buttonObserver) {
        try { state.buttonObserver.disconnect(); } catch (_) {}
        state.buttonObserver = null;
      }
    };

    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }
  }

  function syncExternalButtonState(){
    if (typeof document === "undefined") return;
    const button = state.externalButton;
    if (!button) return;
    if (!document.contains(button)) {
      state.externalButton = null;
      setupExternalDiagnosticsButton();
      return;
    }
    try {
      button.setAttribute("aria-expanded", state.isOpen ? "true" : "false");
    } catch (_) {}
  }

  function setupAltShortcut(){
    if (state.shortcutHandler || typeof document === "undefined") return;
    const handler = (event) => {
      if (!event) return;
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key || event.code || "";
      if (typeof key !== "string") return;
      const normalized = key.toLowerCase();
      if (normalized === "d" || normalized === "keyd") {
        event.preventDefault();
        open();
      }
    };
    document.addEventListener("keydown", handler, true);
    state.shortcutHandler = handler;
  }

  function setupDiagnosticsBusIntegration(){
    if (state.busBound) return;
    if (bindDiagnosticsBus(global.DiagnosticsBus)) {
      return;
    }
    const scheduler = typeof global.setTimeout === "function"
      ? global.setTimeout
      : (typeof setTimeout === "function" ? setTimeout : null);
    if (!scheduler) return;
    const poll = () => {
      state.busPollTimer = null;
      if (state.busBound) return;
      if (!bindDiagnosticsBus(global.DiagnosticsBus)) {
        state.busPollTimer = scheduler(poll, 500);
      }
    };
    state.busPollTimer = scheduler(poll, 500);
  }

  function bindDiagnosticsBus(bus){
    if (!bus || typeof bus.emit !== "function") return false;
    if (!bus.__ggDiagPatched) {
      const originalEmit = bus.emit.bind(bus);
      bus.emit = function patchedEmit(event){
        const result = originalEmit(event);
        try {
          ingestBusEvent(event);
        } catch (err) {
          if (typeof console !== "undefined" && console && typeof console.warn === "function") {
            console.warn("[gg-diag] bus ingest failed", err);
          }
        }
        return result;
      };
      bus.__ggDiagPatched = true;
    }
    state.busBound = true;
    try {
      if (typeof bus.getAll === "function") {
        const existing = bus.getAll();
        if (Array.isArray(existing)) {
          for (const event of existing){
            ingestBusEvent(event);
          }
        }
      }
    } catch (err) {
      if (typeof console !== "undefined" && console && typeof console.warn === "function") {
        console.warn("[gg-diag] bus history fetch failed", err);
      }
    }
    return true;
  }

  function ingestBusEvent(event){
    const normalized = normalizeBusEvent(event);
    if (!normalized) return;
    log(normalized);
  }

  function normalizeBusEvent(event){
    if (!event || typeof event !== "object") return null;
    const key = busEventKey(event);
    if (state.busSeenEvents && key) {
      if (state.busSeenEvents.has(key)) return null;
      state.busSeenEvents.add(key);
    }
    const category = typeof event.topic === "string" && event.topic
      ? event.topic
      : (typeof event.category === "string" && event.category ? event.category : "bus");
    const level = typeof event.level === "string" && event.level
      ? normalizeLevel(event.level)
      : deriveBusLevelFromEvent(event, category);
    const message = deriveBusMessage(event, category);
    const timestamp = typeof event.ts === "number" && Number.isFinite(event.ts)
      ? event.ts
      : Date.now();
    const details = normalizeBusDetails(event);
    return { category, level, message, details, timestamp };
  }

  function busEventKey(event){
    try {
      const ts = typeof event.ts === "number" ? event.ts : 0;
      const topic = event.topic || event.category || "";
      const source = event.source || "";
      const message = event.message || "";
      const detailUrl = event.details?.url || event.data?.url || "";
      return `${ts}|${topic}|${source}|${message}|${detailUrl}`;
    } catch (_) {
      return "";
    }
  }

  function deriveBusLevelFromEvent(event, category){
    if (category === "error" || category === "promise") return "error";
    if (event && typeof event.level === "string") {
      return normalizeLevel(event.level);
    }
    if (event && typeof event.status === "number" && event.status >= 400) return "error";
    const details = event && typeof event.details === "object" ? event.details : null;
    if (details && typeof details.status === "number" && details.status >= 400) return "error";
    if (details && typeof details.duration === "number" && details.duration >= 2000) return "warn";
    if (event && event.stack) return "error";
    if (event && (event.warn || event.warning)) return "warn";
    return "info";
  }

  function deriveBusMessage(event, category){
    if (!event) return category || "event";
    if (event.message) return String(event.message);
    if (event.source) return String(event.source);
    const details = event.details || event.data;
    if (details && typeof details === "object") {
      if (details.message) return String(details.message);
      if (details.url) return String(details.url);
    }
    if (Array.isArray(event.args) && event.args.length) {
      try {
        return event.args.map((arg) => {
          if (arg === null || arg === undefined) return String(arg);
          if (typeof arg === "string") return arg;
          return JSON.stringify(arg);
        }).join(" ");
      } catch (_) {}
    }
    return category || "event";
  }

  function normalizeBusDetails(event){
    const details = event && typeof event.details === "object" ? event.details : null;
    if (details) {
      return safeCloneDetails(details);
    }
    const data = event && typeof event.data === "object" ? event.data : null;
    if (data) {
      return safeCloneDetails(data);
    }
    const output = {};
    if (event?.source) output.source = event.source;
    if (event?.stack) output.stack = event.stack;
    if (event?.args) output.args = safeCloneDetails(event.args);
    if (event?.error) output.error = safeCloneError(event.error);
    if (event?.url) output.url = event.url;
    if (typeof event?.status === "number") output.status = event.status;
    if (typeof event?.duration === "number") output.duration = event.duration;
    return Object.keys(output).length ? output : null;
  }

  function ensureUI(){
    if (state.injected) return;
    state.injected = true;
    ensureStyle();
    removeLegacy();

    const doc = document;
    const root = doc.createElement("div");
    root.dataset.ggDiagRoot = "modern";
    root.className = "diag-overlay";

    const suppressButton = !!global.__GG_DIAG_OPTS?.suppressButton;

    let fab = null;
    if (!suppressButton) {
      fab = doc.createElement("button");
      fab.type = "button";
      fab.className = "gg-diag-fab";
      fab.setAttribute("aria-label", "Open diagnostics console");
      fab.setAttribute("aria-haspopup", "dialog");
      fab.setAttribute("aria-expanded", "false");
      fab.innerHTML = "&#9881;";
      fab.addEventListener("click", () => open());
    }

    const backdrop = doc.createElement("div");
    backdrop.className = "gg-diag-backdrop";
    backdrop.setAttribute("role", "presentation");
    backdrop.setAttribute("data-open", "false");
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) {
        close();
      }
    });

    const modal = doc.createElement("div");
    modal.className = "gg-diag-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("tabindex", "-1");
    modal.setAttribute("aria-labelledby", "gg-diag-modal-title");

    const header = doc.createElement("header");
    header.className = "gg-diag-modal-header";

    const title = doc.createElement("h2");
    title.className = "gg-diag-modal-title";
    title.id = "gg-diag-modal-title";
    title.textContent = "Diagnostics";

    const meta = doc.createElement("div");
    meta.className = "gg-diag-modal-meta";
    meta.innerHTML = `
      <span>Total: <strong data-gg-diag-meta="total">0</strong></span>
      <span>Warnings: <strong data-gg-diag-meta="warn">0</strong></span>
      <span>Errors: <strong data-gg-diag-meta="error">0</strong></span>
    `;
    state.metaCounts = {
      total: meta.querySelector('[data-gg-diag-meta="total"]'),
      warn: meta.querySelector('[data-gg-diag-meta="warn"]'),
      error: meta.querySelector('[data-gg-diag-meta="error"]'),
    };

    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gg-diag-close";
    closeBtn.textContent = "Close";
    closeBtn.setAttribute("aria-label", "Close diagnostics console");
    closeBtn.addEventListener("click", () => close());

    header.append(title, meta, closeBtn);

    const body = doc.createElement("div");
    body.className = "gg-diag-modal-body";

    const tablist = doc.createElement("div");
    tablist.className = "gg-diag-tabs";
    tablist.setAttribute("role", "tablist");
    state.tablist = tablist;

    const panels = doc.createElement("div");
    panels.className = "gg-diag-panels";

    for (const tab of TABS){
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "gg-diag-tab";
      button.id = `gg-diag-tab-${tab.id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", tab.id === state.activeTab ? "true" : "false");
      button.setAttribute("tabindex", tab.id === state.activeTab ? "0" : "-1");
      button.dataset.tab = tab.id;
      button.textContent = tab.label;
      button.addEventListener("click", () => activateTab(tab.id));
      button.addEventListener("keydown", (event) => handleTabKeydown(event, tab.id));
      state.tabButtons[tab.id] = button;
      tablist.appendChild(button);

      const panel = createTabPanel(doc, tab.id);
      panels.appendChild(panel);
      state.panels[tab.id] = panel;

      if (tab.id === "summary") {
        buildSummaryPanel(doc, panel);
      } else if (tab.id === "errors") {
        buildErrorsPanel(doc, panel);
      } else if (tab.id === "console") {
        buildConsolePanel(doc, panel);
      } else if (tab.id === "assets") {
        buildAssetsPanel(doc, panel);
      } else if (tab.id === "probes") {
        buildProbesPanel(doc, panel);
      } else if (tab.id === "network") {
        buildNetworkPanel(doc, panel);
      } else if (tab.id === "perf") {
        buildPerfPanel(doc, panel);
      } else if (tab.id === "env") {
        buildEnvPanel(doc, panel);
      }
    }

    body.append(tablist, panels);

    const actions = doc.createElement("div");
    actions.className = "gg-diag-modal-actions";

    const btnCopy = doc.createElement("button");
    btnCopy.type = "button";
    btnCopy.className = "gg-diag-action";
    btnCopy.textContent = "Copy report";
    btnCopy.addEventListener("click", () => copyToClipboard("text"));

    const btnCopyJSON = doc.createElement("button");
    btnCopyJSON.type = "button";
    btnCopyJSON.className = "gg-diag-action";
    btnCopyJSON.textContent = "Copy JSON";
    btnCopyJSON.addEventListener("click", () => copyToClipboard("json"));

    const btnDownload = doc.createElement("button");
    btnDownload.type = "button";
    btnDownload.className = "gg-diag-action";
    btnDownload.textContent = "Download JSON";
    btnDownload.addEventListener("click", () => download());

    const btnOpenNewTab = doc.createElement("button");
    btnOpenNewTab.type = "button";
    btnOpenNewTab.className = "gg-diag-action";
    btnOpenNewTab.textContent = "Open in new tab";
    btnOpenNewTab.addEventListener("click", () => openInNewTab());

    actions.append(btnCopy, btnCopyJSON, btnOpenNewTab, btnDownload);

    modal.append(header, body, actions);
    backdrop.append(modal);
    root.append(backdrop);
    if (fab) {
      doc.body.append(root, fab);
    } else {
      doc.body.append(root);
    }

    state.root = root;
    state.fab = fab;
    state.backdrop = backdrop;
    state.modal = modal;

    state.logList?.addEventListener("scroll", handleScroll);

    const snapshot = typeof state.store.snapshot === "function" ? state.store.snapshot() : null;
    if (snapshot) {
      rebuildConsole(snapshot.console || []);
      updateMetaCounts(snapshot.summary);
      renderSummaryPanel(snapshot.summary);
      renderErrorsPanel(snapshot);
      renderProbesPanel(snapshot.probes || []);
      renderNetworkPanel(snapshot.network || []);
      renderAssetsPanel(snapshot.assets || []);
      renderEnvironmentPanel(snapshot.environment || null);
      renderPerfPanel();
    }
    if (state.activeTab === "probes") {
      triggerAutoProbeRun("ui-ready");
    }
  }

  function ensureStyle(){
    if (state.styleInjected) return;
    state.styleInjected = true;
    try {
      const scriptEl = document.currentScript || Array.from(document.scripts || []).find((s) => /diag-core\.js/.test(s.src));
      if (scriptEl?.src) {
        state.cssHref = new URL("./diag-modal.css", scriptEl.src).href;
      } else {
        state.cssHref = "/games/common/diag-modal.css";
      }
    } catch (_) {
      state.cssHref = "/games/common/diag-modal.css";
    }
    if (!state.cssHref) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = state.cssHref;
    link.setAttribute("data-gg-diag-style", "modern");
    document.head.appendChild(link);
  }

  function removeLegacy(){
    for (const selector of LEGACY_SELECTORS){
      document.querySelectorAll(selector).forEach((node) => {
        if (!node || node.dataset.ggDiagRoot === "modern") return;
        node.remove();
      });
    }
  }

  function normalizeEntry(entry){
    const now = Date.now();
    if (typeof entry === "string" || typeof entry === "number") {
      return { timestamp: now, level: "info", category: "general", message: String(entry), details: null };
    }
    const objectEntry = typeof entry === "object" && entry ? entry : { message: String(entry) };
    const level = normalizeLevel(objectEntry.level);
    const category = String(objectEntry.category || objectEntry.type || "general");
    const message = normalizeMessage(objectEntry.message, objectEntry.args);
    const details = objectEntry.details ?? objectEntry.data ?? null;
    return {
      timestamp: typeof objectEntry.timestamp === "number" ? objectEntry.timestamp : now,
      level,
      category,
      message,
      details,
    };
  }

  function normalizeLevel(value){
    const lvl = String(value || "info").toLowerCase();
    return LEVEL_ORDER.includes(lvl) ? lvl : "info";
  }

  function normalizeMessage(message, args){
    if (typeof message === "string") return message;
    if (Array.isArray(args)) {
      return args.map((item) => stringify(item)).join(" ");
    }
    return stringify(message);
  }

  function stringify(value){
    if (value === null || value === undefined) return String(value);
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
    try {
      return JSON.stringify(value);
    } catch (_) {
      return Object.prototype.toString.call(value);
    }
  }

  function shouldDisplayInConsole(entry){
    if (!entry) return false;
    const category = typeof entry.category === "string" ? entry.category.toLowerCase() : "";
    if (category === "perf") return false;
    return true;
  }

  function appendConsoleEntry(entry){
    if (!state.logList) return;
    if (!shouldDisplayInConsole(entry)) return;
    const item = createEntryListItem(entry);
    const shouldStick = state.autoScroll && isScrolledToBottom();
    state.logList.appendChild(item);
    const excess = state.logList.children.length - state.maxLogs;
    if (excess > 0) {
      for (let i = 0; i < excess; i += 1) {
        const first = state.logList.firstChild;
        if (!first) break;
        state.logList.removeChild(first);
      }
    }
    if (shouldStick) {
      requestAnimationFrame(() => {
        state.logList.scrollTop = state.logList.scrollHeight;
      });
    }
  }

  function rebuildConsole(entries){
    if (!state.logList) return;
    state.logList.innerHTML = "";
    if (!Array.isArray(entries) || !entries.length) return;
    const filtered = entries.filter((entry) => shouldDisplayInConsole(entry));
    if (!filtered.length) return;
    const start = Math.max(0, filtered.length - state.maxLogs);
    for (let i = start; i < filtered.length; i += 1) {
      const entry = filtered[i];
      state.logList.appendChild(createEntryListItem(entry));
    }
    state.logList.scrollTop = state.logList.scrollHeight;
  }

  function renderErrorsPanel(snapshot){
    if (!state.errorsList) return;
    state.errorsList.innerHTML = "";
    const entries = collectErrorEntries(snapshot);
    if (!entries.length) {
      state.errorsList.appendChild(createEmptyListItem("No errors captured."));
      return;
    }
    for (const entry of entries){
      state.errorsList.appendChild(createEntryListItem(entry, {
        showBadge: true,
        label: (item) => item?.details?.url || `${item?.category || "error"} / ${item?.level || "error"}`,
      }));
    }
  }

  function collectErrorEntries(snapshot){
    if (!snapshot || typeof snapshot !== "object") return [];
    const pools = [];
    if (Array.isArray(snapshot.console)) pools.push(snapshot.console);
    if (Array.isArray(snapshot.network)) pools.push(snapshot.network);
    if (Array.isArray(snapshot.probes)) pools.push(snapshot.probes);
    if (Array.isArray(snapshot.assets)) pools.push(snapshot.assets);
    const entries = [];
    for (const pool of pools){
      for (const entry of pool){
        if (isErrorEntry(entry)) entries.push(entry);
      }
    }
    entries.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
    const limit = 200;
    return entries.slice(0, limit);
  }

  function isErrorEntry(entry){
    if (!entry) return false;
    const level = typeof entry.level === "string" ? entry.level.toLowerCase() : "";
    if (level === "error") return true;
    const category = typeof entry.category === "string" ? entry.category.toLowerCase() : "";
    return category === "error" || category === "promise" || category === "resource";
  }

  function renderProbesPanel(probes){
    if (!state.probesList) return;
    state.probesList.innerHTML = "";
    if (!Array.isArray(probes) || !probes.length) {
      state.probesList.appendChild(createEmptyListItem("No probe activity captured yet."));
      return;
    }
    for (const entry of probes){
      state.probesList.appendChild(createEntryListItem(entry, { showBadge: true }));
    }
  }

  function renderNetworkPanel(networkEntries){
    if (Array.isArray(networkEntries)) {
      state.lastNetworkEntries = networkEntries.slice();
    }
    const tableState = state.networkTable;
    if (!tableState || !tableState.tbody) return;
    const entries = Array.isArray(state.lastNetworkEntries) ? state.lastNetworkEntries : [];
    const tbody = tableState.tbody;
    tbody.innerHTML = "";
    if (!entries.length) {
      if (tableState.empty) tableState.empty.hidden = false;
      updateNetworkSortIndicators();
      return;
    }
    const rows = [];
    for (const entry of entries){
      const normalized = normalizeNetworkEntry(entry);
      if (normalized) rows.push(normalized);
    }
    if (!rows.length) {
      if (tableState.empty) tableState.empty.hidden = false;
      updateNetworkSortIndicators();
      return;
    }
    const sortedRows = sortNetworkRows(rows, state.networkSort);
    const maxDuration = sortedRows.reduce((max, row) => {
      const value = Number.isFinite(row.duration) ? row.duration : 0;
      return value > max ? value : max;
    }, 0);
    const doc = tbody.ownerDocument || document;
    const fragment = doc.createDocumentFragment();
    for (const row of sortedRows){
      fragment.appendChild(createNetworkRowElement(doc, row, maxDuration));
    }
    tbody.appendChild(fragment);
    if (tableState.empty) tableState.empty.hidden = true;
    updateNetworkSortIndicators();
  }

  function normalizeNetworkEntry(entry){
    if (!entry || typeof entry !== "object") return null;
    const details = entry.details && typeof entry.details === "object" ? entry.details : {};
    const methodSource = typeof details.method === "string" && details.method ? details.method : entry.method;
    const method = typeof methodSource === "string" && methodSource
      ? methodSource.toUpperCase()
      : "GET";
    const url = typeof details.url === "string" && details.url
      ? details.url
      : (typeof entry.message === "string" ? entry.message : "");
    const status = toFiniteNumber(details.status ?? entry.status);
    const duration = toFiniteNumber(details.durationMs ?? details.duration);
    const bytes = toFiniteNumber(details.bytes ?? details.size);
    const timestamp = toFiniteNumber(entry.timestamp) ?? Date.now();
    const level = normalizeLevel(entry.level);
    const statusText = typeof details.statusText === "string" && details.statusText ? details.statusText : null;
    return { method, url, status, duration, bytes, timestamp, level, statusText };
  }

  function toFiniteNumber(value){
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function sortNetworkRows(rows, sort){
    const config = sort && typeof sort === "object" ? sort : { key: "timestamp", dir: "desc" };
    const key = config.key || "timestamp";
    const dir = config.dir === "asc" ? "asc" : "desc";
    const multiplier = dir === "asc" ? 1 : -1;
    const fallbackKey = key === "timestamp" ? "method" : "timestamp";
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      const primary = compareNetworkField(a, b, key, multiplier);
      if (primary !== 0) return primary;
      return compareNetworkField(a, b, fallbackKey, multiplier === 1 && fallbackKey === "timestamp" ? -1 : multiplier);
    });
    return sorted;
  }

  function compareNetworkField(a, b, key, multiplier){
    switch (key) {
      case "method":
        return compareStrings(a.method, b.method) * multiplier;
      case "url":
        return compareStrings(a.url, b.url) * multiplier;
      case "status":
        return compareNumbers(a.status, b.status, multiplier);
      case "duration":
        return compareNumbers(a.duration, b.duration, multiplier);
      case "bytes":
        return compareNumbers(a.bytes, b.bytes, multiplier);
      case "timestamp":
      default:
        return compareNumbers(a.timestamp, b.timestamp, multiplier);
    }
  }

  function compareNumbers(a, b, multiplier){
    const dir = multiplier === 1 ? 1 : -1;
    const valA = Number.isFinite(a) ? a : (dir === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    const valB = Number.isFinite(b) ? b : (dir === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    if (valA === valB) return 0;
    return valA > valB ? multiplier : -multiplier;
  }

  function compareStrings(a, b){
    const strA = typeof a === "string" ? a : (a === null || a === undefined ? "" : String(a));
    const strB = typeof b === "string" ? b : (b === null || b === undefined ? "" : String(b));
    return strA.localeCompare(strB);
  }

  function createNetworkRowElement(doc, row, maxDuration){
    const tr = doc.createElement("tr");
    if (row.level) tr.dataset.level = row.level;

    const methodCell = doc.createElement("td");
    methodCell.className = "gg-diag-network-cell gg-diag-network-cell--method";
    methodCell.textContent = row.method || "—";
    tr.appendChild(methodCell);

    const urlCell = doc.createElement("td");
    urlCell.className = "gg-diag-network-cell gg-diag-network-cell--url";
    urlCell.textContent = row.url || "—";
    if (row.url) urlCell.title = row.url;
    tr.appendChild(urlCell);

    const statusCell = doc.createElement("td");
    statusCell.className = "gg-diag-network-cell gg-diag-network-cell--status";
    statusCell.textContent = Number.isFinite(row.status) ? String(row.status) : "—";
    if (row.statusText) statusCell.title = row.statusText;
    tr.appendChild(statusCell);

    const durationCell = doc.createElement("td");
    durationCell.className = "gg-diag-network-cell gg-diag-network-cell--duration";
    const durationWrap = doc.createElement("div");
    durationWrap.className = "gg-diag-network-duration";
    const durationValue = doc.createElement("span");
    durationValue.className = "gg-diag-network-duration-value";
    durationValue.textContent = formatDurationValue(row.duration);
    const durationBar = doc.createElement("span");
    durationBar.className = "gg-diag-network-duration-bar";
    const durationFill = doc.createElement("span");
    durationFill.className = "gg-diag-network-duration-fill";
    const percent = computeDurationPercent(row.duration, maxDuration);
    durationFill.style.width = `${percent}%`;
    durationBar.appendChild(durationFill);
    durationWrap.append(durationValue, durationBar);
    durationCell.appendChild(durationWrap);
    tr.appendChild(durationCell);

    const bytesCell = doc.createElement("td");
    bytesCell.className = "gg-diag-network-cell gg-diag-network-cell--bytes";
    bytesCell.textContent = formatBytes(row.bytes);
    if (Number.isFinite(row.bytes)) {
      bytesCell.title = `${Math.round(row.bytes)} bytes`;
    }
    tr.appendChild(bytesCell);

    return tr;
  }

  function computeDurationPercent(value, max){
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(max) || max <= 0) {
      return 0;
    }
    const ratio = value / max;
    const percent = Math.max(4, Math.min(100, Math.round(ratio * 100)));
    return percent;
  }

  function formatDurationValue(value){
    if (!Number.isFinite(value) || value < 0) return "—";
    if (value < 100) {
      return value.toFixed(1).replace(/\.0$/, "");
    }
    return String(Math.round(value));
  }

  function formatBytes(bytes){
    if (bytes === 0) return "0 B";
    if (!Number.isFinite(bytes) || bytes < 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1){
      value /= 1024;
      index += 1;
    }
    const formatted = value >= 100 ? Math.round(value) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
    return `${formatted} ${units[index]}`;
  }

  function handleNetworkSort(key){
    if (!key) return;
    const defaultDir = key === "method" || key === "url" ? "asc" : "desc";
    const current = state.networkSort || { key: "timestamp", dir: "desc" };
    const dir = current.key === key ? (current.dir === "asc" ? "desc" : "asc") : defaultDir;
    state.networkSort = { key, dir };
    renderNetworkPanel();
  }

  function updateNetworkSortIndicators(){
    const tableState = state.networkTable;
    if (!tableState || !tableState.headers) return;
    const current = state.networkSort || { key: "timestamp", dir: "desc" };
    for (const [key, header] of Object.entries(tableState.headers)){
      if (!header || !header.button || !header.th) continue;
      if (current.key === key) {
        header.button.dataset.sort = current.dir;
        header.th.setAttribute("aria-sort", current.dir === "asc" ? "ascending" : "descending");
      } else {
        header.button.removeAttribute("data-sort");
        header.th.setAttribute("aria-sort", "none");
      }
    }
  }

  function handlePerfEntry(entry){
    if (!entry || typeof entry !== "object") return;
    const category = typeof entry.category === "string" ? entry.category.toLowerCase() : "";
    if (category !== "perf") return;
    const details = entry.details && typeof entry.details === "object" ? entry.details : {};
    const fpsDetails = details.fps && typeof details.fps === "object" ? details.fps : {};

    const samples = [];
    if (Array.isArray(details.samples)) {
      for (const sample of details.samples){
        const numeric = toFiniteNumber(sample);
        if (Number.isFinite(numeric)) {
          samples.push(Number(numeric.toFixed(1)));
        }
      }
      if (samples.length > 120) {
        samples.splice(0, samples.length - 120);
      }
    }

    const avg = normalizePerfNumber(toFiniteNumber(fpsDetails.avg));
    const min = normalizePerfNumber(toFiniteNumber(fpsDetails.min));
    const max = normalizePerfNumber(toFiniteNumber(fpsDetails.max));
    const fallbackAvg = !Number.isFinite(avg) && samples.length
      ? normalizePerfNumber(samples.reduce((sum, value) => sum + value, 0) / samples.length)
      : avg;
    const fallbackMin = !Number.isFinite(min) && samples.length
      ? normalizePerfNumber(Math.min(...samples))
      : min;
    const fallbackMax = !Number.isFinite(max) && samples.length
      ? normalizePerfNumber(Math.max(...samples))
      : max;

    const previousLongTasks = Number.isFinite(state.lastPerfSnapshot?.longTasks)
      ? state.lastPerfSnapshot.longTasks
      : 0;
    const longTasksRaw = toFiniteNumber(details.longTasks);
    const longTasks = Number.isFinite(longTasksRaw)
      ? Math.max(0, Math.floor(longTasksRaw))
      : previousLongTasks;

    state.lastPerfSnapshot = {
      fps: {
        avg: Number.isFinite(fallbackAvg) ? fallbackAvg : null,
        min: Number.isFinite(fallbackMin) ? fallbackMin : null,
        max: Number.isFinite(fallbackMax) ? fallbackMax : null,
      },
      longTasks,
      samples,
      timestamp: typeof entry.timestamp === "number" ? entry.timestamp : Date.now(),
    };

    renderPerfPanel();
  }

  function normalizePerfNumber(value){
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(1));
  }

  function renderPerfPanel(perfData){
    if (perfData && typeof perfData === "object") {
      state.lastPerfSnapshot = perfData;
    }
    const refs = state.perfRefs;
    if (!refs) return;
    const snapshot = state.lastPerfSnapshot;
    if (!snapshot) {
      updatePerfMetric(refs.avg, null);
      updatePerfMetric(refs.min, null);
      updatePerfMetric(refs.max, null);
      updatePerfLong(refs.long, null);
      if (refs.samplesCount) refs.samplesCount.textContent = "Samples: 0";
      renderPerfSamples([]);
      return;
    }
    updatePerfMetric(refs.avg, snapshot.fps?.avg ?? null);
    updatePerfMetric(refs.min, snapshot.fps?.min ?? null);
    updatePerfMetric(refs.max, snapshot.fps?.max ?? null);
    updatePerfLong(refs.long, snapshot.longTasks);
    const samples = Array.isArray(snapshot.samples) ? snapshot.samples.slice(-120) : [];
    if (refs.samplesCount) refs.samplesCount.textContent = `Samples: ${samples.length}`;
    renderPerfSamples(samples);
  }

  function updatePerfMetric(element, value){
    if (!element) return;
    if (!Number.isFinite(value)) {
      element.textContent = "—";
      return;
    }
    const formatted = value < 100 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
    element.textContent = formatted;
  }

  function updatePerfLong(element, value){
    if (!element) return;
    if (!Number.isFinite(value)) {
      element.textContent = "—";
      return;
    }
    element.textContent = String(Math.max(0, Math.floor(value)));
  }

  function renderPerfSamples(samples){
    const refs = state.perfRefs;
    if (!refs || !refs.samplesContainer) return;
    const container = refs.samplesContainer;
    container.innerHTML = "";
    if (!Array.isArray(samples) || !samples.length) {
      container.classList.add("gg-diag-perf-samples--empty");
      return;
    }
    container.classList.remove("gg-diag-perf-samples--empty");
    const doc = container.ownerDocument || document;
    const fragment = doc.createDocumentFragment();
    const clamped = samples.slice(-120);
    const maxValue = clamped.reduce((max, sample) => {
      const numeric = Number.isFinite(sample) ? sample : 0;
      return numeric > max ? numeric : max;
    }, 0) || 60;
    const baseline = Math.max(30, Math.min(120, maxValue));
    for (const sample of clamped){
      const numeric = Number.isFinite(sample) ? sample : 0;
      const bar = doc.createElement("span");
      bar.className = "gg-diag-perf-sample";
      const ratio = baseline <= 0 ? 0 : Math.min(1, Math.max(0, numeric / baseline));
      bar.style.height = `${Math.round(ratio * 100)}%`;
      bar.title = `${numeric.toFixed(1)} fps`;
      if (numeric > 0 && numeric < 30) {
        bar.dataset.alert = "true";
      }
      fragment.appendChild(bar);
    }
    container.appendChild(fragment);
  }

  function renderAssetsPanel(assetEntries){
    if (!state.assetsList) return;
    state.assetsList.innerHTML = "";
    if (!Array.isArray(assetEntries) || !assetEntries.length) {
      state.assetsList.appendChild(createEmptyListItem("No asset checks recorded yet."));
      return;
    }
    const limit = Math.min(assetEntries.length, 200);
    for (let idx = 0; idx < limit; idx += 1){
      const i = assetEntries.length - 1 - idx;
      const entry = assetEntries[i];
      state.assetsList.appendChild(createEntryListItem(entry, {
        showBadge: true,
        label: (item) => item?.details?.url || `${item?.category || "asset"} / ${item?.level || "info"}`,
      }));
    }
  }

  function renderEnvironmentPanel(environment){
    if (!state.envContainer) return;
    const { messageEl, detailsEl } = state.envContainer;
    if (!messageEl || !detailsEl) return;
    if (!environment) {
      messageEl.textContent = "Waiting for environment snapshot…";
      detailsEl.textContent = "";
      return;
    }
    const label = environment.message || "Environment snapshot";
    const timestamp = formatDateTime(environment.timestamp);
    const level = environment.level ? environment.level.toUpperCase() : null;
    const status = level ? `${label} · ${level}` : label;
    messageEl.textContent = timestamp ? `${status} · ${timestamp}` : status;
    const details = environment.details ?? environment;
    detailsEl.textContent = formatDetails(details);
  }

  function updateMetaCounts(summary){
    if (!summary || !state.metaCounts) return;
    const { total, warn, error } = state.metaCounts;
    if (total) total.textContent = String(summary.total || 0);
    if (warn) warn.textContent = String(summary.warns || 0);
    if (error) error.textContent = String(summary.errors || 0);
  }

  function renderSummaryPanel(summary){
    if (!state.summaryRefs.statusBadge) return;
    const previous = state.lastSummarySnapshot;
    if (!summary) {
      state.lastSummarySnapshot = null;
      return;
    }
    const status = summary.status || deriveStatus(summary);
    const label = summary.statusLabel || statusLabelFromStatus(status);
    setBadgeStatus(state.summaryRefs.statusBadge, status, label);
    if (state.summaryRefs.statusUpdated) {
      const updated = summary.updatedAt ? formatDateTime(summary.updatedAt) : null;
      state.summaryRefs.statusUpdated.textContent = updated ? `Updated: ${updated}` : "Updated: —";
    }
    if (state.summaryRefs.logsTotal) state.summaryRefs.logsTotal.textContent = String(summary.total || 0);
    if (state.summaryRefs.logsWarn) state.summaryRefs.logsWarn.textContent = String(summary.warns || 0);
    if (state.summaryRefs.logsError) state.summaryRefs.logsError.textContent = String(summary.errors || 0);
    const assetSummary = summary.assets || null;
    if (state.summaryRefs.assetsBadge) {
      const assetStatus = deriveAssetSummaryStatus(assetSummary);
      const assetLabel = assetSummary?.statusLabel || assetStatusLabel(assetStatus);
      setBadgeStatus(state.summaryRefs.assetsBadge, assetStatus, assetLabel);
    }
    if (state.summaryRefs.assetsMessage) {
      state.summaryRefs.assetsMessage.textContent = formatAssetSummaryMessage(assetSummary);
    }
    if (state.summaryRefs.networkTotal) state.summaryRefs.networkTotal.textContent = String(summary.network?.total || 0);
    if (state.summaryRefs.networkWarn) state.summaryRefs.networkWarn.textContent = String(summary.network?.warnings || 0);
    if (state.summaryRefs.networkFail) state.summaryRefs.networkFail.textContent = String(summary.network?.failures || 0);
    if (state.summaryRefs.networkLast) {
      if (summary.network?.last) {
        const netTime = formatDateTime(summary.network.last.timestamp);
        const netMessage = summary.network.last.message || `${summary.network.last.category || "request"}`;
        state.summaryRefs.networkLast.textContent = netTime ? `${netMessage} · ${netTime}` : netMessage;
      } else {
        state.summaryRefs.networkLast.textContent = "No network requests recorded.";
      }
    }
    if (state.summaryRefs.lastErrorMessage) {
      if (summary.lastError) {
        const labelText = summary.lastError.category ? `${summary.lastError.category}: ` : "";
        state.summaryRefs.lastErrorMessage.textContent = `${labelText}${summary.lastError.message || "(no message)"}`;
        if (state.summaryRefs.lastErrorTime) {
          const errTime = formatDateTime(summary.lastError.timestamp);
          state.summaryRefs.lastErrorTime.textContent = errTime ? errTime : "";
        }
      } else {
        state.summaryRefs.lastErrorMessage.textContent = "No errors captured.";
        if (state.summaryRefs.lastErrorTime) state.summaryRefs.lastErrorTime.textContent = "";
      }
    }

    const snapshot = cloneSummaryData(summary);
    state.lastSummarySnapshot = snapshot;
    notifyAdapterSummaryUpdate(snapshot, previous);
  }

  function notifyAdapterSummaryUpdate(currentSummary, previousSummary){
    const adapter = state.gameAdapter;
    if (!adapter || !adapter.hooks) return;
    if (currentSummary) {
      invokeAdapterHook("onStateChange", { summary: currentSummary, previousSummary: previousSummary || null });
      const errorSignature = currentSummary.lastError
        ? `${currentSummary.lastError.timestamp || ""}:${currentSummary.lastError.message || ""}`
        : null;
      if (errorSignature && errorSignature !== state.lastErrorSignature) {
        state.lastErrorSignature = errorSignature;
        invokeAdapterHook("onError", { summary: currentSummary, previousSummary: previousSummary || null, error: currentSummary.lastError });
      } else if (!errorSignature) {
        state.lastErrorSignature = null;
      }
      refreshAdapterScore(currentSummary, previousSummary || null);
    }
  }

  function invokeAdapterHook(name, payload){
    const adapter = state.gameAdapter;
    if (!adapter || !adapter.hooks) return;
    const fn = adapter.hooks[name];
    if (typeof fn !== "function") return;
    try {
      fn(createAdapterContext(payload || {}));
    } catch (err) {
      console.warn(`[gg-diag] adapter ${name} failed`, err);
    }
  }

  function createAdapterContext(extra = {}){
    const summaryElement = extra.summaryElement || state.summaryRefs?.root || null;
    const context = {
      slug: state.gameSlug || "",
      panel: state.summaryPanel || null,
      summaryElement,
      summaryRefs: state.summaryRefs || {},
      requestProbeRun,
      api: state.gameAdapter?.api || {},
      open,
      close,
      toggle,
    };
    return Object.assign(context, extra);
  }

  function refreshAdapterScore(currentSummary){
    const api = state.gameAdapter?.api;
    if (!api || typeof api.getScore !== "function") return;
    const now = Date.now();
    if (state.lastScoreCheck && now - state.lastScoreCheck < 1000) return;
    state.lastScoreCheck = now;
    let result;
    try {
      result = api.getScore({ summary: currentSummary, slug: state.gameSlug });
    } catch (err) {
      console.warn("[gg-diag] adapter getScore failed", err);
      return;
    }
    Promise.resolve(result).then((score) => {
      const serialized = serializeForComparison(score);
      if (serialized === state.lastScoreSerialized) return;
      state.lastScoreSerialized = serialized;
      invokeAdapterHook("onScoreChange", { summary: currentSummary, score });
    }).catch((err) => {
      console.warn("[gg-diag] adapter getScore rejected", err);
    });
  }

  function requestProbeRun(label = "Manual probe", options = {}){
    const api = state.gameAdapter?.api;
    if (!api || typeof api.getEntities !== "function") {
      console.warn("[gg-diag] game adapter missing getEntities API");
      return Promise.resolve(null);
    }
    const runId = Date.now();
    const reason = typeof options.reason === "string" && options.reason.trim() ? options.reason.trim() : "manual";
    let result;
    try {
      result = api.getEntities({ reason, runId, slug: state.gameSlug, options });
    } catch (err) {
      handleProbeFailure(label, reason, runId, err);
      return Promise.reject(err);
    }
    return Promise.resolve(result).then((data) => {
      log({
        category: "probe",
        level: "info",
        message: `${label || "Probe run"}`,
        details: {
          slug: state.gameSlug,
          reason,
          runId,
          entities: safeCloneDetails(data),
        },
        timestamp: Date.now(),
      });
      return data;
    }).catch((err) => {
      handleProbeFailure(label, reason, runId, err);
      throw err;
    });
  }

  function handleProbeFailure(label, reason, runId, error){
    log({
      category: "probe",
      level: "error",
      message: `${label || "Probe run"} failed`,
      details: {
        slug: state.gameSlug,
        reason,
        runId,
        error: safeCloneError(error),
      },
      timestamp: Date.now(),
    });
  }

  function resetProbeRunner(){
    if (state.probeRunner && typeof state.probeRunner.reset === "function") {
      try { state.probeRunner.reset(); } catch (_) {}
    }
    state.probeRunner = null;
    state.probeRunPromise = null;
    state.probeAutoTriggered = false;
  }

  function ensureProbeRunner(){
    if (state.probeRunner) return state.probeRunner;
    const globalModule = global.GGDiagProbes;
    if (globalModule && globalModule !== state.probesModule && typeof globalModule.createProbeRunner === "function") {
      state.probesModule = globalModule;
    }
    if (!state.probesModule) {
      state.probesModule = ensureDiagnosticsProbesModule();
    }
    if (!state.probesModule || typeof state.probesModule.createProbeRunner !== "function") return null;
    const runner = state.probesModule.createProbeRunner({
      adapter: state.gameAdapter,
      log(entry){
        try { log(entry); } catch (err) { console.warn("[gg-diag] probe log failed", err); }
      },
      cloneDetails: safeCloneDetails,
    });
    state.probeRunner = runner;
    return runner;
  }

  function triggerAutoProbeRun(reason = "auto"){
    if (state.probeAutoTriggered) {
      return state.probeRunPromise || Promise.resolve(null);
    }
    const runner = ensureProbeRunner();
    if (!runner || typeof runner.run !== "function") return Promise.resolve(null);
    state.probeAutoTriggered = true;
    const label = typeof reason === "string" && reason ? reason : "auto";
    const promise = Promise.resolve().then(() => runner.run(label));
    state.probeRunPromise = promise;
    promise.catch((err) => {
      log({
        category: "probe",
        level: "error",
        message: "Automatic probe run failed",
        details: {
          reason: label,
          error: safeCloneError(err),
        },
        timestamp: Date.now(),
      });
    }).finally(() => {
      state.probeRunPromise = null;
    });
    return promise;
  }

  function cloneSummaryData(summary){
    if (!summary || typeof summary !== "object") return null;
    try {
      return JSON.parse(JSON.stringify(summary));
    } catch (_) {
      return Object.assign({}, summary);
    }
  }

  function serializeForComparison(value){
    if (value === undefined) return "undefined";
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function safeCloneError(error){
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    return safeCloneDetails(error);
  }

  function safeCloneDetails(value, depth = 0){
    if (value === null || value === undefined) return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return `${value.toString()}n`;
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "function") return `[Function${value.name ? ` ${value.name}` : ""}]`;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    if (depth > 3) return `[Depth ${depth}]`;
    if (Array.isArray(value)) {
      return value.slice(0, 25).map((item) => safeCloneDetails(item, depth + 1));
    }
    if (typeof value === "object") {
      const output = {};
      const keys = Object.keys(value).slice(0, 50);
      for (const key of keys){
        try {
          output[key] = safeCloneDetails(value[key], depth + 1);
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

  function createEntryListItem(entry, options = {}){
    const item = document.createElement("li");
    item.className = "gg-diag-logitem";
    if (options.className) item.classList.add(options.className);
    if (entry && entry.level) item.setAttribute("data-level", entry.level);

    const header = document.createElement("div");
    header.className = "gg-diag-logitem-header";

    if (options.showBadge) {
      header.appendChild(createBadgeForLevel(entry?.level));
    }

    const label = document.createElement("span");
    label.textContent = typeof options.label === "function" ? options.label(entry) : `${entry?.category || "log"} / ${entry?.level || "info"}`;
    header.appendChild(label);

    const time = document.createElement("time");
    time.className = "gg-diag-logitem-time";
    const iso = toISOString(entry?.timestamp);
    if (iso) time.dateTime = iso;
    time.textContent = formatTime(entry?.timestamp);
    header.appendChild(time);

    item.appendChild(header);

    const body = document.createElement("div");
    body.className = "gg-diag-logitem-body";
    body.textContent = entry?.message || "";
    item.appendChild(body);

    if (entry && entry.details && options.showDetails !== false) {
      const meta = document.createElement("div");
      meta.className = "gg-diag-logitem-meta";
      meta.textContent = formatDetails(entry.details);
      item.appendChild(meta);
    }

    return item;
  }

  function createEmptyListItem(text){
    const item = document.createElement("li");
    item.className = "gg-diag-panel-empty";
    item.textContent = text;
    return item;
  }

  function formatTime(value){
    if (typeof value !== "number") return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    try { return date.toLocaleTimeString(); } catch (_) { return date.toISOString(); }
  }

  function formatDateTime(value){
    if (typeof value !== "number") return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    try { return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`; } catch (_) { return date.toISOString(); }
  }

  function toISOString(value){
    if (typeof value !== "number") return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function formatDetails(value){
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      return stringify(value);
    }
  }

  function createBadgeForLevel(level){
    const badge = document.createElement("span");
    badge.className = "gg-diag-badge";
    const normalized = String(level || "info").toLowerCase();
    let status = "pass";
    let text = "Info";
    if (normalized === "error") {
      status = "fail";
      text = "Fail";
    } else if (normalized === "warn") {
      status = "warn";
      text = "Warn";
    } else if (normalized === "debug") {
      status = "pass";
      text = "Debug";
    } else if (normalized === "info") {
      text = "Info";
    } else {
      text = normalized;
    }
    badge.classList.add(`gg-diag-badge--${status}`);
    badge.textContent = text;
    return badge;
  }

  function setBadgeStatus(badge, status, text){
    if (!badge) return;
    const normalized = typeof status === "string" ? status.toLowerCase() : "pass";
    const known = normalized === "fail" || normalized === "warn" || normalized === "pass";
    const applied = known ? normalized : (normalized === "pending" || normalized === "none" ? "pending" : "pass");
    badge.className = `gg-diag-badge gg-diag-badge--${applied}`;
    badge.textContent = text;
    badge.dataset.status = status;
  }

  function deriveStatus(summary){
    if (!summary) return "pass";
    if ((summary.errors || 0) > 0) return "fail";
    if ((summary.warns || 0) > 0) return "warn";
    return "pass";
  }

  function statusLabelFromStatus(status){
    if (status === "fail") return "Errors detected";
    if (status === "warn") return "Warnings detected";
    return "Healthy";
  }

  function deriveAssetSummaryStatus(assetSummary){
    if (!assetSummary) return "pending";
    const status = typeof assetSummary.status === "string" ? assetSummary.status.toLowerCase() : null;
    if (status === "fail" || status === "warn" || status === "pass" || status === "pending" || status === "none") {
      return status;
    }
    if ((assetSummary.errors || 0) > 0) return "fail";
    if ((assetSummary.warns || 0) > 0) return "warn";
    if ((assetSummary.total || 0) > 0) return "pass";
    return "pending";
  }

  function assetStatusLabel(status){
    if (status === "fail") return "Asset errors";
    if (status === "warn") return "Asset warnings";
    if (status === "pass") return "Assets healthy";
    if (status === "none") return "No assets";
    return "Pending scan";
  }

  function formatAssetSummaryMessage(assetSummary){
    if (!assetSummary) return "Waiting for asset scan…";
    if ((assetSummary.total || 0) === 0) {
      if (assetSummary.status === "none") return "No assets declared.";
      return "Waiting for asset scan…";
    }
    if (assetSummary.last) {
      const last = assetSummary.last;
      const parts = [];
      if (last.message) parts.push(last.message);
      const url = last.details?.url;
      if (url) parts.push(url);
      const duration = last.details?.duration;
      if (typeof duration === "number" && Number.isFinite(duration)) {
        parts.push(`${Math.round(duration)} ms`);
      }
      const timestamp = typeof last.timestamp === "number" ? formatDateTime(last.timestamp) : null;
      if (timestamp) parts.push(timestamp);
      return parts.length ? parts.join(" · ") : "Asset scan recorded";
    }
    return "Asset checks recorded.";
  }

  function activateTab(tabId){
    if (!tabId || !state.tabButtons[tabId]) return;
    state.activeTab = tabId;
    for (const tab of TABS){
      const button = state.tabButtons[tab.id];
      const panel = state.panels[tab.id];
      const selected = tab.id === tabId;
      if (button){
        button.setAttribute("aria-selected", selected ? "true" : "false");
        button.setAttribute("tabindex", selected ? "0" : "-1");
      }
      if (panel){
        panel.hidden = !selected;
      }
    }
    if (tabId === "probes") {
      triggerAutoProbeRun("tab-visible");
    }
    if (tabId === "console" && state.logList) {
      requestAnimationFrame(() => {
        state.autoScroll = isScrolledToBottom();
      });
    }
  }

  function handleTabKeydown(event, tabId){
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const currentIndex = TABS.findIndex((tab) => tab.id === tabId);
    if (currentIndex === -1) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TABS.length - 1;
    }
    const nextTab = TABS[nextIndex];
    if (!nextTab) return;
    activateTab(nextTab.id);
    state.tabButtons[nextTab.id]?.focus();
  }

  function createTabPanel(doc, id){
    const panel = doc.createElement("div");
    panel.className = "gg-diag-panel";
    panel.dataset.tabPanel = id;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `gg-diag-tab-${id}`);
    panel.hidden = id !== state.activeTab;
    panel.tabIndex = 0;
    return panel;
  }

  function buildSummaryPanel(doc, panel){
    const wrapper = doc.createElement("div");
    wrapper.className = "gg-diag-summary";

    const statusRow = doc.createElement("div");
    statusRow.className = "gg-diag-summary-status";

    const statusLabel = doc.createElement("span");
    statusLabel.className = "gg-diag-summary-label";
    statusLabel.textContent = "Overall status";

    const statusBadge = doc.createElement("span");
    statusBadge.className = "gg-diag-badge gg-diag-badge--pass";
    statusBadge.textContent = "Healthy";

    const statusUpdated = doc.createElement("span");
    statusUpdated.className = "gg-diag-summary-updated";
    statusUpdated.textContent = "Updated: —";

    statusRow.append(statusLabel, statusBadge, statusUpdated);

    const grid = doc.createElement("div");
    grid.className = "gg-diag-summary-grid";

    const logsCard = doc.createElement("div");
    logsCard.className = "gg-diag-summary-card";
    const logsLabel = doc.createElement("span");
    logsLabel.className = "gg-diag-summary-label";
    logsLabel.textContent = "Log entries";
    const logsValue = doc.createElement("strong");
    logsValue.className = "gg-diag-summary-value";
    logsValue.textContent = "0";
    const logsSub = doc.createElement("div");
    logsSub.className = "gg-diag-summary-sub";
    const logsWarn = doc.createElement("span");
    logsWarn.className = "gg-diag-summary-metric";
    logsWarn.textContent = "0";
    const logsError = doc.createElement("span");
    logsError.className = "gg-diag-summary-metric";
    logsError.textContent = "0";
    logsSub.append("Warn: ", logsWarn, document.createTextNode(" • Error: "), logsError);
    logsCard.append(logsLabel, logsValue, logsSub);

    const assetsCard = doc.createElement("div");
    assetsCard.className = "gg-diag-summary-card";
    const assetsLabel = doc.createElement("span");
    assetsLabel.className = "gg-diag-summary-label";
    assetsLabel.textContent = "Assets";
    const assetsBadge = doc.createElement("span");
    assetsBadge.className = "gg-diag-badge gg-diag-badge--pending";
    assetsBadge.textContent = "Pending";
    const assetsMessage = doc.createElement("div");
    assetsMessage.className = "gg-diag-summary-sub";
    assetsMessage.textContent = "Waiting for asset scan…";
    assetsCard.append(assetsLabel, assetsBadge, assetsMessage);

    const networkCard = doc.createElement("div");
    networkCard.className = "gg-diag-summary-card";
    const networkLabel = doc.createElement("span");
    networkLabel.className = "gg-diag-summary-label";
    networkLabel.textContent = "Network";
    const networkValue = doc.createElement("strong");
    networkValue.className = "gg-diag-summary-value";
    networkValue.textContent = "0";
    const networkSub = doc.createElement("div");
    networkSub.className = "gg-diag-summary-sub";
    const networkWarn = doc.createElement("span");
    networkWarn.className = "gg-diag-summary-metric";
    networkWarn.textContent = "0";
    const networkFail = doc.createElement("span");
    networkFail.className = "gg-diag-summary-metric";
    networkFail.textContent = "0";
    networkSub.append("Warn: ", networkWarn, document.createTextNode(" • Fail: "), networkFail);
    const networkLast = doc.createElement("div");
    networkLast.className = "gg-diag-summary-subtle";
    networkLast.textContent = "No network requests recorded.";
    networkCard.append(networkLabel, networkValue, networkSub, networkLast);

    const errorCard = doc.createElement("div");
    errorCard.className = "gg-diag-summary-card";
    const errorLabel = doc.createElement("span");
    errorLabel.className = "gg-diag-summary-label";
    errorLabel.textContent = "Last error";
    const errorMessage = doc.createElement("div");
    errorMessage.className = "gg-diag-summary-sub";
    errorMessage.textContent = "No errors captured.";
    const errorTime = doc.createElement("div");
    errorTime.className = "gg-diag-summary-subtle";
    errorTime.textContent = "";
    errorCard.append(errorLabel, errorMessage, errorTime);

    grid.append(logsCard, assetsCard, networkCard, errorCard);
    wrapper.append(statusRow, grid);
    panel.append(wrapper);

    state.summaryRefs = {
      root: wrapper,
      statusBadge,
      statusUpdated,
      logsTotal: logsValue,
      logsWarn,
      logsError,
      assetsBadge,
      assetsMessage,
      networkTotal: networkValue,
      networkWarn,
      networkFail,
      networkLast,
      lastErrorMessage: errorMessage,
      lastErrorTime: errorTime,
    };
    state.summaryPanel = panel;
    maybeInvokeAdapterReady(wrapper);
  }

  function maybeInvokeAdapterReady(summaryElement){
    const adapter = state.gameAdapter;
    if (!adapter || !adapter.hooks || typeof adapter.hooks.onReady !== "function") return;
    if (!summaryElement || !state.summaryPanel) return;
    if (state.adapterReadyFired) return;
    try {
      adapter.hooks.onReady(createAdapterContext({ summaryElement }));
      state.adapterReadyFired = true;
    } catch (err) {
      console.warn("[gg-diag] adapter onReady failed", err);
    }
  }

  function buildErrorsPanel(doc, panel){
    const list = doc.createElement("ul");
    list.className = "gg-diag-loglist gg-diag-panel-list";
    panel.appendChild(list);
    state.errorsList = list;
  }

  function buildConsolePanel(doc, panel){
    const list = doc.createElement("ul");
    list.className = "gg-diag-loglist";
    list.setAttribute("role", "log");
    list.setAttribute("aria-live", "polite");
    list.setAttribute("aria-relevant", "additions");
    panel.appendChild(list);
    state.logList = list;
  }

  function buildProbesPanel(doc, panel){
    const list = doc.createElement("ul");
    list.className = "gg-diag-loglist gg-diag-panel-list";
    panel.appendChild(list);
    state.probesList = list;
  }

  function buildNetworkPanel(doc, panel){
    const container = doc.createElement("div");
    container.className = "gg-diag-network";

    const tableWrap = doc.createElement("div");
    tableWrap.className = "gg-diag-network-tablewrap";

    const table = doc.createElement("table");
    table.className = "gg-diag-network-table";

    const thead = doc.createElement("thead");
    const headerRow = doc.createElement("tr");
    const columns = [
      { key: "method", label: "Method" },
      { key: "url", label: "URL" },
      { key: "status", label: "Status", align: "right" },
      { key: "duration", label: "ms", align: "right" },
      { key: "bytes", label: "Size", align: "right" },
    ];
    const headerRefs = {};
    for (const column of columns){
      const th = doc.createElement("th");
      th.scope = "col";
      th.className = `gg-diag-network-col gg-diag-network-col--${column.key}`;
      if (column.align === "right") th.classList.add("gg-diag-network-col--right");
      th.setAttribute("aria-sort", "none");
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "gg-diag-network-sort";
      button.textContent = column.label;
      button.setAttribute("aria-label", `Sort by ${column.label}`);
      button.addEventListener("click", () => handleNetworkSort(column.key));
      th.appendChild(button);
      headerRow.appendChild(th);
      headerRefs[column.key] = { button, th };
    }
    thead.appendChild(headerRow);

    const tbody = doc.createElement("tbody");

    table.append(thead, tbody);
    tableWrap.appendChild(table);

    const empty = doc.createElement("p");
    empty.className = "gg-diag-panel-empty gg-diag-network-empty";
    empty.textContent = "No network requests recorded.";

    container.append(tableWrap, empty);
    panel.append(container);

    state.networkTable = { container, table, tbody, empty, headers: headerRefs };
    updateNetworkSortIndicators();
    renderNetworkPanel();
  }

  function buildPerfPanel(doc, panel){
    const wrapper = doc.createElement("div");
    wrapper.className = "gg-diag-perf";

    const grid = doc.createElement("div");
    grid.className = "gg-diag-perf-grid";

    const metrics = [
      { key: "avg", label: "Avg FPS" },
      { key: "min", label: "Min FPS" },
      { key: "max", label: "Max FPS" },
      { key: "long", label: "Long tasks" },
    ];

    const refs = {};
    for (const metric of metrics){
      const card = doc.createElement("div");
      card.className = "gg-diag-perf-card";
      const label = doc.createElement("span");
      label.className = "gg-diag-perf-card-label";
      label.textContent = metric.label;
      const value = doc.createElement("span");
      value.className = "gg-diag-perf-card-value";
      value.textContent = "—";
      card.append(label, value);
      grid.appendChild(card);
      refs[metric.key] = value;
    }

    const samplesWrapper = doc.createElement("div");
    samplesWrapper.className = "gg-diag-perf-samples-wrapper";

    const samplesHeader = doc.createElement("div");
    samplesHeader.className = "gg-diag-perf-samples-header";
    const samplesTitle = doc.createElement("span");
    samplesTitle.textContent = "Frame samples";
    const samplesCount = doc.createElement("span");
    samplesCount.className = "gg-diag-perf-samples-count";
    samplesCount.textContent = "Samples: 0";
    samplesHeader.append(samplesTitle, samplesCount);

    const samplesContainer = doc.createElement("div");
    samplesContainer.className = "gg-diag-perf-samples gg-diag-perf-samples--empty";

    samplesWrapper.append(samplesHeader, samplesContainer);

    wrapper.append(grid, samplesWrapper);
    panel.append(wrapper);

    state.perfPanel = wrapper;
    state.perfRefs = {
      avg: refs.avg,
      min: refs.min,
      max: refs.max,
      long: refs.long,
      samplesCount,
      samplesContainer,
    };

    renderPerfPanel();
  }

  function buildAssetsPanel(doc, panel){
    const list = doc.createElement("ul");
    list.className = "gg-diag-loglist gg-diag-panel-list gg-diag-assets-list";
    panel.appendChild(list);
    state.assetsList = list;
  }

  function buildEnvPanel(doc, panel){
    const wrapper = doc.createElement("div");
    wrapper.className = "gg-diag-env";
    const message = doc.createElement("p");
    message.className = "gg-diag-env-meta";
    message.textContent = "Waiting for environment snapshot…";
    const pre = doc.createElement("pre");
    pre.className = "gg-diag-env-pre";
    pre.textContent = "";
    wrapper.append(message, pre);
    panel.append(wrapper);
    state.envContainer = { messageEl: message, detailsEl: pre };
  }

  function ensureReportStoreModule(){
    if (global.GGDiagReportStore && typeof global.GGDiagReportStore.createReportStore === "function") {
      return global.GGDiagReportStore;
    }
    if (typeof module === "object" && module && typeof module.require === "function") {
      try {
        const required = module.require("./diagnostics/report-store.js");
        if (required && typeof required.createReportStore === "function") {
          global.GGDiagReportStore = required;
          return required;
        }
      } catch (_) {}
    }
    if (typeof require === "function") {
      try {
        const required = require("./diagnostics/report-store.js");
        if (required && typeof required.createReportStore === "function") {
          global.GGDiagReportStore = required;
          return required;
        }
      } catch (_) {}
    }
    const fallback = createFallbackReportStoreModule();
    global.GGDiagReportStore = fallback;
    console.warn("[gg-diag] diagnostics report store module missing; using fallback store");
    return fallback;
  }

  function createFallbackReportStoreModule(){
    const PROBE_CATEGORIES = new Set(["performance", "service-worker", "heartbeat", "metrics", "telemetry", "probe", "resource", "feature", "capability"]);
    const DEFAULTS = {
      maxEntries: 500,
      maxConsole: 500,
      maxNetwork: 200,
      maxAssets: 200,
      maxProbes: 200,
      maxEnvHistory: 12,
    };

    function sanitizeLimit(value, fallback){
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) return fallback;
      return Math.max(1, Math.floor(num));
    }

    function createReportStore(options = {}){
      const maxEntries = sanitizeLimit(options.maxEntries, DEFAULTS.maxEntries);
      const config = {
        maxEntries,
        maxConsole: sanitizeLimit(options.maxConsole, maxEntries),
        maxNetwork: sanitizeLimit(options.maxNetwork, DEFAULTS.maxNetwork),
        maxAssets: sanitizeLimit(options.maxAssets, DEFAULTS.maxAssets),
        maxProbes: sanitizeLimit(options.maxProbes, DEFAULTS.maxProbes),
        maxEnvHistory: sanitizeLimit(options.maxEnvHistory, DEFAULTS.maxEnvHistory),
      };

      const summary = {
        startedAt: Date.now(),
        updatedAt: null,
        total: 0,
        errors: 0,
        warns: 0,
        info: 0,
        debug: 0,
        status: "pass",
        statusLabel: "Healthy",
        categories: {},
        network: { total: 0, failures: 0, warnings: 0, last: null },
        assets: { total: 0, errors: 0, warns: 0, last: null, status: "pending", statusLabel: "Pending scan" },
        lastError: null,
        lastWarn: null,
      };

      const state = {
        console: [],
        network: [],
        assets: [],
        probes: [],
        envHistory: [],
        environment: null,
      };

      function add(entry){
        if (!entry) return snapshot();
        const normalized = normalizeEntry(entry);
        pushLimited(state.console, normalized, config.maxConsole);
        categorize(normalized);
        updateSummary(normalized);
        return snapshot();
      }

      function snapshot(){
        return {
          summary: cloneSummary(),
          console: state.console.slice(),
          assets: state.assets.slice(),
          probes: state.probes.slice(),
          network: state.network.slice(),
          environment: state.environment ? { ...state.environment } : null,
          envHistory: state.envHistory.slice(),
        };
      }

      function toJSON(){
        const snap = snapshot();
        return {
          generatedAt: new Date().toISOString(),
          summary: snap.summary,
          console: snap.console,
          assets: snap.assets,
          probes: snap.probes,
          network: snap.network,
          environment: snap.environment,
          envHistory: snap.envHistory,
        };
      }

      function toText(){
        const snap = snapshot();
        const lines = [];
        lines.push("=== Diagnostics Summary ===");
        lines.push(`Generated: ${new Date().toISOString()}`);
        lines.push(`Status: ${snap.summary.statusLabel}`);
        lines.push(`Total entries: ${snap.summary.total}`);
        lines.push(`Errors: ${snap.summary.errors}, Warnings: ${snap.summary.warns}`);
        if (snap.summary.network.total) {
          lines.push(`Network: ${snap.summary.network.total} requests (${snap.summary.network.failures} fail, ${snap.summary.network.warnings} warn)`);
        }
        if (snap.summary.lastError) {
          lines.push(`Last error: [${formatISO(snap.summary.lastError.timestamp)}] ${snap.summary.lastError.message}`);
        }
        lines.push("");
        lines.push("=== Console Entries ===");
        if (snap.console.length) {
          snap.console.forEach((entry) => lines.push(formatLine(entry)));
        } else {
          lines.push("No console entries captured.");
        }
        lines.push("");
        lines.push("=== Probes ===");
        if (snap.probes.length) {
          snap.probes.forEach((entry) => lines.push(formatLine(entry)));
        } else {
          lines.push("No probe activity captured.");
        }
        lines.push("");
        lines.push("=== Network ===");
        if (snap.network.length) {
          snap.network.forEach((entry) => lines.push(formatLine(entry)));
        } else {
          lines.push("No network requests recorded.");
        }
        lines.push("");
        lines.push("=== Assets ===");
        if (snap.assets.length) {
          snap.assets.forEach((entry) => lines.push(formatLine(entry)));
        } else {
          lines.push("No asset checks recorded.");
        }
        lines.push("");
        lines.push("=== Environment ===");
        if (snap.environment) {
          lines.push(safeStringify(snap.environment.details ?? snap.environment));
        } else {
          lines.push("No environment snapshot available.");
        }
        return lines.join("\n");
      }

      function categorize(entry){
        const categoryKey = entry.category.toLowerCase();
        if (categoryKey === "network") {
          pushLimited(state.network, entry, config.maxNetwork);
          return;
        }
        if (categoryKey === "asset") {
          pushLimited(state.assets, entry, config.maxAssets);
          return;
        }
        if (categoryKey === "environment") {
          const envSnapshot = summarizeEntry(entry, true);
          state.environment = envSnapshot;
          pushLimited(state.envHistory, envSnapshot, config.maxEnvHistory);
          return;
        }
        if (PROBE_CATEGORIES.has(categoryKey)) {
          pushLimited(state.probes, entry, config.maxProbes);
        }
      }

      function updateSummary(entry){
        summary.total += 1;
        const level = entry.level;
        if (level === "error") {
          summary.errors += 1;
          summary.lastError = summarizeEntry(entry);
        } else if (level === "warn") {
          summary.warns += 1;
          summary.lastWarn = summarizeEntry(entry);
        } else if (level === "info") {
          summary.info += 1;
        } else if (level === "debug") {
          summary.debug += 1;
        }
        const categoryKey = entry.category.toLowerCase();
        summary.categories[categoryKey] = (summary.categories[categoryKey] || 0) + 1;
        summary.updatedAt = entry.timestamp;
        if (categoryKey === "network") {
          summary.network.total += 1;
          if (level === "error") summary.network.failures += 1;
          else if (level === "warn") summary.network.warnings += 1;
          summary.network.last = summarizeEntry(entry);
        } else if (categoryKey === "asset") {
          summary.assets.total += 1;
          if (level === "error") summary.assets.errors += 1;
          else if (level === "warn") summary.assets.warns += 1;
          summary.assets.last = summarizeEntry(entry, true);
          const assetStatus = deriveAssetStatus(summary.assets);
          summary.assets.status = assetStatus;
          summary.assets.statusLabel = assetStatusLabel(assetStatus);
        }
        summary.status = deriveSummaryStatus(summary);
        summary.statusLabel = statusLabelFromSummaryStatus(summary.status);
      }

      function cloneSummary(){
        return {
          startedAt: summary.startedAt,
          updatedAt: summary.updatedAt,
          total: summary.total,
          errors: summary.errors,
          warns: summary.warns,
          info: summary.info,
          debug: summary.debug,
          status: summary.status,
          statusLabel: summary.statusLabel,
          categories: Object.assign({}, summary.categories),
          network: Object.assign({}, summary.network, { last: summary.network.last ? { ...summary.network.last } : null }),
          assets: Object.assign({}, summary.assets, { last: summary.assets.last ? { ...summary.assets.last } : null }),
          lastError: summary.lastError ? { ...summary.lastError } : null,
          lastWarn: summary.lastWarn ? { ...summary.lastWarn } : null,
        };
      }

      function normalizeEntry(value){
        if (!value) {
          return {
            timestamp: Date.now(),
            level: "info",
            category: "general",
            message: "",
            details: null,
          };
        }
        const timestamp = typeof value.timestamp === "number" ? value.timestamp : Date.now();
        const level = typeof value.level === "string" ? value.level.toLowerCase() : "info";
        const category = typeof value.category === "string" ? value.category : "general";
        const message = value.message != null ? String(value.message) : "";
        const details = value.details ?? null;
        return { timestamp, level, category, message, details };
      }

      function summarizeEntry(entry, includeDetails){
        const summaryEntry = {
          timestamp: entry.timestamp,
          level: entry.level,
          category: entry.category,
          message: entry.message,
        };
        if (includeDetails) {
          summaryEntry.details = entry.details;
        }
        return summaryEntry;
      }

      function pushLimited(list, item, limit){
        list.push(item);
        if (list.length > limit) {
          list.splice(0, list.length - limit);
        }
      }

      function deriveSummaryStatus(value){
        if ((value.errors || 0) > 0) return "fail";
        if ((value.warns || 0) > 0) return "warn";
        return "pass";
      }

      function statusLabelFromSummaryStatus(status){
        if (status === "fail") return "Errors detected";
        if (status === "warn") return "Warnings detected";
        return "Healthy";
      }

      function deriveAssetStatus(assetSummary){
        if (!assetSummary) return "pending";
        if ((assetSummary.errors || 0) > 0) return "fail";
        if ((assetSummary.warns || 0) > 0) return "warn";
        if ((assetSummary.total || 0) > 0) return "pass";
        if (assetSummary.status === "none") return "none";
        return "pending";
      }

      function assetStatusLabel(status){
        if (status === "fail") return "Asset errors";
        if (status === "warn") return "Asset warnings";
        if (status === "pass") return "Assets healthy";
        if (status === "none") return "No assets";
        return "Pending scan";
      }

      function safeStringify(value){
        try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
      }

      function formatLine(entry){
        return `[${formatISO(entry.timestamp)}] ${entry.category}/${entry.level} ${entry.message}`;
      }

      function formatISO(value){
        if (typeof value !== "number") return "";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : date.toISOString();
      }

      return {
        config,
        add,
        snapshot,
        toJSON,
        toText,
      };
    }

    return { createReportStore };
  }

  function handleScroll(){
    const nearBottom = isScrolledToBottom();
    state.autoScroll = nearBottom;
  }

  function isScrolledToBottom(){
    if (!state.logList) return true;
    const { scrollTop, scrollHeight, clientHeight } = state.logList;
    return scrollHeight - (scrollTop + clientHeight) < 24;
  }

  function firstFocusable(){
    if (!state.modal) return null;
    const selectors = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])"
    ];
    const nodes = state.modal.querySelectorAll(selectors.join(","));
    return nodes.length ? nodes[0] : null;
  }

  function trapKeydown(event){
    if (!state.isOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    if (!state.modal) return;
    const focusable = Array.from(state.modal.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    if (!focusable.length) {
      event.preventDefault();
      state.modal.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function announce(message){
    if (!state.root) return;
    let region = state.root.querySelector("[data-gg-diag-live]");
    if (!region){
      region = document.createElement("div");
      region.className = "gg-diag-hidden";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      region.dataset.ggDiagLive = "";
      state.root.appendChild(region);
    }
    region.textContent = message;
  }
})();
