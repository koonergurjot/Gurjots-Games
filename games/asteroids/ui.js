const SHOP_ITEMS = [
  {
    id: 'shield',
    title: 'Shield Boost',
    subtitle: '+1 life',
    description: 'Gain an extra shield immediately to absorb the next hit.',
  },
  {
    id: 'speed',
    title: 'Engine Tune',
    subtitle: '+40 top speed',
    description: 'Improve ship thrust and max speed for upcoming waves.',
  },
  {
    id: 'accuracy',
    title: 'Targeting Suite',
    subtitle: 'Faster fire rate',
    description: 'Reduce primary weapon cooldown to stay on target.',
  },
];

function formatAccuracy({ accuracy, shotsFired, shotsHit }) {
  if (!shotsFired) return 'No shots fired yet';
  const safeAccuracy = Number.isFinite(accuracy) ? accuracy : 0;
  const rounded = Math.round(safeAccuracy * 10) / 10;
  const label = Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
  return `${label} • ${shotsHit}/${shotsFired}`;
}

export function createShopUi({ host, onPurchase, onSkip } = {}) {
  if (typeof document === 'undefined') {
    return {
      root: null,
      show() {
        if (typeof onSkip === 'function') onSkip();
      },
      hide() {},
    };
  }

  const surface = host || document.querySelector('.game-shell__surface') || document.body;
  const overlay = document.createElement('div');
  overlay.className = 'asteroids-shop';
  overlay.setAttribute('hidden', '');
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '24px';
  overlay.style.background = 'rgba(15, 23, 42, 0.82)';
  overlay.style.backdropFilter = 'blur(8px)';
  overlay.style.zIndex = '40';
  overlay.style.pointerEvents = 'auto';

  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.style.width = 'min(680px, 100%)';
  panel.style.background = 'rgba(2, 6, 23, 0.92)';
  panel.style.border = '1px solid rgba(148, 163, 184, 0.2)';
  panel.style.borderRadius = '18px';
  panel.style.padding = '28px';
  panel.style.boxShadow = '0 24px 60px rgba(2, 6, 23, 0.6)';
  panel.style.color = '#e2e8f0';
  panel.style.fontFamily = '"Inter", "Segoe UI", system-ui, sans-serif';

  const title = document.createElement('h2');
  title.textContent = 'Supply Drop';
  title.style.margin = '0 0 8px';
  title.style.fontSize = '28px';
  title.style.fontWeight = '700';

  const subtitle = document.createElement('p');
  subtitle.style.margin = '0 0 16px';
  subtitle.style.opacity = '0.85';
  subtitle.style.fontSize = '15px';

  const cards = document.createElement('div');
  cards.style.display = 'grid';
  cards.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
  cards.style.gap = '16px';
  cards.style.marginBottom = '20px';

  const buttons = [];
  SHOP_ITEMS.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.itemId = item.id;
    button.style.display = 'flex';
    button.style.flexDirection = 'column';
    button.style.alignItems = 'flex-start';
    button.style.gap = '6px';
    button.style.padding = '18px';
    button.style.background = 'rgba(15, 23, 42, 0.75)';
    button.style.border = '1px solid rgba(148, 163, 184, 0.25)';
    button.style.borderRadius = '14px';
    button.style.color = 'inherit';
    button.style.cursor = 'pointer';
    button.style.transition = 'transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease';
    button.style.textAlign = 'left';

    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-2px)';
      button.style.borderColor = 'rgba(94, 234, 212, 0.65)';
      button.style.boxShadow = '0 12px 32px rgba(13, 148, 136, 0.25)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translateY(0)';
      button.style.borderColor = 'rgba(148, 163, 184, 0.25)';
      button.style.boxShadow = 'none';
    });

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.flexDirection = 'column';
    header.style.gap = '2px';

    const label = document.createElement('span');
    label.textContent = item.title;
    label.style.fontSize = '17px';
    label.style.fontWeight = '600';

    const sub = document.createElement('span');
    sub.textContent = item.subtitle;
    sub.style.fontSize = '13px';
    sub.style.opacity = '0.75';
    header.append(label, sub);

    const desc = document.createElement('p');
    desc.textContent = item.description;
    desc.style.margin = '8px 0 0';
    desc.style.fontSize = '13px';
    desc.style.lineHeight = '1.5';
    desc.style.opacity = '0.85';

    button.append(header, desc);
    button.addEventListener('click', () => {
      if (typeof onPurchase === 'function') {
        onPurchase(item.id);
      }
    });
    cards.appendChild(button);
    buttons.push(button);
  });

  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  footer.style.alignItems = 'center';
  footer.style.gap = '12px';

  const tip = document.createElement('span');
  tip.style.fontSize = '13px';
  tip.style.opacity = '0.75';
  tip.textContent = 'Perks last for the current run only.';

  const skipButton = document.createElement('button');
  skipButton.type = 'button';
  skipButton.textContent = 'Skip';
  skipButton.style.padding = '10px 18px';
  skipButton.style.borderRadius = '999px';
  skipButton.style.border = '1px solid rgba(148, 163, 184, 0.4)';
  skipButton.style.background = 'rgba(15, 23, 42, 0.6)';
  skipButton.style.color = 'inherit';
  skipButton.style.cursor = 'pointer';
  skipButton.addEventListener('mouseenter', () => {
    skipButton.style.borderColor = 'rgba(94, 234, 212, 0.6)';
  });
  skipButton.addEventListener('mouseleave', () => {
    skipButton.style.borderColor = 'rgba(148, 163, 184, 0.4)';
  });
  skipButton.addEventListener('click', () => {
    if (typeof onSkip === 'function') onSkip();
  });

  footer.append(tip, skipButton);

  panel.append(title, subtitle, cards, footer);
  overlay.append(panel);
  surface.append(overlay);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay && typeof onSkip === 'function') {
      onSkip();
    }
  });

  function show(context = {}) {
    const summary = formatAccuracy({
      accuracy: context.accuracy,
      shotsFired: context.shotsFired,
      shotsHit: context.shotsHit,
    });
    const waveLabel = context.wave ? `Wave ${context.wave}` : 'Next wave';
    subtitle.textContent = `${waveLabel} prep • ${summary}`;
    overlay.removeAttribute('hidden');
    requestAnimationFrame(() => {
      (buttons[0] || skipButton).focus({ preventScroll: true });
    });
  }

  function hide() {
    overlay.setAttribute('hidden', '');
    if (overlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  return {
    root: overlay,
    show,
    hide,
  };
}

export default createShopUi;
