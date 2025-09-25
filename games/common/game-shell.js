const current = document.currentScript;
const dataset = current ? current.dataset : {};
const applyTheme = dataset.applyTheme !== 'false';
const slug = dataset.game || dataset.slug || '';
const diagSrc = dataset.diagSrc || '../common/diag-upgrades.js';

if (applyTheme) {
  document.body.classList.add('game-shell');
}

document.body.dataset.gameSlug = slug;

if (!document.querySelector('.game-shell__back')) {
  const backHost = document.createElement('div');
  backHost.className = 'game-shell__back';
  const anchor = document.createElement('a');
  anchor.className = 'game-shell__back-link';
  const baseParts = window.location.pathname.split('/games/');
  const base = (baseParts[0] || '/').replace(/\/+$/, '/');
  const target = dataset.backHref || `${base}index.html`;
  anchor.href = target;
  anchor.setAttribute('data-shell-back-link', '');
  anchor.setAttribute('aria-label', 'Back to games hub');
  anchor.innerHTML = '<span aria-hidden="true">⟵</span><span>Back</span>';
  backHost.append(anchor);
  document.body.prepend(backHost);

  if (!document.getElementById('game-shell-announcer')) {
    const announcer = document.createElement('div');
    announcer.id = 'game-shell-announcer';
    announcer.className = 'game-shell__sr-only';
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    document.body.prepend(announcer);

    let lastScoreAnnouncement = null;
    let shellPaused = false;
    const updateShellPauseState = (paused, detail) => {
      if (shellPaused === paused) return;
      shellPaused = paused;
      const eventName = paused ? 'ggshell:pause' : 'ggshell:resume';
      try {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
      } catch (_) {
        // Swallow errors dispatching custom events to avoid breaking games.
      }
    };
    const setAnnouncement = (message) => {
      if (!message) return;
      announcer.textContent = String(message);
    };
    const announceScore = (score) => {
      const numericScore = Number(score);
      if (Number.isNaN(numericScore)) return;
      if (numericScore === lastScoreAnnouncement) return;
      lastScoreAnnouncement = numericScore;
      setAnnouncement(`Score ${numericScore}`);
    };

    window.addEventListener('message', (event) => {
      const data = event && typeof event.data === 'object' ? event.data : null;
      if (!data || !data.type) return;
      if (data.type === 'GAME_PAUSE' || data.type === 'GG_PAUSE') {
        setAnnouncement('Game paused');
        updateShellPauseState(true, { source: 'message', payload: data });
      }
      if (data.type === 'GAME_RESUME' || data.type === 'GG_RESUME') {
        setAnnouncement('Game resumed');
        updateShellPauseState(false, { source: 'message', payload: data });
      }
      if (data.type === 'GAME_SCORE') {
        announceScore(data.score);
      }
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      setAnnouncement(document.hidden ? 'Game paused' : 'Game resumed');
      updateShellPauseState(document.hidden, { source: 'visibilitychange' });
    });

    window.addEventListener('ggshell:announce', (event) => {
      setAnnouncement(event?.detail);
    });

    window.addEventListener('ggshell:score', (event) => {
      announceScore(event?.detail);
    });

    window.GGShellAnnounce = setAnnouncement;
    window.GGShellAnnounceScore = announceScore;
  }
}

if (slug && !document.querySelector(`script[data-slug="${slug}"][data-shell-diag]`)) {
  const attach = () => {
    const diag = document.createElement('script');
    diag.src = diagSrc;
    diag.defer = true;
    diag.dataset.slug = slug;
    diag.dataset.shellDiag = 'true';
    diag.className = 'game-shell__diagnostics-anchor';
    document.head.append(diag);
  };
  if (document.readyState === 'complete') {
    setTimeout(attach, 0);
  } else {
    window.addEventListener('load', attach, { once: true });
  }
}

if (dataset.focusTarget) {
  const tryFocus = () => {
    const el = document.querySelector(dataset.focusTarget);
    if (el && typeof el.focus === 'function') {
      el.focus({ preventScroll: true });
    }
  };
  if (document.readyState === 'complete') {
    setTimeout(tryFocus, 0);
  } else {
    window.addEventListener('load', tryFocus, { once: true });
  }
}
