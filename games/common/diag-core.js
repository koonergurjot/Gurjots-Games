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

  const state = {
    logs: [],
    maxLogs: 500,
    injected: false,
    root: null,
    fab: null,
    backdrop: null,
    modal: null,
    logList: null,
    metaEl: null,
    autoScroll: true,
    isOpen: false,
    lastFocus: null,
    styleInjected: false,
    cssHref: null,
  };

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
    state.logs.push(normalized);
    if (state.logs.length > state.maxLogs) state.logs.splice(0, state.logs.length - state.maxLogs);
    renderLog(normalized);
  }

  function exportJSON(){
    return JSON.stringify(state.logs, null, 2);
  }

  function exportText(){
    return state.logs.map((item) => {
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

  function ensureUI(){
    if (state.injected) return;
    state.injected = true;
    ensureStyle();
    removeLegacy();

    const doc = document;
    const root = doc.createElement("div");
    root.dataset.ggDiagRoot = "modern";

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
    meta.innerHTML = `<span>Logs: <strong>0</strong></span>`;
    state.metaEl = meta.querySelector("strong");

    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gg-diag-close";
    closeBtn.textContent = "Close";
    closeBtn.setAttribute("aria-label", "Close diagnostics console");
    closeBtn.addEventListener("click", () => close());

    header.append(title, meta, closeBtn);

    const body = doc.createElement("div");
    body.className = "gg-diag-modal-body";

    const logList = doc.createElement("ul");
    logList.className = "gg-diag-loglist";
    logList.setAttribute("role", "log");
    logList.setAttribute("aria-live", "polite");
    logList.setAttribute("aria-relevant", "additions");
    state.logList = logList;

    body.append(logList);

    const actions = doc.createElement("div");
    actions.className = "gg-diag-modal-actions";

    const btnCopy = doc.createElement("button");
    btnCopy.type = "button";
    btnCopy.className = "gg-diag-action";
    btnCopy.textContent = "Copy summary";
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

    actions.append(btnCopy, btnCopyJSON, btnDownload);

    modal.append(header, body, actions);
    backdrop.append(modal);
    root.append(backdrop, fab);
    doc.body.appendChild(root);

    state.root = root;
    state.fab = fab;
    state.backdrop = backdrop;
    state.modal = modal;

    state.logList.addEventListener("scroll", handleScroll);
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

  function renderLog(entry){
    if (!state.logList) return;
    const item = document.createElement("li");
    item.className = "gg-diag-logitem";
    item.setAttribute("data-level", entry.level);

    const header = document.createElement("div");
    header.className = "gg-diag-logitem-header";
    const label = document.createElement("span");
    label.textContent = `${entry.category} / ${entry.level}`;
    const time = document.createElement("time");
    time.className = "gg-diag-logitem-time";
    time.dateTime = new Date(entry.timestamp).toISOString();
    time.textContent = new Date(entry.timestamp).toLocaleTimeString();
    header.append(label, time);

    const body = document.createElement("div");
    body.className = "gg-diag-logitem-body";
    body.textContent = entry.message;

    item.append(header, body);

    if (entry.details) {
      const meta = document.createElement("div");
      meta.className = "gg-diag-logitem-meta";
      meta.textContent = stringify(entry.details);
      item.append(meta);
    }

    const shouldStick = state.autoScroll && isScrolledToBottom();
    state.logList.appendChild(item);
    state.metaEl && (state.metaEl.textContent = String(state.logs.length));
    if (shouldStick) {
      requestAnimationFrame(() => {
        state.logList.scrollTop = state.logList.scrollHeight;
      });
    }
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
