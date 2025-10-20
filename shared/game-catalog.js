import { normalizeCatalogEntries, toNormalizedList } from './game-catalog-core.js';

const PRIMARY_CATALOG_URL = '/games.json';
const LEGACY_CATALOG_URLS = ['/public/games.json', './games.json'];
let catalogPromise = null;

async function fetchCatalogSource() {
  const urls = [PRIMARY_CATALOG_URL, ...LEGACY_CATALOG_URLS];
  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
      if (!response?.ok) throw new Error(`bad status: ${response?.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('games.json did not contain an array');
      return data;
    } catch (err) {
      lastError = err;
      console.warn('[GG] catalog fetch failed for', url, err);
    }
  }

  const err = lastError || new Error('failed to fetch catalog');
  console.warn('[GG] falling back to offline game catalog', err);
  const offline = await import('../data/games-offline.js');
  const fallback = offline?.games || offline?.default || [];
  return Array.isArray(fallback) ? fallback : [];
}

async function buildCatalog() {
  const sourceEntries = await fetchCatalogSource();
  const games = normalizeCatalogEntries(sourceEntries);
  const normalizedList = toNormalizedList(games);
  const byId = new Map();
  games.forEach(game => {
    byId.set(game.id, game);
    byId.set(game.id.toLowerCase(), game);
  });
  return { games, normalizedList, byId };
}

export async function loadGameCatalog() {
  if (!catalogPromise) {
    catalogPromise = buildCatalog().catch(err => {
      catalogPromise = null;
      throw err;
    });
  }
  return catalogPromise;
}

export async function getGameById(id) {
  if (!id) return null;
  const key = String(id).trim();
  if (!key) return null;
  const { byId } = await loadGameCatalog();
  return byId.get(key) || byId.get(key.toLowerCase()) || null;
}

export async function getNormalizedGames() {
  const { normalizedList } = await loadGameCatalog();
  return normalizedList;
}

export function resetGameCatalog() {
  catalogPromise = null;
}
