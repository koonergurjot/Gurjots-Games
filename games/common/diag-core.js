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
  global.__GG_DIAG_OPTS = Object.assign({}, { suppressButton: true }, global.__GG_DIAG_OPTS || {});

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
    { id: "console", label: "Console" },
    { id: "probes", label: "Probes" },
    { id: "network", label: "Network" },
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
    networkList: null,
    envContainer: null,
    autoScroll: true,
    isOpen: false,
    activeTab: "summary",
    lastFocus: null,
    styleInjected: false,
    cssHref: null,
    adapterModule: null,
    gameSlug: null,
    gameAdapter: null,
    adapterReadyFired: false,
    lastSummarySnapshot: null,
    lastErrorSignature: null,
    lastScoreSerialized: null,
    lastScoreCheck: 0,
    probesModule: null,
    probeRunner: null,
    probeRunPromise: null,
    probeAutoTriggered: false,
  };

  state.adapterModule = ensureDiagnosticsAdapterModule();
  state.gameSlug = detectGameSlug();
  state.probesModule = ensureDiagnosticsProbesModule();
  if (state.gameSlug && state.adapterModule && typeof state.adapterModule.getGameDiagnostics === "function") {
    assignGameAdapter(state.adapterModule.getGameDiagnostics(state.gameSlug));
  }
  if (state.adapterModule && typeof state.adapterModule.subscribe === "function") {
    state.adapterModule.subscribe((slug, record) => {
      if (!slug || slug !== state.gameSlug) return;
      assignGameAdapter(record);
    });
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
    appendConsoleEntry(normalized);
    updateMetaCounts(snapshot.summary);
    renderSummaryPanel(snapshot.summary);
    renderProbesPanel(snapshot.probes || []);
    renderNetworkPanel(snapshot.network || []);
    renderEnvironmentPanel(snapshot.environment || null);
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
      announce("Copied diagnostics to clipboard");
    } catch (err) {
      announce("Unable to copy diagnostics");
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
    if (global.GGDiagAdapters && typeof global.GGDiagAdapters.registerGameDiagnostics === "function") {
      return global.GGDiagAdapters;
    }
    if (typeof module === "object" && module && typeof module.require === "function") {
      try {
        const required = module.require("./diagnostics/adapter.js");
        if (required && typeof required.registerGameDiagnostics === "function") {
          global.GGDiagAdapters = required;
          return required;
        }
      } catch (_) {}
    }
    if (typeof require === "function") {
      try {
        const required = require("./diagnostics/adapter.js");
        if (required && typeof required.registerGameDiagnostics === "function") {
          global.GGDiagAdapters = required;
          return required;
        }
      } catch (_) {}
    }
    const fallback = createFallbackDiagnosticsAdapter();
    global.GGDiagAdapters = fallback;
    return fallback;
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

  function createFallbackDiagnosticsAdapter(){
    const registry = new Map();
    const listeners = new Set();

    function registerGameDiagnostics(slug, adapter){
      if (typeof slug !== "string" || !slug.trim()) {
        throw new TypeError("registerGameDiagnostics requires a slug");
      }
      const normalizedSlug = slug.trim();
      const hooks = {};
      const api = {};
      const hookKeys = ["onReady", "onError", "onStateChange", "onScoreChange"];
      const apiKeys = ["start", "pause", "resume", "reset", "getScore", "setDifficulty", "getEntities"];
      const adapterHooks = adapter && typeof adapter === "object" ? adapter.hooks || {} : {};
      const adapterApi = adapter && typeof adapter === "object" ? (adapter.api || adapter.apis || {}) : {};
      for (const key of hookKeys){
        if (typeof adapterHooks[key] === "function") hooks[key] = adapterHooks[key];
      }
      for (const key of apiKeys){
        if (typeof adapterApi[key] === "function") api[key] = adapterApi[key];
      }
      const record = Object.freeze({ slug: normalizedSlug, hooks, api });
      registry.set(normalizedSlug, record);
      listeners.forEach((listener) => {
        try { listener(normalizedSlug, record); } catch (err) { console.warn("[gg-diag] adapter listener failed", err); }
      });
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

    return { registerGameDiagnostics, getGameDiagnostics, subscribe };
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

  function ensureUI(){
    if (state.injected) return;
    state.injected = true;
    ensureStyle();
    removeLegacy();

    const doc = document;
    const root = doc.createElement("div");
    root.dataset.ggDiagRoot = "modern";
    root.className = "diag-overlay";

    const fab = doc.createElement("button");
    fab.type = "button";
    fab.className = "gg-diag-fab";
    fab.setAttribute("aria-label", "Open diagnostics console");
    fab.setAttribute("aria-haspopup", "dialog");
    fab.setAttribute("aria-expanded", "false");
    fab.innerHTML = "&#9881;";
    fab.addEventListener("click", () => open());

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
      } else if (tab.id === "console") {
        buildConsolePanel(doc, panel);
      } else if (tab.id === "probes") {
        buildProbesPanel(doc, panel);
      } else if (tab.id === "network") {
        buildNetworkPanel(doc, panel);
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

    const btnDownload = doc.createElement("button");
    btnDownload.type = "button";
    btnDownload.className = "gg-diag-action";
    btnDownload.textContent = "Download JSON";
    btnDownload.addEventListener("click", () => download());

    actions.append(btnCopy, btnDownload);

    modal.append(header, body, actions);
    backdrop.append(modal);
    root.append(backdrop);
    doc.body.append(root, fab);

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
      renderProbesPanel(snapshot.probes || []);
      renderNetworkPanel(snapshot.network || []);
      renderEnvironmentPanel(snapshot.environment || null);
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

  function appendConsoleEntry(entry){
    if (!state.logList) return;
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
    const start = Math.max(0, entries.length - state.maxLogs);
    for (let i = start; i < entries.length; i += 1) {
      const entry = entries[i];
      state.logList.appendChild(createEntryListItem(entry));
    }
    state.logList.scrollTop = state.logList.scrollHeight;
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
    if (!state.networkList) return;
    state.networkList.innerHTML = "";
    if (!Array.isArray(networkEntries) || !networkEntries.length) {
      state.networkList.appendChild(createEmptyListItem("No network requests recorded."));
      return;
    }
    for (const entry of networkEntries){
      state.networkList.appendChild(createEntryListItem(entry, { showBadge: true }));
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
    badge.className = `gg-diag-badge gg-diag-badge--${status}`;
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

    grid.append(logsCard, networkCard, errorCard);
    wrapper.append(statusRow, grid);
    panel.append(wrapper);

    state.summaryRefs = {
      root: wrapper,
      statusBadge,
      statusUpdated,
      logsTotal: logsValue,
      logsWarn,
      logsError,
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
    const list = doc.createElement("ul");
    list.className = "gg-diag-loglist gg-diag-panel-list";
    panel.appendChild(list);
    state.networkList = list;
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
        lastError: null,
        lastWarn: null,
      };

      const state = {
        console: [],
        network: [],
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
