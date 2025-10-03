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

const catalogEntryPromise = resolveCatalogEntry(slug);

catalogEntryPromise
  .then(({ entry }) => {
    const helpPayload = buildHelpPayload(entry?.help);
    window.helpData = helpPayload;
    injectHelpButton({ gameId: slug, ...helpPayload });
  })
  .catch(() => {
    const helpPayload = buildHelpPayload(window.helpData);
    window.helpData = helpPayload;
    injectHelpButton({ gameId: slug, ...helpPayload });
  });

recordLastPlayed(slug);
preloadFirstFrameAssets(slug);

async function track(){
  let tags = [];
  try {
    const { tags: resolvedTags } = await catalogEntryPromise;
    tags = Array.isArray(resolvedTags) ? resolvedTags : [];
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

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toTrimmedList(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => toTrimmedString(item))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function getFallbackSteps() {
  const fallback = window.helpSteps;
  if (Array.isArray(fallback)) return toTrimmedList(fallback);
  if (typeof fallback === 'string') return toTrimmedList(fallback);
  return [];
}

function hasHelpContent(help) {
  if (!help) return false;
  return Boolean(
    (help.objective && help.objective.length) ||
    (help.controls && help.controls.length) ||
    (Array.isArray(help.tips) && help.tips.length) ||
    (Array.isArray(help.steps) && help.steps.length)
  );
}

function sanitizeHelpData(source, fallbackSteps = []) {
  const base = source && typeof source === 'object' ? source : {};
  const help = {
    objective: toTrimmedString(base.objective),
    controls: toTrimmedString(base.controls),
    tips: toTrimmedList(base.tips),
    steps: toTrimmedList(base.steps)
  };
  if (!help.steps.length && fallbackSteps.length) {
    help.steps = fallbackSteps.slice();
  }
  return help;
}

function buildHelpPayload(source) {
  const fallbackSteps = getFallbackSteps();
  const fromSource = sanitizeHelpData(source, fallbackSteps);
  if (hasHelpContent(fromSource)) {
    return fromSource;
  }
  const fromWindow = sanitizeHelpData(window.helpData, fallbackSteps);
  if (hasHelpContent(fromWindow)) {
    return fromWindow;
  }
  return sanitizeHelpData({}, fallbackSteps);
}

async function resolveCatalogEntry(id) {
  const urls = ['/games.json', '/public/games.json'];
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res?.ok) throw new Error(`bad status ${res?.status}`);
      const payload = await res.json();
      const games = Array.isArray(payload?.games) ? payload.games : (Array.isArray(payload) ? payload : []);
      const normalized = normalizeCatalogEntries(games);
      const normalizedMatch = normalized.find(g => g.slug === id || g.id === id);
      const rawMatch = normalizedMatch ? null : games.find(g => g?.slug === id || g?.id === id);
      const match = normalizedMatch || rawMatch || null;
      const tags = normalizedMatch
        ? (Array.isArray(normalizedMatch.tags) ? normalizedMatch.tags : [])
        : (Array.isArray(rawMatch?.tags) ? rawMatch.tags.filter(tag => typeof tag === 'string' && tag.trim()) : []);
      return { entry: match, tags };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('catalog unavailable');
}
