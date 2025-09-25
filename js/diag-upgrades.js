/* Common diagnostics helpers (optional per-game include)
   - Attaches window.onerror + unhandledrejection and posts GAME_ERROR
   - Posts GAME_READY after first animation frame if a loop starts
*/
(function(){
  if (window.__diagUpInstalled) return; window.__diagUpInstalled = true;

  const post = (type, extra) => {
    try {
      window.parent?.postMessage({ type, ...extra }, "*");
    } catch (e) {}
  };

  let postedError = false;
  const postError = (msg, opts) => {
    const message = String(msg || "Unknown error");
    const force = opts && opts.force;
    if (!postedError || force) {
      postedError = true;
      post("GAME_ERROR", { error: message });
    }
    return message;
  };

  const normalizeUrl = (value) => {
    if (!value) return "";
    try {
      return new URL(String(value), window.location.href).href;
    } catch (e) {
      return String(value);
    }
  };

  const reportedAssets = new Set();
  const reportMissingAsset = (raw, info) => {
    const url = normalizeUrl(raw);
    const key = url || info || "";
    if (key && reportedAssets.has(key)) return;
    if (key) reportedAssets.add(key);
    const suffix = info ? ` (${info})` : "";
    const message = url ? `Missing asset: ${url}${suffix}` : `Missing asset${suffix ? `: ${suffix}` : ""}`;
    postError(message, { force: true });
  };

  window.addEventListener("error", (e)=> postError(e && (e.message || e.error) ));
  window.addEventListener("unhandledrejection", (e)=> postError(e && (e.reason || e.message)));
  window.addEventListener("error", (event) => {
    const target = event && event.target;
    if (!target || target === window) return;
    const tag = target.tagName;
    if (!tag) return;
    const name = tag.toUpperCase();
    const hasSrc = "src" in target;
    const hasHref = "href" in target;
    if (!hasSrc && !hasHref) return;
    if (!/(IMG|AUDIO|VIDEO|SOURCE|SCRIPT|LINK|IFRAME)/.test(name)) return;
    const src = hasSrc ? (target.currentSrc || target.src) : target.href;
    if (!src) return;
    reportMissingAsset(src);
  }, true);

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function(...args) {
      const url = args && args.length ? args[0] : "";
      const requestUrl = normalizeUrl((url && url.url) || url);
      return originalFetch.apply(this, args).then((response) => {
        if (response && response.status && response.status >= 400) {
          const statusInfo = response.status ? `status ${response.status}` : "request failed";
          reportMissingAsset(response.url || requestUrl, statusInfo);
        }
        return response;
      }).catch((error) => {
        if (requestUrl) reportMissingAsset(requestUrl);
        throw error;
      });
    };
  }

  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    const XHRProto = window.XMLHttpRequest.prototype;
    const originalOpen = XHRProto.open;
    const originalSend = XHRProto.send;

    XHRProto.open = function(method, url, ...rest) {
      this.__diagUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XHRProto.send = function(...args) {
      const handleResult = () => {
        if (this.readyState === 4) {
          this.removeEventListener("readystatechange", handleResult);
          if (this.status && this.status >= 400) {
            const statusInfo = this.status ? `status ${this.status}` : "request failed";
            reportMissingAsset(this.responseURL || this.__diagUrl, statusInfo);
          }
        }
      };

      this.addEventListener("error", () => {
        reportMissingAsset(this.responseURL || this.__diagUrl);
      });
      this.addEventListener("readystatechange", handleResult);
      return originalSend.apply(this, args);
    };
  }

  // If the game calls start()/init() and runs a loop, nudge READY after next frame
  let raf = window.requestAnimationFrame;
  let loopDetected = false;
  window.requestAnimationFrame = function(fn){
    loopDetected = true;
    return raf.call(window, function(t){ fn(t); });
  };

  // Fallback READY if a loop appears
  setTimeout(function(){
    if (loopDetected) post("GAME_READY");
  }, 500);
})();
