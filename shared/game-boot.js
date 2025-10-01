// shared/game-boot.js
// Usage in a game page: <script type="module" src="../../shared/game-boot.js" data-slug="runner"></script>
import { injectBackButton, injectHelpButton, recordLastPlayed } from './ui.js';
import { recordPlay } from './quests.js';
import { normalizeCatalogEntries } from './game-catalog-core.js';
import { renderFallbackPanel } from './fallback.js';
import { preloadFirstFrameAssets } from './game-asset-preloader.js';

const currentScript = document.currentScript;
const pathSegments = (new URL(location.href)).pathname.split('/').filter(Boolean);
if (pathSegments[pathSegments.length - 1] === 'index.html') pathSegments.pop();
const urlSlug = pathSegments.slice(-1)[0];
const slug = currentScript?.dataset?.slug || urlSlug || 'unknown';

injectBackButton('/');
injectHelpButton({ gameId: slug, ...(window.helpData || { steps: window.helpSteps || [] }) });
recordLastPlayed(slug);
preloadFirstFrameAssets(slug);

async function track(){
  let tags = [];
  try {
    const urls = ['/games.json', '/public/games.json'];
    let data = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res?.ok) throw new Error(`bad status ${res?.status}`);
        data = await res.json();
        break;
      } catch (_) {
        data = null;
      }
    }
    if (!data) throw new Error('catalog unavailable');
    const games = Array.isArray(data.games) ? data.games : (Array.isArray(data) ? data : []);
    const normalized = normalizeCatalogEntries(games);
    const normalizedMatch = normalized.find(g => g.slug === slug || g.id === slug);
    const rawMatch = normalizedMatch ? null : games.find(g => g?.slug === slug || g?.id === slug);
    const match = normalizedMatch || rawMatch;
    if (match) {
      const sourceTags = normalizedMatch ? normalizedMatch.tags : match.tags;
      tags = Array.isArray(sourceTags) ? sourceTags : [];
    }
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
