// shared/game-boot.js
// Usage in a game page: <script type="module" src="../../shared/game-boot.js" data-slug="runner"></script>
import { injectBackButton, recordLastPlayed } from './ui.js';
import { recordPlay } from './quests.js';

const currentScript = document.currentScript;
const slug = currentScript?.dataset?.slug || (new URL(location.href)).pathname.split('/').filter(Boolean).slice(-1)[0] || 'unknown';

injectBackButton('/');
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
