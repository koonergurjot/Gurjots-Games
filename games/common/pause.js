const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

let idCounter = 0;
const createId = (prefix = 'game-pause') => {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
};

const isHTMLElement = (node) => {
  if (typeof HTMLElement === 'undefined') return false;
  return node instanceof HTMLElement;
};

const isVisible = (node) => {
  if (!node || typeof node !== 'object') return false;
  if (node.hasAttribute?.('hidden')) return false;
  if (node.getAttribute?.('aria-hidden') === 'true') return false;
  const ownerDocument = node.ownerDocument || document;
  const win = ownerDocument.defaultView || window;
  if (isHTMLElement(node) && typeof win?.getComputedStyle === 'function') {
    const style = win.getComputedStyle(node);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
  }
  if (typeof node.getClientRects === 'function') {
    const rects = node.getClientRects();
    if (!rects?.length) return false;
    const rect = rects[0];
    if (rect.width === 0 && rect.height === 0) return false;
  }
  return true;
};

const getFocusable = (root) => {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const nodes = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR));
  return nodes.filter((node) => {
    if (node.disabled) return false;
    if (node.getAttribute?.('aria-hidden') === 'true') return false;
    return isVisible(node);
  });
};

const createFocusTrap = (root) => {
  const focusable = getFocusable(root);
  const doc = root?.ownerDocument || document;
  const schedule = doc?.defaultView?.requestAnimationFrame
    ? doc.defaultView.requestAnimationFrame.bind(doc.defaultView)
    : (fn) => setTimeout(fn, 0);

  const focus = () => {
    if (!focusable.length) {
      if (typeof root.focus === 'function') {
        schedule(() => {
          try { root.focus({ preventScroll: true }); } catch (_) {}
        });
      }
      return;
    }
    const first = focusable[0];
    schedule(() => {
      try { first.focus({ preventScroll: true }); } catch (_) {}
    });
  };

  const handleKeydown = (event) => {
    if (event.key !== 'Tab') return;
    if (!focusable.length) {
      event.preventDefault();
      focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = doc.activeElement;
    if (event.shiftKey) {
      if (active === first || !focusable.includes(active)) {
        event.preventDefault();
        try { last.focus({ preventScroll: true }); } catch (_) {}
      }
    } else if (active === last || !focusable.includes(active)) {
      event.preventDefault();
      try { first.focus({ preventScroll: true }); } catch (_) {}
    }
  };

  root.addEventListener('keydown', handleKeydown);

  return {
    focus,
    release() {
      root.removeEventListener('keydown', handleKeydown);
    },
  };
};

const ensureAnnouncer = (root) => {
  const doc = root?.ownerDocument || document;
  let announcer = root?.querySelector('[data-pause-announcer]');
  if (!announcer && doc) {
    announcer = doc.createElement('div');
    announcer.dataset.pauseAnnouncer = 'true';
    announcer.className = 'game-shell__sr-only';
    announcer.setAttribute('aria-live', 'assertive');
    announcer.setAttribute('aria-atomic', 'true');
    root?.appendChild(announcer);
  }
  return announcer;
};

const ensureStructure = (root) => {
  const doc = root?.ownerDocument || document;
  if (!doc) return {};

  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-hidden', 'true');
  if (isHTMLElement(root) && typeof root.focus !== 'function') {
    root.setAttribute('tabindex', '-1');
  }

  let panel = root.querySelector('[data-pause-panel]');
  if (!panel) {
    panel = doc.createElement('div');
    panel.className = 'game-shell__pause-panel';
    panel.setAttribute('role', 'document');
    panel.dataset.pausePanel = 'true';
    root.appendChild(panel);
  }

  let heading = panel.querySelector('[data-pause-title]');
  if (!heading) {
    heading = doc.createElement('h2');
    heading.className = 'game-shell__pause-title';
    heading.dataset.pauseTitle = 'true';
    heading.textContent = 'Paused';
    panel.insertBefore(heading, panel.firstChild);
  } else if (!heading.textContent?.trim()) {
    heading.textContent = 'Paused';
  }

  if (!heading.id) heading.id = createId('game-pause-title');
  root.setAttribute('aria-labelledby', heading.id);

  let message = panel.querySelector('[data-pause-message]');
  if (!message) {
    message = doc.createElement('p');
    message.className = 'game-shell__pause-hint';
    message.dataset.pauseMessage = 'true';
    message.textContent = 'Focus returned to the game tab. Press resume or the game pause key.';
    panel.appendChild(message);
  } else if (!message.textContent?.trim()) {
    message.textContent = 'Focus returned to the game tab. Press resume or the game pause key.';
  }

  let actions = panel.querySelector('[data-pause-actions]');
  if (!actions) {
    actions = doc.createElement('div');
    actions.className = 'game-shell__pause-actions';
    actions.dataset.pauseActions = 'true';
    panel.appendChild(actions);
  }

  const ensureButton = (selector, { text, className, dataAttr, idPrefix }) => {
    let button = panel.querySelector(selector);
    if (!button) {
      button = doc.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.className = className;
      button.dataset[dataAttr] = 'true';
      if (idPrefix) button.id = createId(idPrefix);
      actions.appendChild(button);
    } else {
      button.type = 'button';
      button.dataset[dataAttr] = button.dataset[dataAttr] || 'true';
      if (!button.classList.contains(className)) {
        button.className = `${button.className} ${className}`.trim();
      }
    }
    return button;
  };

  const resumeButton = ensureButton('[data-pause-resume]', {
    text: 'Resume',
    className: 'game-shell__pause-button game-shell__pause-resume',
    dataAttr: 'pauseResume',
    idPrefix: 'game-pause-resume',
  });

  const restartButton = ensureButton('[data-pause-restart]', {
    text: 'Restart',
    className: 'game-shell__pause-button game-shell__pause-button--secondary',
    dataAttr: 'pauseRestart',
    idPrefix: 'game-pause-restart',
  });

  const exitButton = ensureButton('[data-pause-exit]', {
    text: 'Exit',
    className: 'game-shell__pause-button game-shell__pause-button--secondary',
    dataAttr: 'pauseExit',
    idPrefix: 'game-pause-exit',
  });

  return { panel, heading, message, actions, resumeButton, restartButton, exitButton };
};

const normalizeDetail = (detail = {}, fallbackSource) => {
  if (!detail || typeof detail !== 'object') {
    return fallbackSource ? { source: fallbackSource } : {};
  }
  const normalized = { ...detail };
  if (!normalized.source && fallbackSource) normalized.source = fallbackSource;
  return normalized;
};

export function mountPause(root, options = {}) {
  if (!root) throw new Error('mountPause(root, options) requires a root element.');
  const doc = root.ownerDocument || document;
  const win = doc.defaultView || window;
  const config = { ...options };

  if (root.classList && !root.classList.contains('game-shell__pause')) {
    root.classList.add('game-shell__pause');
  }

  const structure = ensureStructure(root);
  const announcer = ensureAnnouncer(root);

  const resumeButton = structure.resumeButton;
  const restartButton = structure.restartButton;
  const exitButton = structure.exitButton;

  const updateActionVisibility = () => {
    if (restartButton) restartButton.hidden = typeof config.onRestart !== 'function';
    if (exitButton) exitButton.hidden = typeof config.onExit !== 'function';
  };
  updateActionVisibility();

  let isOpen = false;
  let lastFocused = null;
  let trap = null;

  const announcePaused = () => {
    if (announcer) announcer.textContent = 'Paused';
  };

  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      resume('escape-key');
    }
  };

  const show = (detail = {}) => {
    const normalizedDetail = normalizeDetail(detail, 'auto');
    if (isOpen) {
      announcePaused();
      if (trap) trap.focus();
      return false;
    }
    isOpen = true;
    const active = doc.activeElement;
    lastFocused = isHTMLElement(active) ? active : null;
    root.classList.add('is-active');
    root.removeAttribute('aria-hidden');
    trap = createFocusTrap(structure.panel || root);
    const schedule = typeof win?.requestAnimationFrame === 'function'
      ? win.requestAnimationFrame.bind(win)
      : (fn) => setTimeout(fn, 0);
    schedule(() => trap?.focus());
    announcePaused();
    doc.addEventListener('keydown', handleEscape);
    if (typeof config.onPause === 'function') {
      config.onPause(normalizedDetail);
    }
    root.dispatchEvent(new CustomEvent('pauseopen', { detail: normalizedDetail }));
    return true;
  };

  const hide = (detail = {}) => {
    if (!isOpen) return false;
    isOpen = false;
    root.classList.remove('is-active');
    root.setAttribute('aria-hidden', 'true');
    doc.removeEventListener('keydown', handleEscape);
    trap?.release();
    trap = null;
    if (lastFocused && doc.contains(lastFocused)) {
      try { lastFocused.focus({ preventScroll: true }); } catch (_) {}
    }
    lastFocused = null;
    root.dispatchEvent(new CustomEvent('pauseclose', { detail: normalizeDetail(detail, 'close') }));
    return true;
  };

  const resume = (source, detail = {}) => {
    const normalizedDetail = normalizeDetail({ ...detail, source }, source || 'resume');
    const closed = hide(normalizedDetail);
    if (closed && typeof config.onResume === 'function') {
      config.onResume(normalizedDetail);
    }
    root.dispatchEvent(new CustomEvent('pauseresume', { detail: normalizedDetail }));
    return closed;
  };

  const restart = (source, detail = {}) => {
    const normalizedDetail = normalizeDetail({ ...detail, source }, source || 'restart');
    hide(normalizedDetail);
    if (typeof config.onRestart === 'function') {
      config.onRestart(normalizedDetail);
    }
    root.dispatchEvent(new CustomEvent('pauserestart', { detail: normalizedDetail }));
  };

  const exit = (source, detail = {}) => {
    const normalizedDetail = normalizeDetail({ ...detail, source }, source || 'exit');
    hide(normalizedDetail);
    if (typeof config.onExit === 'function') {
      config.onExit(normalizedDetail);
    }
    root.dispatchEvent(new CustomEvent('pauseexit', { detail: normalizedDetail }));
  };

  const onResumeClick = () => resume('resume-button');
  const onRestartClick = () => restart('restart-button');
  const onExitClick = () => exit('exit-button');

  resumeButton?.addEventListener('click', onResumeClick);
  restartButton?.addEventListener('click', onRestartClick);
  exitButton?.addEventListener('click', onExitClick);

  const handleVisibility = () => {
    if (doc.hidden) {
      show({ source: 'visibilitychange', reason: 'visibilitychange' });
    }
  };
  doc.addEventListener('visibilitychange', handleVisibility, { passive: true });

  return {
    show,
    hide,
    resume: (detail) => resume('api', detail),
    restart: (detail) => restart('api', detail),
    exit: (detail) => exit('api', detail),
    isOpen: () => isOpen,
    update(optionsPatch = {}) {
      Object.assign(config, optionsPatch);
      updateActionVisibility();
    },
    destroy() {
      doc.removeEventListener('keydown', handleEscape);
      doc.removeEventListener('visibilitychange', handleVisibility);
      resumeButton?.removeEventListener('click', onResumeClick);
      restartButton?.removeEventListener('click', onRestartClick);
      exitButton?.removeEventListener('click', onExitClick);
      trap?.release();
      trap = null;
    },
    elements: {
      root,
      panel: structure.panel,
      heading: structure.heading,
      message: structure.message,
      actions: structure.actions,
      resumeButton,
      restartButton,
      exitButton,
      announcer,
    },
  };
}

export default mountPause;
