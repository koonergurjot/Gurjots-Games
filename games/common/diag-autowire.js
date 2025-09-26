
/**
 * diag-autowire.js (safe drop-in)
 * - Keeps existing diagnostics functionality.
 * - Prevents/cleans up duplicate "Diagnostics" buttons.
 * - If our preferred #gg-diag-btn exists, we won't add another button.
 *
 * This file is intentionally self-contained and defensive. It won't throw if
 * parts of the legacy diagnostics framework are missing.
 */

(function () {
  // Utility: safely log under a consistent tag
  const log = (...args) => {
    try { console.log("[diag-autowire]", ...args); } catch (_) {}
  };

  // 1) Defer until DOM is interactive for reliable querying
  const onReady = (fn) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else { fn(); }
  };

  // 2) Remove any legacy copy-only buttons or duplicate "Diagnostics" buttons
  const removeDuplicateButtons = () => {
    try {
      const preferred = document.getElementById("gg-diag-btn");
      // Candidates that previous builds might have created
      const candidates = Array.from(document.querySelectorAll([
        '[data-diag-copy]',
        '.gg-diag-copy',
        '.diagnostics-btn',
        '#diagnostics',
        'button[data-gg-diag]',
        'button.gg-diagnostics',
        'a.gg-diagnostics'
      ].join(',')));

      // Also capture generic buttons labelled "Diagnostics" that aren't ours
      const labelled = Array.from(document.querySelectorAll('button, a')).filter(el => {
        const txt = (el.textContent || "").trim().toLowerCase();
        if (!txt) return false;
        if (el.id === "gg-diag-btn") return false;
        return txt === "diagnostics" || txt === "open diagnostics";
      });

      const toRemove = new Set([...candidates, ...labelled]);
      // If preferred exists, remove all others
      if (preferred) {
        toRemove.forEach(el => {
          if (el !== preferred) {
            el.remove();
          }
        });
      } else {
        // No preferred button; keep the first found legacy button and remove others
        let keptOne = false;
        for (const el of toRemove) {
          if (!keptOne) { keptOne = true; continue; }
          el.remove();
        }
      }
    } catch (e) { log("suppress dup buttons failed", e); }
  };

  // 3) Ensure we never inject our own floating button if one already exists
  const guardInjection = () => {
    try {
      const preferred = document.getElementById("gg-diag-btn");
      // Some legacy scripts look for this flag to decide whether to add a button.
      window.__GG_DIAG_OPTS = Object.assign({}, window.__GG_DIAG_OPTS, {
        suppressButton: !!preferred,
        button: !!preferred ? "suppress" : (window.__GG_DIAG_OPTS && window.__GG_DIAG_OPTS.button) || "auto"
      });
    } catch (e) { /* no-op */ }
  };

  // 4) Expose a stable open() that reuses any existing panel if present
  const wireOpen = () => {
    try {
      const g = (window.__GG_DIAG = window.__GG_DIAG || {});
      if (typeof g.open === "function") return; // respect existing

      g.open = function () {
        // Prefer existing overlay if available
        try {
          const overlay = document.querySelector("#gg-diagnostics-overlay, .gg-diagnostics-overlay");
          if (overlay && overlay.style) {
            overlay.style.display = "block";
            overlay.removeAttribute("hidden");
            return;
          }
        } catch (_) {}

        // Fallback: minimal inline panel so the button always does something
        let panel = document.getElementById("gg-diag-fallback");
        if (!panel) {
          panel = document.createElement("div");
          panel.id = "gg-diag-fallback";
          panel.setAttribute("role", "dialog");
          panel.style.position = "fixed";
          panel.style.right = "12px";
          panel.style.bottom = "60px";
          panel.style.maxWidth = "420px";
          panel.style.maxHeight = "50vh";
          panel.style.overflow = "auto";
          panel.style.background = "#0b0b0c";
          panel.style.border = "1px solid #444";
          panel.style.borderRadius = "12px";
          panel.style.padding = "12px";
          panel.style.boxShadow = "0 4px 22px rgba(0,0,0,0.5)";
          panel.style.color = "#fff";
          panel.style.zIndex = "9999";
          panel.innerHTML = [
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">',
            '<strong style="font:600 14px system-ui">Diagnostics</strong>',
            '<button id="gg-diag-close" style="padding:6px 8px;border-radius:8px;border:1px solid #444;background:#161618;color:#fff">Close</button>',
            '</div>',
            '<pre id="gg-diag-log" style="white-space:pre-wrap;font:12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;margin:0"></pre>'
          ].join("");
          document.body.appendChild(panel);

          const closeBtn = document.getElementById("gg-diag-close");
          closeBtn && closeBtn.addEventListener("click", () => {
            panel.style.display = "none";
          });

          // Basic info dump
          const lines = [];
          lines.push("UA: " + (navigator.userAgent || ""));
          lines.push("PixelRatio: " + (window.devicePixelRatio || 1));
          lines.push("Viewport: " + window.innerWidth + "x" + window.innerHeight);
          lines.push("Time: " + new Date().toISOString());
          try {
            lines.push("Path: " + location.pathname + location.search);
          } catch (_) {}
          document.getElementById("gg-diag-log").textContent = lines.join("\n");
        } else {
          panel.style.display = "block";
        }
      };
    } catch (e) { /* no-op */ }
  };

  onReady(() => {
    removeDuplicateButtons();
    guardInjection();
    wireOpen();
  });
})();
