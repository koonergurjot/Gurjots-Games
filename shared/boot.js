(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  if (window.__ggBootGuardInstalled) {
    return;
  }
  window.__ggBootGuardInstalled = true;

  const OVERLAY_ID = 'gg-boot-overlay';
  const OVERLAY_VISIBLE_CLASS = 'gg-boot-overlay--visible';
  const FIRST_FRAME_EVENT = 'gg-first-frame';
  const BOOT_TIMEOUT_MS = 1500;
  const ERROR_REVEAL_DELAY_MS = 250;
  let overlayTimer = null;
  let firstFrameSeen = false;
  let overlayRoot = null;
  let overlayTitleEl = null;
  let overlayMessageEl = null;
  let overlayDetailEl = null;
  let overlayActionBtn = null;
  let lastShownReason = '';
  let overlayMountRetry = null;

  function ensureStyles(){
    if (document.getElementById('gg-boot-style')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'gg-boot-style';
    style.type = 'text/css';
    const rules = `#${OVERLAY_ID}{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,0.85);color:#f8fafc;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;z-index:2147483645;opacity:0;pointer-events:none;transition:opacity 120ms ease-in-out;}#${OVERLAY_ID}.${OVERLAY_VISIBLE_CLASS}{opacity:1;pointer-events:auto;}`;
    style.appendChild(document.createTextNode(rules));
    document.head.appendChild(style);
  }

  function ensureOverlay(){
    if (overlayRoot) {
      return overlayRoot;
    }
    ensureStyles();
    const root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-live', 'assertive');
    root.setAttribute('aria-modal', 'true');
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.gap = '16px';
    root.style.maxWidth = '480px';
    root.style.margin = '0 auto';
    root.style.textAlign = 'center';
    root.style.borderRadius = '16px';
    root.style.background = 'rgba(15,23,42,0.88)';
    root.style.boxShadow = '0 30px 80px rgba(15,23,42,0.75)';
    root.style.padding = '28px 24px';

    const title = document.createElement('h2');
    title.textContent = 'Still loading…';
    title.style.margin = '0';
    title.style.fontSize = '22px';
    title.style.fontWeight = '600';

    const message = document.createElement('p');
    message.style.margin = '0';
    message.style.fontSize = '16px';
    message.style.lineHeight = '1.5';
    message.textContent = 'We\'re waiting for the game to show its first frame.';

    const detail = document.createElement('p');
    detail.style.margin = '0';
    detail.style.fontSize = '14px';
    detail.style.lineHeight = '1.45';
    detail.style.opacity = '0.8';
    detail.style.display = 'none';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.flexWrap = 'wrap';
    actions.style.justifyContent = 'center';
    actions.style.gap = '12px';

    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.textContent = 'Reload game';
    reloadBtn.style.background = '#38bdf8';
    reloadBtn.style.border = '0';
    reloadBtn.style.borderRadius = '999px';
    reloadBtn.style.padding = '10px 22px';
    reloadBtn.style.fontWeight = '600';
    reloadBtn.style.fontSize = '15px';
    reloadBtn.style.cursor = 'pointer';
    reloadBtn.style.color = '#0f172a';
    reloadBtn.addEventListener('click', () => {
      try {
        reloadBtn.disabled = true;
        window.location.reload();
      } catch (error) {
        console.error('[GG][boot] reload failed', error);
      }
    });

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.textContent = 'Back to menu';
    backBtn.style.background = 'transparent';
    backBtn.style.border = '1px solid rgba(148, 163, 184, 0.6)';
    backBtn.style.borderRadius = '999px';
    backBtn.style.padding = '10px 22px';
    backBtn.style.fontWeight = '600';
    backBtn.style.fontSize = '15px';
    backBtn.style.cursor = 'pointer';
    backBtn.style.color = '#e2e8f0';
    backBtn.addEventListener('click', () => {
      try {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = '../..';
        }
      } catch (error) {
        console.error('[GG][boot] navigation failed', error);
      }
    });

    actions.append(reloadBtn, backBtn);

    root.append(title, message, detail, actions);

    overlayRoot = root;
    overlayTitleEl = title;
    overlayMessageEl = message;
    overlayDetailEl = detail;
    overlayActionBtn = reloadBtn;

    return root;
  }

  function mountOverlay(){
    if (!overlayRoot) {
      ensureOverlay();
    }
    if (overlayRoot?.parentNode) {
      return;
    }
    const host = document.body || document.documentElement;
    if (host) {
      host.appendChild(overlayRoot);
      if (overlayMountRetry) {
        window.clearTimeout(overlayMountRetry);
        overlayMountRetry = null;
      }
      return;
    }
    if (overlayMountRetry !== null) {
      return;
    }
    const attemptMount = () => {
      const nextHost = document.body || document.documentElement;
      if (!nextHost) {
        overlayMountRetry = window.setTimeout(attemptMount, 16);
        return;
      }
      overlayMountRetry = null;
      nextHost.appendChild(overlayRoot);
    };
    overlayMountRetry = window.setTimeout(attemptMount, 0);
  }

  function showOverlay(reason = 'loading', detail){
    if (firstFrameSeen) {
      return;
    }
    lastShownReason = reason;
    mountOverlay();
    if (!overlayRoot) {
      return;
    }
    overlayRoot.classList.add(OVERLAY_VISIBLE_CLASS);
    overlayRoot.setAttribute('data-state', reason);
    overlayRoot.style.opacity = '1';
    if (overlayTitleEl && overlayMessageEl) {
      if (reason === 'error') {
        overlayTitleEl.textContent = 'We hit a snag';
        overlayMessageEl.textContent = 'Something prevented the game from starting.';
      } else if (reason === 'hidden') {
        overlayTitleEl.textContent = 'Game is hidden';
        overlayMessageEl.textContent = 'The game surface is not visible yet. Check any browser prompts or overlays.';
      } else if (reason === 'timeout') {
        overlayTitleEl.textContent = 'Taking longer than expected';
        overlayMessageEl.textContent = 'The game is still booting. You can wait a bit longer or retry.';
      } else {
        overlayTitleEl.textContent = 'Still loading…';
        overlayMessageEl.textContent = 'We\'re waiting for the game to show its first frame.';
      }
    }
    if (typeof detail === 'string' && detail.trim()) {
      overlayDetailEl.textContent = detail.trim();
      overlayDetailEl.style.display = '';
    } else if (lastShownReason === 'loading') {
      overlayDetailEl.textContent = 'If nothing happens after a few seconds, try reloading or returning to the menu.';
      overlayDetailEl.style.display = '';
    } else {
      overlayDetailEl.textContent = '';
      overlayDetailEl.style.display = 'none';
    }
    if (overlayActionBtn) {
      overlayActionBtn.disabled = false;
    }
  }

  function hideOverlay(){
    if (!overlayRoot) {
      return;
    }
    overlayRoot.classList.remove(OVERLAY_VISIBLE_CLASS);
    overlayRoot.style.opacity = '0';
    overlayRoot.setAttribute('data-state', 'hidden');
  }

  function cancelTimer(){
    if (overlayTimer) {
      window.clearTimeout(overlayTimer);
      overlayTimer = null;
    }
  }

  function markFirstFrame(){
    if (firstFrameSeen) {
      return;
    }
    firstFrameSeen = true;
    cancelTimer();
    hideOverlay();
    window.dispatchEvent(new CustomEvent(FIRST_FRAME_EVENT));
  }

  function scheduleOverlay(){
    cancelTimer();
    overlayTimer = window.setTimeout(() => {
      if (!firstFrameSeen) {
        evaluateSceneBeforeShowing();
      }
    }, BOOT_TIMEOUT_MS);
  }

  function evaluateSceneBeforeShowing(){
    try {
      const surface = document.querySelector('.game-shell__surface');
      const canvas = surface?.querySelector('canvas, video, svg');
      const root = canvas || surface || document.querySelector('canvas, #app');
      if (!root) {
        showOverlay('loading');
        return;
      }
      const rect = root.getBoundingClientRect();
      const hidden = rect.width <= 2 || rect.height <= 2;
      const visibility = window.getComputedStyle(root);
      const invisible = visibility?.visibility === 'hidden' || visibility?.display === 'none' || visibility?.opacity === '0';
      if (hidden || invisible) {
        showOverlay('hidden');
        return;
      }
      // If we reached here, assume something is rendering but maybe not painting; keep monitoring.
      overlayTimer = window.setTimeout(() => {
        if (!firstFrameSeen) {
          showOverlay('timeout');
        }
      }, ERROR_REVEAL_DELAY_MS);
    } catch (error) {
      console.error('[GG][boot] unable to evaluate render state', error);
      showOverlay('error', error?.message);
    }
  }

  function setupErrorHandlers(){
    window.addEventListener('error', (event) => {
      if (firstFrameSeen) {
        return;
      }
      const detail = event?.message || event?.error?.message || 'Unexpected error before first frame.';
      showOverlay('error', detail);
    });
    window.addEventListener('unhandledrejection', (event) => {
      if (firstFrameSeen) {
        return;
      }
      const reason = event?.reason;
      const detail = typeof reason === 'string' ? reason : reason?.message || 'Unhandled promise rejection.';
      showOverlay('error', detail);
    });
  }

  function setupVisibilityReset(){
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !firstFrameSeen && lastShownReason === 'loading') {
        scheduleOverlay();
      }
    });
  }

  function bootstrap(){
    setupErrorHandlers();
    setupVisibilityReset();
    scheduleOverlay();
  }

  function ready(callback){
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => callback(), { once: true });
    } else {
      callback();
    }
  }

  ready(() => {
    ensureOverlay();
    bootstrap();
  });

  window.ggBoot = Object.freeze({
    showOverlay,
    hideOverlay,
    markFirstFrame,
    reset: () => {
      firstFrameSeen = false;
      scheduleOverlay();
    },
  });

  window.ggFirstFrame = function ggFirstFrame(){
    markFirstFrame();
  };
})();
