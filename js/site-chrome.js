// Shared nav + footer for every arcade page. Pages add <div data-chrome="nav"> and
// <div data-chrome="footer"> and import this module; links live in one place so a
// new page only has to be added to NAV below.
import { getState, PROGRESSION_EVENT } from '../shared/progression.js';
import '../shared/prefs.js'; // applies saved motion, contrast and text-size choices on every page

const NAV = [
  { href: 'index.html#games', label: 'Games', id: 'games' },
  { href: 'index.html#missions', label: 'Missions', id: 'missions' },
  { href: 'index.html#rules', label: 'About', id: 'about' },
  { href: 'trophies.html', label: 'Trophies', id: 'trophies' },
  { href: 'settings.html', label: 'Settings', id: 'settings' },
];

const MARK = `
<svg class="brand__mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect width="64" height="64" rx="14" fill="#e5339d"/>
  <circle cx="32" cy="32" r="19" fill="#ffd23f" stroke="#c99a00" stroke-width="4"/>
  <path d="M27 24h10v6h-6v4h6v6H27z" fill="#c99a00"/>
</svg>`;

function navMarkup(current) {
  const links = NAV.map(item => {
    const here = item.id === current ? ' aria-current="page"' : '';
    return `<a href="${item.href}"${here}>${item.label}</a>`;
  }).join('');
  return `
  <header class="chrome">
    <div class="wrap chrome__inner">
      <a class="brand" href="index.html" aria-label="Gurjot's Games home">${MARK}<span class="brand__name">Gurjot's Games</span></a>
      <nav class="chrome__nav" aria-label="Primary">
        ${links}
        <a class="level-chip" href="stats.html" aria-label="Your level" data-level-chip>
          <span class="level-chip__n" data-level-n>1</span>
          <span class="level-chip__bar" aria-hidden="true"><i data-level-bar></i></span>
        </a>
        <button type="button" class="bolt-profile-trigger" data-profile-trigger aria-haspopup="dialog" aria-expanded="false">
          <span class="sr-only">Open profile</span>
          <span data-profile-avatar aria-hidden="true"></span>
          <span data-profile-name>Guest</span>
        </button>
      </nav>
    </div>
  </header>`;
}

function footerMarkup() {
  return `
  <footer class="footer">
    <div class="wrap footer__inner">
      <p>&copy; ${new Date().getFullYear()} Gurjot's Games. Free to play, no ads.</p>
      <nav aria-label="Footer">
        <a href="docs/submit-game.md">Add a game</a>
        <a href="https://github.com/koonergurjot/Gurjots-Games">Source on GitHub</a>
        <a href="SECURITY.md">Security</a>
        <a href="sitemap.xml">Sitemap</a>
      </nav>
    </div>
  </footer>`;
}

function paintLevel() {
  try {
    const s = getState();
    document.querySelectorAll('[data-level-n]').forEach(n => { n.textContent = String(s.level); });
    document.querySelectorAll('[data-level-bar]').forEach(b => { b.style.width = `${Math.round(s.ratio * 100)}%`; });
    document.querySelectorAll('[data-level-chip]').forEach(c => {
      c.setAttribute('aria-label', `Level ${s.level}, ${s.remaining} XP to level ${s.level + 1}`);
    });
  } catch {
    /* progression is decoration here; never block the page */
  }
}

export function mountChrome(current = '') {
  const nav = document.querySelector('[data-chrome="nav"]');
  const foot = document.querySelector('[data-chrome="footer"]');
  if (nav) nav.outerHTML = navMarkup(current);
  if (foot) foot.outerHTML = footerMarkup();
  paintLevel();
  window.addEventListener(PROGRESSION_EVENT, paintLevel);
  window.addEventListener('storage', paintLevel);
  // The profile overlay binds to the trigger when it loads, so it must load after the nav exists.
  import('./profile-overlay.js').catch(err => console.warn('[chrome] profile overlay unavailable', err));
}
