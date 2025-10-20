const PAUSE_SELECTORS = [
  '[data-shell-pause-overlay]',
  '.pause-overlay',
  '#gg-pause-overlay',
  '.gg-overlay.gg-pause',
  '.modal-paused',
  '#hud .paused',
  '.hud-paused'
];

function isVisible(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.hasAttribute && node.hasAttribute('hidden')) return false;
  if (typeof node.getAttribute === 'function' && node.getAttribute('aria-hidden') === 'true') return false;
  const isElement = typeof HTMLElement !== 'undefined' && node instanceof HTMLElement;
  const style = typeof window !== 'undefined' && isElement && typeof window.getComputedStyle === 'function'
    ? window.getComputedStyle(node)
    : null;
  if (style && (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0)) {
    return false;
  }
  if (typeof node.getClientRects === 'function') {
    const rects = node.getClientRects();
    if (!rects.length || (rects[0].width === 0 && rects[0].height === 0)) {
      return false;
    }
  }
  return true;
}

function getFocusable(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const candidates = Array.from(root.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  ));
  return candidates.filter((node) => {
    if (node.disabled) return false;
    if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return false;
    return isVisible(node);
  });
}

function trapFocus(root) {
  const focusable = getFocusable(root);
  if (!focusable.length) {
    if (typeof root.setAttribute === 'function') {
      root.setAttribute('tabindex', '-1');
    }
    return {
      release() {},
      focus() {
        if (typeof root.focus === 'function') root.focus({ preventScroll: true });
      }
    };
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const handleKeydown = (event) => {
    if (event.key !== 'Tab') return;
    if (focusable.length === 1) {
      event.preventDefault();
      first.focus({ preventScroll: true });
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };
  root.addEventListener('keydown', handleKeydown);
  return {
    release() {
      root.removeEventListener('keydown', handleKeydown);
    },
    focus() {
      const active = document.activeElement;
      if (active && typeof active.blur === 'function') {
        try { active.blur(); } catch (_) {}
      }
      first.focus({ preventScroll: true });
    }
  };
}

function ensureAnnouncer() {
  if (typeof document === 'undefined') return null;
  let announcer = document.getElementById('ggshell-pause-announcer');
  if (!announcer) {
    announcer = document.createElement('div');
    announcer.id = 'ggshell-pause-announcer';
    announcer.className = 'game-shell__sr-only';
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    document.body.prepend(announcer);
  }
  return announcer;
}

function announce(message) {
  if (!message) return;
  if (typeof window !== 'undefined' && typeof window.GGShellAnnounce === 'function') {
    window.GGShellAnnounce(message);
    return;
  }
  const announcer = ensureAnnouncer();
  if (announcer) announcer.textContent = String(message);
}

function createFallbackOverlay() {
  if (typeof document === 'undefined') return null;
  let existing = document.querySelector('[data-shell-pause-overlay]');
  if (existing) return existing;
  const overlay = document.createElement('div');
  overlay.className = 'game-shell__pause';
  overlay.dataset.shellPauseOverlay = 'true';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="game-shell__pause-panel" role="document">
      <h2 class="game-shell__pause-title">Paused</h2>
      <p class="game-shell__pause-hint">Focus returned to the game tab. Press resume or the game pause key.</p>
      <div class="game-shell__pause-actions">
        <button type="button" class="game-shell__pause-resume">Resume</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function findOverlay() {
  if (typeof document === 'undefined') return null;
  for (const selector of PAUSE_SELECTORS) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (isVisible(node)) {
        return node;
      }
    }
  }
  return null;
}

export function installPauseManager({ slug } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  let currentOverlay = null;
  let activeTrap = null;
  let lastFocused = null;
  let fallbackOverlay = null;
  let resumeHandler = null;

  const hideOverlay = () => {
    if (!currentOverlay) return;
    const hasClassList = !!currentOverlay.classList;
    if (hasClassList && currentOverlay.classList.contains('game-shell__pause')) {
      currentOverlay.classList.remove('is-active');
      currentOverlay.setAttribute('aria-hidden', 'true');
    }
    if (currentOverlay === fallbackOverlay) {
      currentOverlay.style.display = 'none';
      if (resumeHandler) {
        const resume = currentOverlay.querySelector('.game-shell__pause-resume');
        resume?.removeEventListener('click', resumeHandler);
        resumeHandler = null;
      }
    }
    if (activeTrap) {
      activeTrap.release();
      activeTrap = null;
    }
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus({ preventScroll: true }); } catch (_) {}
    }
    currentOverlay = null;
  };

  const showOverlay = () => {
    announce('Paused');
    let overlay = findOverlay();
    if (!overlay) {
      fallbackOverlay = fallbackOverlay || createFallbackOverlay();
      overlay = fallbackOverlay;
    }
    currentOverlay = overlay;
    if (!overlay) return;
    if (overlay === fallbackOverlay) {
      overlay.style.display = 'grid';
      overlay.removeAttribute('aria-hidden');
      if (overlay.classList) overlay.classList.add('is-active');
      const resume = overlay.querySelector('.game-shell__pause-resume');
      if (resume && resumeHandler) {
        resume.removeEventListener('click', resumeHandler);
      }
      resumeHandler = () => {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('ggshell:resume', { detail: { source: 'fallback-overlay', slug } }));
        }
        resumeHandler = null;
      };
      resume?.addEventListener('click', resumeHandler, { once: true });
    }
    if (overlay && typeof overlay.setAttribute === 'function') {
      overlay.setAttribute('aria-modal', 'true');
    }
    const focusTrap = trapFocus(overlay);
    activeTrap = focusTrap;
    const schedule = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (fn) => setTimeout(fn, 0);
    schedule(() => {
      focusTrap.focus();
    });
  };

  const handlePause = (event) => {
    if (currentOverlay && activeTrap) {
      activeTrap.focus();
      announce('Paused');
      return;
    }
    if (!currentOverlay) {
      const active = document.activeElement;
      const isElement = typeof HTMLElement !== 'undefined' && active instanceof HTMLElement;
      lastFocused = isElement ? active : null;
    }
    showOverlay();
  };

  const handleResume = () => {
    hideOverlay();
    announce('Resumed');
  };

  const visibilityHandler = () => {
    if (document.hidden) {
      handlePause({ detail: { source: 'visibilitychange' } });
    }
  };

  window.addEventListener('ggshell:pause', handlePause);
  window.addEventListener('ggshell:resume', handleResume);
  document.addEventListener('visibilitychange', visibilityHandler);

  return () => {
    window.removeEventListener('ggshell:pause', handlePause);
    window.removeEventListener('ggshell:resume', handleResume);
    document.removeEventListener('visibilitychange', visibilityHandler);
    if (fallbackOverlay) {
      fallbackOverlay.remove();
      fallbackOverlay = null;
    }
  };
}

export default { installPauseManager };
