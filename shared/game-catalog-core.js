import {
  basePathFromFullPath,
  buildIndexPath,
  derivePathsFromCandidate,
  normalizeBasePath,
  normalizePlayPath
} from './game-path-utils.js';

function sanitizeString(value) {
  if (value == null) return '';
  const str = String(value).trim();
  return str;
}

function sanitizeOptionalString(value) {
  const str = sanitizeString(value);
  return str ? str : null;
}

function sanitizeDateLike(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : value.toISOString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const ms = Math.abs(value) >= 1e12 ? value : Math.abs(value) >= 1e9 ? value * 1000 : Math.abs(value) >= 1e6 ? value * 1000 : null;
    if (ms == null) return null;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return sanitizeOptionalString(value);
}

function uniqueTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const result = [];
  for (const tag of tags) {
    const label = sanitizeString(tag);
    if (!label) continue;
    const lower = label.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(label);
  }
  return result;
}

function derivePaths(raw) {
  const playCandidate = raw?.playUrl || raw?.playURL || raw?.url || raw?.href || raw?.path || null;
  const entryCandidate = raw?.entry || null;

  const normalizedPlay = normalizePlayPath(playCandidate);
  let basePath = normalizedPlay ? basePathFromFullPath(normalizedPlay) : null;
  let playPath = normalizedPlay;

  if (!playPath || !basePath) {
    const entryPaths = derivePathsFromCandidate(entryCandidate);
    if (entryPaths) {
      basePath = basePath || entryPaths.basePath || null;
      playPath = playPath || entryPaths.playPath || null;
    }
  }

  if (!playPath && basePath) {
    playPath = buildIndexPath(basePath);
  }

  if (!basePath && playPath) {
    basePath = basePathFromFullPath(playPath);
  }

  if (!basePath && playCandidate) {
    basePath = normalizeBasePath(playCandidate);
  }

  return { basePath: basePath || null, playPath: playPath || null };
}

export function normalizeGameRecord(raw) {
  if (!raw) return null;
  const id = sanitizeString(raw.id || raw.slug);
  if (!id) return null;

  const title = sanitizeString(raw.title) || id;
  const short = sanitizeString(raw.short || raw.description || raw.desc);
  const description = sanitizeString(raw.description || raw.desc || raw.short);
  const tags = uniqueTags(raw.tags);
  const difficulty = sanitizeOptionalString(raw.difficulty);
  const releasedSource = raw.released ?? raw.releaseDate ?? raw.release_date ?? null;
  const released = sanitizeDateLike(releasedSource);
  const addedAtSource = raw.addedAt ?? raw.added_at ?? raw.dateAdded ?? raw.date_added ?? raw.createdAt ?? raw.created_at ?? raw.date ?? releasedSource ?? null;
  const addedAt = sanitizeDateLike(addedAtSource);

  const { basePath, playPath } = derivePaths(raw);

  const normalized = {
    ...raw,
    id,
    slug: id,
    title,
    short,
    description,
    tags,
    difficulty,
    released,
    addedAt,
    basePath,
    playPath,
    path: playPath || null,
    playUrl: raw?.playUrl || raw?.playURL || playPath || null,
    entry: raw?.entry || null
  };

  return normalized;
}

export function normalizeCatalogEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const normalized = [];
  for (const raw of entries) {
    const game = normalizeGameRecord(raw);
    if (game) normalized.push(game);
  }
  return normalized;
}

export function toNormalizedList(games) {
  if (!Array.isArray(games)) return [];
  return games.map(game => ({
    slug: game.id,
    title: game.title,
    path: game.playPath || buildIndexPath(game.basePath) || null
  }));
}
