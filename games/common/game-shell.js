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
  document.body.append(backHost);
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
