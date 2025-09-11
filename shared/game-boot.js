// shared/game-boot.js
// Usage in a game page: <script type="module" src="../../shared/game-boot.js" data-slug="runner"></script>
import { injectBackButton, injectHelpButton, recordLastPlayed } from './ui.js';
import { recordPlay } from './quests.js';
import { renderFallbackPanel } from './fallback.js';

const currentScript = document.currentScript;
const pathSegments = (new URL(location.href)).pathname.split('/').filter(Boolean);
if (pathSegments[pathSegments.length - 1] === 'index.html') pathSegments.pop();
const urlSlug = pathSegments.slice(-1)[0];
const slug = currentScript?.dataset?.slug || urlSlug || 'unknown';

injectBackButton('/');
injectHelpButton({ gameId: slug, steps: window.helpSteps || [] });
recordLastPlayed(slug);

async function track(){
  let tags = [];
  try {
    const res = await fetch('/games.json');
    const data = await res.json();
    const games = Array.isArray(data.games) ? data.games : (Array.isArray(data) ? data : []);
    const g = games.find(g => g.slug === slug);
    if (g) tags = g.tags || [];
  } catch {}
  recordPlay(slug, tags);
}

track();

function showFallback(e){
  const err = e?.error || e?.reason || e;
  if (!err) return;
  renderFallbackPanel(err, slug);
}

window.addEventListener('error', showFallback);
window.addEventListener('unhandledrejection', showFallback);
