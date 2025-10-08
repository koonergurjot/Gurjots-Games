import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import process from 'process';
import { fileURLToPath, pathToFileURL } from 'url';
import Ajv from 'ajv';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HEALTH_DIR = path.join(ROOT, 'health');
const REPORT_JSON = path.join(HEALTH_DIR, 'report.json');
const REPORT_MD = path.join(HEALTH_DIR, 'report.md');
const DEFAULT_BASELINE = path.join(HEALTH_DIR, 'baseline.json');
const PLACEHOLDER_THUMB = 'assets/placeholder-thumb.png';
const THUMB_EXTENSIONS = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'svg'];

const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
};

const ISSUE_SEVERITY_LEVEL = {
  BLOCKER: 'blocker',
  MAJOR: 'major',
  MINOR: 'minor',
  INFO: 'info',
};

const ISSUE_SEVERITY_LABELS = {
  [ISSUE_SEVERITY_LEVEL.BLOCKER]: '🚨 Blockers',
  [ISSUE_SEVERITY_LEVEL.MAJOR]: 'Major issues',
  [ISSUE_SEVERITY_LEVEL.MINOR]: 'Minor issues',
  [ISSUE_SEVERITY_LEVEL.INFO]: 'Informational',
};

const ISSUE_SEVERITY_SINGLE_LABELS = {
  [ISSUE_SEVERITY_LEVEL.BLOCKER]: 'Blocker',
  [ISSUE_SEVERITY_LEVEL.MAJOR]: 'Major',
  [ISSUE_SEVERITY_LEVEL.MINOR]: 'Minor',
  [ISSUE_SEVERITY_LEVEL.INFO]: 'Info',
};

const ISSUE_SEVERITY_ORDER = [
  ISSUE_SEVERITY_LEVEL.BLOCKER,
  ISSUE_SEVERITY_LEVEL.MAJOR,
  ISSUE_SEVERITY_LEVEL.MINOR,
  ISSUE_SEVERITY_LEVEL.INFO,
];

const DEFAULT_ISSUE_CATEGORY = 'general';

const ISSUE_TAXONOMY = new Map(
  Object.entries({
    'Manifest requirements entry must be an object': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Manifest requirements configured but playable shell not found': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.BLOCKER,
    },
    'Manifest paths entry must be an array of strings': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Manifest path requirement is not a string': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Manifest path requirement is empty': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MINOR,
    },
    'Manifest path requirement must be relative to the shell directory': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Manifest path requirement must not traverse above the shell directory': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Manifest required asset missing': {
      category: 'missing-asset',
      severity: ISSUE_SEVERITY_LEVEL.BLOCKER,
    },
    'Manifest globs entry must be an array of strings': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Manifest glob requirement is not a string': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Manifest glob requirement is empty': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MINOR,
    },
    'Manifest glob requirement must be relative to the shell directory': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Manifest glob requirement must not traverse above the shell directory': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Manifest glob matched no files': {
      category: 'manifest-misconfig',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Unable to determine slug for game entry': {
      category: 'catalog-data',
      severity: ISSUE_SEVERITY_LEVEL.BLOCKER,
    },
    'Missing playable shell': {
      category: 'missing-asset',
      severity: ISSUE_SEVERITY_LEVEL.BLOCKER,
    },
    'Sprite asset is not a valid path': {
      category: 'invalid-asset-reference',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Sprite asset must live under /assets/': {
      category: 'asset-policy',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Sprite asset missing on disk': {
      category: 'missing-asset',
      severity: ISSUE_SEVERITY_LEVEL.BLOCKER,
    },
    'Audio asset is not a valid path': {
      category: 'invalid-asset-reference',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Audio asset must live under /assets/': {
      category: 'asset-policy',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Audio asset missing on disk': {
      category: 'missing-asset',
      severity: ISSUE_SEVERITY_LEVEL.BLOCKER,
    },
    'Asset reference missing on disk': {
      category: 'missing-asset',
      severity: ISSUE_SEVERITY_LEVEL.BLOCKER,
    },
    'Thumbnail missing': {
      category: 'missing-asset',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Thumbnail uses placeholder art': {
      category: 'placeholder-art',
      severity: ISSUE_SEVERITY_LEVEL.MINOR,
    },
    'Platformer level manifest unavailable': {
      category: 'level-data',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Platformer level file missing': {
      category: 'level-data',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Platformer level JSON invalid': {
      category: 'level-data',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Platformer level format unsupported': {
      category: 'level-data',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Platformer level tile size mismatch': {
      category: 'level-data',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Platformer level missing tile layer': {
      category: 'level-data',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'Platformer level missing spawn point': {
      category: 'level-data',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'firstFrame.sprites is not an array': {
      category: 'catalog-data',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
    'firstFrame.audio is not an array': {
      category: 'catalog-data',
      severity: ISSUE_SEVERITY_LEVEL.MAJOR,
    },
  }),
);

const SHELL_ASSET_SCAN_EXTENSIONS = new Set(['.html', '.htm', '.js', '.mjs', '.cjs']);
const ASSET_REFERENCE_PATTERN = /\/assets\/[^\s"'`()<>]+/g;

function mapSeverityToLevel(severity) {
  if (severity === SEVERITY.WARNING) {
    return ISSUE_SEVERITY_LEVEL.MINOR;
  }
  return ISSUE_SEVERITY_LEVEL.MAJOR;
}

function resolveIssueSeverityLevel(issue) {
  if (issue?.severityLevel && ISSUE_SEVERITY_ORDER.includes(issue.severityLevel)) {
    return issue.severityLevel;
  }
  return mapSeverityToLevel(issue?.severity ?? SEVERITY.ERROR);
}

function summarizeSeverityCounts(issues) {
  const counts = Object.fromEntries(ISSUE_SEVERITY_ORDER.map((level) => [level, 0]));
  for (const issue of issues) {
    const level = resolveIssueSeverityLevel(issue);
    if (counts[level] == null) {
      counts[level] = 0;
    }
    counts[level] += 1;
  }
  return counts;
}

function summarizeIssueTotals(games) {
  const bySeverity = Object.fromEntries(ISSUE_SEVERITY_ORDER.map((level) => [level, 0]));
  const categoryCounts = new Map();

  let total = 0;

  for (const game of games) {
    const issues = Array.isArray(game.issues) ? game.issues : [];
    for (const issue of issues) {
      total += 1;

      const level = resolveIssueSeverityLevel(issue);
      if (bySeverity[level] == null) {
        bySeverity[level] = 0;
      }
      bySeverity[level] += 1;

      const category = issue.category ?? DEFAULT_ISSUE_CATEGORY;
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }

  const byCategory = Object.fromEntries(
    Array.from(categoryCounts.entries()).sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    }),
  );

  return { total, bySeverity, byCategory };
}

async function validatePlatformerLevels() {
  const issues = [];
  const tilesPath = path.join(ROOT, 'games', 'platformer', 'tiles.js');
  let manifest;
  try {
    manifest = await import(pathToFileURL(tilesPath));
  } catch (error) {
    issues.push(
      formatIssue('Platformer level manifest unavailable', {
        path: relativeFromRoot(tilesPath),
        error: error?.message ?? String(error),
      }),
    );
    return issues;
  }

  const levelList = Array.isArray(manifest?.levels) ? manifest.levels : [];
  const tileSize = manifest?.TILE ?? 50;

  if (levelList.length === 0) {
    issues.push(
      formatIssue('Platformer level manifest unavailable', {
        path: relativeFromRoot(tilesPath),
        reason: 'no levels defined',
      }),
    );
    return issues;
  }

  for (const relativeLevelPath of levelList) {
    if (typeof relativeLevelPath !== 'string' || !relativeLevelPath.trim()) {
      continue;
    }
    const resolvedPath = path.join(ROOT, 'games', 'platformer', relativeLevelPath);
    // eslint-disable-next-line no-await-in-loop
    if (!(await pathExists(resolvedPath))) {
      issues.push(
        formatIssue('Platformer level file missing', {
          level: relativeLevelPath,
          expected: relativeFromRoot(resolvedPath),
        }),
      );
      continue;
    }
    let parsed;
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await fs.readFile(resolvedPath, 'utf8');
      parsed = JSON.parse(raw);
    } catch (error) {
      issues.push(
        formatIssue('Platformer level JSON invalid', {
          level: relativeLevelPath,
          error: error?.message ?? String(error),
        }),
      );
      continue;
    }

    const format = detectPlatformerLevelFormat(parsed);
    if (format === 'tiled') {
      issues.push(
        ...validateTiledLevel(parsed, {
          level: relativeLevelPath,
          tileSize,
        }),
      );
    } else if (format === 'ldtk') {
      issues.push(
        ...validateLDtkLevel(parsed, {
          level: relativeLevelPath,
          tileSize,
        }),
      );
    } else {
      issues.push(
        formatIssue('Platformer level format unsupported', {
          level: relativeLevelPath,
        }),
      );
    }
  }

  return issues;
}

function detectPlatformerLevelFormat(json) {
  if (json && typeof json === 'object') {
    if (json.type === 'map' && Array.isArray(json.layers)) {
      return 'tiled';
    }
    if (Array.isArray(json.levels) && json.__header__?.app) {
      return 'ldtk';
    }
  }
  return null;
}

function validateTiledLevel(json, context) {
  const issues = [];
  const level = context?.level ?? '(unknown)';
  const tileSize = context?.tileSize ?? 50;
  const width = Number.isFinite(json.width) ? json.width : null;
  const height = Number.isFinite(json.height) ? json.height : null;
  if (json.tilewidth !== tileSize || json.tileheight !== tileSize) {
    issues.push(
      formatIssue('Platformer level tile size mismatch', {
        level,
        tilewidth: json.tilewidth,
        tileheight: json.tileheight,
        expected: tileSize,
      }),
    );
  }
  const layers = Array.isArray(json.layers) ? json.layers : [];
  const tileLayer = layers.find((layer) => layer && layer.type === 'tilelayer');
  if (!tileLayer) {
    issues.push(
      formatIssue('Platformer level missing tile layer', {
        level,
      }),
    );
  } else if (Array.isArray(tileLayer.data) && width && height) {
    if (tileLayer.data.length !== width * height) {
      issues.push(
        formatIssue('Platformer level JSON invalid', {
          level,
          reason: 'tile data length mismatch',
          expected: width * height,
          actual: tileLayer.data.length,
        }),
      );
    }
  }
  const objectLayer = layers.find((layer) => layer && layer.type === 'objectgroup');
  let spawnFound = false;
  if (objectLayer && Array.isArray(objectLayer.objects)) {
    spawnFound = objectLayer.objects.some((object) => {
      const type = (object?.type || object?.name || '').toLowerCase();
      return type.includes('player');
    });
  }
  if (!spawnFound) {
    issues.push(
      formatIssue('Platformer level missing spawn point', {
        level,
        hint: 'Add an object with type "player" to the entities layer.',
      }),
    );
  }
  return issues;
}

function validateLDtkLevel(json, context) {
  const issues = [];
  const level = context?.level ?? '(unknown)';
  const tileSize = context?.tileSize ?? 50;
  const levelEntry = Array.isArray(json.levels) ? json.levels[0] : null;
  if (!levelEntry || !Array.isArray(levelEntry.layerInstances)) {
    issues.push(formatIssue('Platformer level JSON invalid', { level, reason: 'missing layerInstances' }));
    return issues;
  }
  const terrainLayer = levelEntry.layerInstances.find((layer) => layer && layer.__type === 'IntGrid');
  if (!terrainLayer) {
    issues.push(formatIssue('Platformer level missing tile layer', { level }));
  } else if (terrainLayer.gridSize !== tileSize) {
    issues.push(
      formatIssue('Platformer level tile size mismatch', {
        level,
        tilewidth: terrainLayer.gridSize,
        tileheight: terrainLayer.gridSize,
        expected: tileSize,
      }),
    );
  }
  const entityLayer = levelEntry.layerInstances.find((layer) => layer && layer.__type === 'Entities');
  let spawnFound = false;
  if (entityLayer && Array.isArray(entityLayer.entityInstances)) {
    spawnFound = entityLayer.entityInstances.some((entity) => {
      const identifier = (entity?.__identifier || entity?.identifier || '').toLowerCase();
      return identifier.includes('player');
    });
  }
  if (!spawnFound) {
    issues.push(
      formatIssue('Platformer level missing spawn point', {
        level,
        hint: 'Add an entity with identifier containing "Player" to the level.',
      }),
    );
  }
  return issues;
}

const MANIFEST_PATH = path.join(ROOT, 'tools', 'reporters', 'game-doctor-manifest.json');
const GAMES_SCHEMA_PATH = path.join(ROOT, 'tools', 'schemas', 'games.schema.json');

const gamesPath = path.join(ROOT, 'games.json');
const execFileAsync = promisify(execFile);
const GIT_DIFF_BASE_CANDIDATES = ['origin/main', 'main'];

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function deriveSlug(game) {
  if (typeof game.slug === 'string' && game.slug.trim()) {
    return game.slug.trim();
  }
  if (typeof game.id === 'string' && game.id.trim()) {
    return game.id.trim();
  }
  if (typeof game.playUrl === 'string' && game.playUrl.trim()) {
    const trimmed = game.playUrl.trim().replace(/\/+$/, '');
    const parts = trimmed.split('/').filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  return null;
}

function formatIssue(message, context = {}, severity = SEVERITY.ERROR) {
  const taxonomy = ISSUE_TAXONOMY.get(message);
  const severityLevel = taxonomy?.severity ?? mapSeverityToLevel(severity);
  const category = taxonomy?.category ?? DEFAULT_ISSUE_CATEGORY;
  return {
    message,
    context,
    severity,
    severityLevel,
    category,
  };
}

function issueIsError(issue) {
  return (issue?.severity ?? SEVERITY.ERROR) === SEVERITY.ERROR;
}

function issueIsWarning(issue) {
  return (issue?.severity ?? SEVERITY.ERROR) === SEVERITY.WARNING;
}

function decodePointerSegment(segment) {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function describeInstancePath(instancePath) {
  if (!instancePath) {
    return '(root)';
  }

  const segments = instancePath
    .split('/')
    .slice(1)
    .map(decodePointerSegment);

  if (segments.length === 0) {
    return '(root)';
  }

  return segments
    .map((segment) => (Number.isInteger(Number(segment)) ? `[${segment}]` : segment))
    .join(' › ');
}

function formatSchemaError(error) {
  const location = describeInstancePath(error.instancePath ?? '');

  if (error.keyword === 'required') {
    return `${location}: missing required property "${error.params.missingProperty}"`;
  }

  if (error.keyword === 'additionalProperties') {
    return `${location}: unexpected property "${error.params.additionalProperty}"`;
  }

  if (error.keyword === 'pattern') {
    return `${location}: value does not match required pattern ${JSON.stringify(error.params.pattern)}`;
  }

  return `${location}: ${error.message}`;
}

async function loadGamesValidator() {
  let schemaRaw;
  try {
    schemaRaw = await fs.readFile(GAMES_SCHEMA_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Unable to find games schema at ${relativeFromRoot(GAMES_SCHEMA_PATH)}.`,
      );
    }
    throw error;
  }

  let schema;
  try {
    schema = JSON.parse(schemaRaw);
  } catch (error) {
    throw new Error(
      `Unable to parse games schema at ${relativeFromRoot(GAMES_SCHEMA_PATH)}: ${error.message}`,
    );
  }

  try {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validator = ajv.compile(schema);
    return validator;
  } catch (error) {
    throw new Error(
      `Unable to compile games schema at ${relativeFromRoot(GAMES_SCHEMA_PATH)}: ${error.message}`,
    );
  }
}

function ensureArray(value, label, issues) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push(formatIssue(`${label} is not an array`, { received: value }));
    return [];
  }
  return value;
}

function relativeFromRoot(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function parseSlugList(value) {
  return value
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
}

function addSlugSource(slugSources, slug, source) {
  if (!slug) {
    return;
  }
  if (!slugSources.has(slug)) {
    slugSources.set(slug, new Set());
  }
  slugSources.get(slug).add(source);
}

function normalizeRepoRelativePath(candidate) {
  if (typeof candidate !== 'string') {
    return null;
  }
  let normalized = candidate.trim();
  if (!normalized) {
    return null;
  }
  normalized = normalized.replace(/\\+/g, '/');
  normalized = normalized.replace(/^\.\/+/, '');
  normalized = normalized.replace(/^\/+/, '');
  return normalized;
}

function recordAssetReference(assetCatalog, slug, assetPath) {
  const normalized = normalizeRepoRelativePath(assetPath);
  if (!normalized || !normalized.startsWith('assets/')) {
    return;
  }
  if (!assetCatalog.has(normalized)) {
    assetCatalog.set(normalized, new Set());
  }
  assetCatalog.get(normalized).add(slug);
}

function buildAssetCatalog(games) {
  const catalog = new Map();

  for (const game of games) {
    const slug = deriveSlug(game);
    if (!slug) {
      continue;
    }

    const firstFrame = game && typeof game === 'object' ? game.firstFrame : null;
    if (!firstFrame || typeof firstFrame !== 'object') {
      continue;
    }

    if (Array.isArray(firstFrame.sprites)) {
      for (const sprite of firstFrame.sprites) {
        if (typeof sprite === 'string') {
          recordAssetReference(catalog, slug, sprite);
        }
      }
    }

    if (Array.isArray(firstFrame.audio)) {
      for (const audio of firstFrame.audio) {
        if (typeof audio === 'string') {
          recordAssetReference(catalog, slug, audio);
        }
      }
    }
  }

  return catalog;
}

function detectSlugFromAssetPath(segments, knownSlugs) {
  if (!Array.isArray(segments) || segments.length < 3) {
    return null;
  }

  if (segments[0] !== 'assets') {
    return null;
  }

  for (let index = segments.length - 1; index >= 1; index -= 1) {
    const segment = segments[index];
    if (!segment) {
      continue;
    }

    const trimmed = segment.trim();
    if (trimmed && knownSlugs.has(trimmed)) {
      return trimmed;
    }

    if (index === segments.length - 1) {
      const withoutExtension = trimmed.replace(path.extname(trimmed), '').trim();
      if (withoutExtension && knownSlugs.has(withoutExtension)) {
        return withoutExtension;
      }
    }
  }

  return null;
}

function analyzeChangedFiles(files, knownSlugs = new Set(), assetCatalog = new Map()) {
  const slugs = new Set();

  for (const file of files) {
    const normalized = normalizeRepoRelativePath(file);
    if (!normalized) {
      continue;
    }
    if (normalized === 'games.json' || normalized.startsWith('games.json/')) {
      return { slugs: null, reason: 'games.json changed' };
    }
    if (normalized === 'tools/reporters/game-doctor-manifest.json') {
      return { slugs: null, reason: 'game doctor manifest changed' };
    }

    const segments = normalized.split('/').filter(Boolean);
    if (segments[0] === 'games' && segments[1]) {
      slugs.add(segments[1]);
      continue;
    }
    if (segments[0] === 'gameshells' && segments[1]) {
      slugs.add(segments[1]);
      continue;
    }
    if (segments[0] === 'assets' && segments[1] === 'thumbs' && segments.length >= 3) {
      const filename = segments[segments.length - 1];
      const slug = filename.replace(path.extname(filename), '').trim();
      if (slug) {
        slugs.add(slug);
      }
      continue;
    }

    if (segments[0] === 'assets') {
      const slugFromAsset = detectSlugFromAssetPath(segments, knownSlugs);
      if (slugFromAsset) {
        slugs.add(slugFromAsset);
      }

      const catalogEntry = assetCatalog.get(normalized);
      if (catalogEntry && catalogEntry.size > 0) {
        for (const slug of catalogEntry) {
          slugs.add(slug);
        }
        continue;
      }

      if (!slugFromAsset) {
        return { slugs: null, reason: `asset change not mapped to a game (${normalized})` };
      }

      continue;
    }

    const catalogEntry = assetCatalog.get(normalized);
    if (catalogEntry && catalogEntry.size > 0) {
      for (const slug of catalogEntry) {
        slugs.add(slug);
      }
      continue;
    }
  }

  return { slugs, reason: null };
}

async function detectChangedSlugs(knownSlugs = new Set(), assetCatalog = new Map()) {
  let lastError = null;

  for (const base of GIT_DIFF_BASE_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--name-only', `${base}...HEAD`], {
        cwd: ROOT,
        maxBuffer: 10 * 1024 * 1024,
      });
      const files = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const analysis = analyzeChangedFiles(files, knownSlugs, assetCatalog);
      return { base, files, ...analysis };
    } catch (error) {
      lastError = error;
    }
  }

  const fallbackReason = lastError?.message ?? 'git diff failed';
  const firstLine = fallbackReason.split(/\r?\n/, 1)[0];
  return { base: null, files: null, slugs: null, reason: firstLine };
}

async function loadManifest() {
  try {
    const manifestRaw = await fs.readFile(MANIFEST_PATH, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error(
        `Manifest at ${relativeFromRoot(MANIFEST_PATH)} must be a JSON object with a requirements map.`,
      );
    }
    if (manifest.requirements == null) {
      manifest.requirements = {};
    }
    if (typeof manifest.requirements !== 'object' || Array.isArray(manifest.requirements)) {
      throw new Error(
        `Manifest at ${relativeFromRoot(MANIFEST_PATH)} must expose a requirements object keyed by slug.`,
      );
    }
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { version: 1, requirements: {} };
    }
    if (error instanceof SyntaxError) {
      throw new Error(
        `Unable to parse manifest at ${relativeFromRoot(MANIFEST_PATH)}: ${error.message}`,
      );
    }
    throw error;
  }
}

function normalizeGlobPattern(pattern) {
  let normalized = pattern.replace(/\\/g, '/');
  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/\/{2,}/g, '/');
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.replace(/\/+$/, '');
  }
  return normalized;
}

function globToRegExp(pattern) {
  let regex = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      let starCount = 1;
      while (pattern[i + starCount] === '*') {
        starCount += 1;
      }
      if (starCount > 1) {
        regex += '.*';
      } else {
        regex += '[^/]*';
      }
      i += starCount - 1;
      continue;
    }
    if (char === '?') {
      regex += '[^/]';
      continue;
    }
    if ('\\.[]{}()+^$|'.includes(char)) {
      regex += `\\${char}`;
      continue;
    }
    regex += char;
  }
  regex += '$';
  return new RegExp(regex);
}

async function collectShellEntries(baseDir) {
  const collected = [];

  async function walk(currentDir) {
    let dirEntries;
    try {
      dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of dirEntries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path
        .relative(baseDir, absolutePath)
        .replace(/\\/g, '/');
      collected.push({ absolute: absolutePath, relative: relativePath });
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(absolutePath);
      }
    }
  }

  await walk(baseDir);
  return collected;
}

async function collectShellSourceFiles(baseDir) {
  const collected = [];

  async function walk(currentDir) {
    let dirEntries;
    try {
      dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of dirEntries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!SHELL_ASSET_SCAN_EXTENSIONS.has(extension)) {
        continue;
      }
      const relativePath = path.relative(baseDir, absolutePath).replace(/\\/g, '/');
      collected.push({ absolute: absolutePath, relative: relativePath });
    }
  }

  await walk(baseDir);
  return collected;
}

function isLocalAssetReference(source, matchIndex) {
  if (matchIndex <= 0) {
    return true;
  }

  const boundaryChars = new Set(['"', "'", '`', ' ', '\t', '\r', '\n', '(', '[', '{', '<', '>', '=']);
  let boundaryIndex = -1;
  for (let i = matchIndex - 1; i >= 0; i -= 1) {
    const char = source[i];
    if (boundaryChars.has(char)) {
      boundaryIndex = i;
      break;
    }
  }

  const contextStart = boundaryIndex + 1;
  const context = source.slice(contextStart, matchIndex);
  if (context.startsWith('//')) {
    return false;
  }
  if (context.includes('://')) {
    return false;
  }
  return true;
}

function normalizeAssetReference(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  let normalized = raw;
  const queryIndex = normalized.search(/[?#]/);
  if (queryIndex !== -1) {
    normalized = normalized.slice(0, queryIndex);
  }
  normalized = normalized.replace(/^\/+/, '');
  if (!normalized.startsWith('assets/')) {
    return null;
  }
  return normalized;
}

function computeLineAndColumn(source, index) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function extractAssetReferences(source) {
  if (typeof source !== 'string' || !source.includes('/assets/')) {
    return [];
  }
  const matches = [];
  ASSET_REFERENCE_PATTERN.lastIndex = 0;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = ASSET_REFERENCE_PATTERN.exec(source)) != null) {
    if (!isLocalAssetReference(source, match.index)) {
      continue;
    }
    const normalized = normalizeAssetReference(match[0]);
    if (!normalized) {
      continue;
    }
    matches.push({ raw: match[0], normalized, index: match.index });
  }
  return matches;
}

async function analyzeShellAssetReferences(slug, shellAbsolutePath, issues) {
  if (!shellAbsolutePath) {
    return null;
  }

  const shellDir = path.dirname(shellAbsolutePath);
  const sourceFiles = await collectShellSourceFiles(shellDir);

  const assetMap = new Map();
  let totalReferences = 0;

  for (const file of sourceFiles) {
    let contents;
    try {
      // eslint-disable-next-line no-await-in-loop
      contents = await fs.readFile(file.absolute, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    const references = extractAssetReferences(contents);
    if (references.length === 0) {
      continue;
    }

    for (const reference of references) {
      totalReferences += 1;
      const key = reference.normalized;
      if (!assetMap.has(key)) {
        assetMap.set(key, {
          asset: `/${key}`,
          references: [],
        });
      }
      const location = computeLineAndColumn(contents, reference.index);
      assetMap.get(key).references.push({
        file: relativeFromRoot(file.absolute),
        line: location.line,
        column: location.column,
      });
    }
  }

  const missingAssets = [];

  for (const [normalized, entry] of assetMap.entries()) {
    const absoluteAssetPath = path.join(ROOT, normalized);
    // eslint-disable-next-line no-await-in-loop
    const exists = await pathExists(absoluteAssetPath);
    if (!exists) {
      missingAssets.push(entry);
      issues.push(
        formatIssue('Asset reference missing on disk', {
          slug,
          asset: entry.asset,
          expected: relativeFromRoot(absoluteAssetPath),
          references: entry.references,
        }),
      );
    }
  }

  if (assetMap.size === 0) {
    return { total: 0, unique: 0, missing: 0 };
  }

  return {
    total: totalReferences,
    unique: assetMap.size,
    missing: missingAssets.length,
  };
}

function matchGlobEntries(entries, pattern) {
  const normalized = normalizeGlobPattern(pattern);
  const matcher = globToRegExp(normalized);
  return entries.filter((entry) => matcher.test(entry.relative));
}

async function evaluateManifestRequirements(slug, shellAbsolutePath, manifestRequirements, issues) {
  const manifestResult = { paths: [], globs: [] };

  if (!slug) {
    return manifestResult;
  }

  const entry = manifestRequirements?.[slug];
  if (!entry) {
    return manifestResult;
  }

  if (typeof entry !== 'object' || Array.isArray(entry)) {
    issues.push(
      formatIssue('Manifest requirements entry must be an object', {
        slug,
        received: entry,
      }),
    );
    return manifestResult;
  }

  if (!shellAbsolutePath) {
    issues.push(
      formatIssue('Manifest requirements configured but playable shell not found', {
        slug,
      }),
    );
    return manifestResult;
  }

  const shellDir = path.dirname(shellAbsolutePath);

  if (entry.paths != null && !Array.isArray(entry.paths)) {
    issues.push(
      formatIssue('Manifest paths entry must be an array of strings', {
        slug,
        received: entry.paths,
      }),
    );
  } else if (Array.isArray(entry.paths)) {
    for (const rawRequirement of entry.paths) {
      const requirementEntry = { requirement: rawRequirement };

      if (typeof rawRequirement !== 'string') {
        requirementEntry.error = 'not-a-string';
        manifestResult.paths.push(requirementEntry);
        issues.push(
          formatIssue('Manifest path requirement is not a string', {
            slug,
            requirement: rawRequirement,
          }),
        );
        continue;
      }

      const requirement = rawRequirement.trim();
      requirementEntry.requirement = requirement;

      if (!requirement) {
        requirementEntry.error = 'empty';
        manifestResult.paths.push(requirementEntry);
        issues.push(
          formatIssue('Manifest path requirement is empty', {
            slug,
          }),
        );
        continue;
      }

      if (path.isAbsolute(requirement)) {
        requirementEntry.error = 'absolute-path';
        manifestResult.paths.push(requirementEntry);
        issues.push(
          formatIssue('Manifest path requirement must be relative to the shell directory', {
            slug,
            requirement,
          }),
        );
        continue;
      }

      const segments = requirement.split(/[\\/]+/).filter(Boolean);
      if (segments.includes('..')) {
        requirementEntry.error = 'parent-segment';
        manifestResult.paths.push(requirementEntry);
        issues.push(
          formatIssue('Manifest path requirement must not traverse above the shell directory', {
            slug,
            requirement,
          }),
        );
        continue;
      }

      const candidate = path.join(shellDir, requirement);
      // eslint-disable-next-line no-await-in-loop
      const exists = await pathExists(candidate);
      requirementEntry.found = exists;
      requirementEntry.resolved = relativeFromRoot(candidate);
      manifestResult.paths.push(requirementEntry);

      if (!exists) {
        issues.push(
          formatIssue('Manifest required asset missing', {
            slug,
            requirement,
            expected: requirementEntry.resolved,
          }),
        );
      }
    }
  }

  let cachedShellEntries = null;

  if (entry.globs != null && !Array.isArray(entry.globs)) {
    issues.push(
      formatIssue('Manifest globs entry must be an array of strings', {
        slug,
        received: entry.globs,
      }),
    );
  } else if (Array.isArray(entry.globs)) {
    for (const rawPattern of entry.globs) {
      const globEntry = { pattern: rawPattern };

      if (typeof rawPattern !== 'string') {
        globEntry.error = 'not-a-string';
        manifestResult.globs.push(globEntry);
        issues.push(
          formatIssue('Manifest glob requirement is not a string', {
            slug,
            pattern: rawPattern,
          }),
        );
        continue;
      }

      const pattern = rawPattern.trim();
      globEntry.pattern = pattern;

      if (!pattern) {
        globEntry.error = 'empty';
        manifestResult.globs.push(globEntry);
        issues.push(
          formatIssue('Manifest glob requirement is empty', {
            slug,
          }),
        );
        continue;
      }

      if (path.isAbsolute(pattern)) {
        globEntry.error = 'absolute-pattern';
        manifestResult.globs.push(globEntry);
        issues.push(
          formatIssue('Manifest glob requirement must be relative to the shell directory', {
            slug,
            pattern,
          }),
        );
        continue;
      }

      const segments = pattern.split(/[\\/]+/).filter(Boolean);
      if (segments.includes('..')) {
        globEntry.error = 'parent-segment';
        manifestResult.globs.push(globEntry);
        issues.push(
          formatIssue('Manifest glob requirement must not traverse above the shell directory', {
            slug,
            pattern,
          }),
        );
        continue;
      }

      if (!cachedShellEntries) {
        // eslint-disable-next-line no-await-in-loop
        cachedShellEntries = await collectShellEntries(shellDir);
      }

      const matches = matchGlobEntries(cachedShellEntries, pattern);

      globEntry.matches = matches.map((match) => ({
        relativeToShell: match.relative,
        relativeToRoot: relativeFromRoot(match.absolute),
      }));
      manifestResult.globs.push(globEntry);

      if (matches.length === 0) {
        issues.push(
          formatIssue('Manifest glob matched no files', {
            slug,
            pattern,
          }),
        );
      }
    }
  }

  return manifestResult;
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push('# Game Doctor Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push(`- Total games: ${report.summary.total}`);
  lines.push(`- Passing: ${report.summary.passing}`);
  lines.push(`- Failing: ${report.summary.failing}`);
  if (typeof report.summary.withWarnings === 'number') {
    lines.push(`- With warnings: ${report.summary.withWarnings}`);
  }
  const issueTotals = report.summary?.issueCounts;
  if (issueTotals) {
    lines.push(`- Issues found: ${issueTotals.total}`);
    const severitySummary = [];
    for (const level of ISSUE_SEVERITY_ORDER) {
      const count = issueTotals.bySeverity?.[level];
      if (count > 0) {
        severitySummary.push(`${ISSUE_SEVERITY_LABELS[level] ?? level}: ${count}`);
      }
    }
    if (severitySummary.length > 0) {
      lines.push(`- Issues by severity: ${severitySummary.join(', ')}`);
    }
    const categoryEntries = Object.entries(issueTotals.byCategory ?? {});
    if (categoryEntries.length > 0) {
      const categorySummary = categoryEntries
        .map(([category, count]) => `${category}: ${count}`)
        .join(', ');
      lines.push(`- Issues by category: ${categorySummary}`);
    }
  }
  if (report.manifest) {
    lines.push(`- Manifest version: ${report.manifest.version ?? 'unknown'}`);
    lines.push(`- Manifest source: ${report.manifest.source ?? relativeFromRoot(MANIFEST_PATH)}`);
  }
  lines.push('');
  for (const game of report.games) {
    lines.push(`## ${game.title ?? game.slug ?? 'Unknown Game'}`);
    lines.push('');
    lines.push(`- Slug: ${game.slug ?? 'N/A'}`);
    const statusIcon = game.status?.errors
      ? '❌ Needs attention'
      : game.status?.warnings
        ? '⚠️ Review warnings'
        : '✅ Healthy';
    lines.push(`- Status: ${statusIcon}`);
    if (game.shell?.found) {
      lines.push(`- Shell: ${game.shell.found}`);
    } else {
      lines.push(`- Shell: missing`);
    }
    if (game.thumbnail?.found) {
      const note = game.thumbnail.placeholder ? ' (⚠️ placeholder)' : '';
      lines.push(`- Thumbnail: ${game.thumbnail.found}${note}`);
    } else {
      lines.push(`- Thumbnail: missing`);
    }
    if (game.assets?.sprites?.length) {
      lines.push(`- Sprites checked: ${game.assets.sprites.length}`);
    }
    if (game.assets?.audio?.length) {
      lines.push(`- Audio checked: ${game.assets.audio.length}`);
    }
    if (game.assets?.references) {
      lines.push(`- Asset references scanned: ${game.assets.references.total ?? 0}`);
      if ((game.assets.references.missing ?? 0) > 0) {
        lines.push(`- Asset references missing: ${game.assets.references.missing}`);
      }
    }
    if (game.requirements?.paths?.length) {
      const pathProblems = game.requirements.paths.filter(
        (entry) => entry.error || entry.found === false,
      );
      if (pathProblems.length === 0) {
        lines.push('- Manifest paths: all required paths found');
      } else {
        lines.push('- Manifest paths missing or invalid:');
        for (const issue of pathProblems) {
          const label = issue.resolved ?? issue.requirement ?? '[invalid requirement]';
          lines.push(`  - ${label}`);
        }
      }
    }
    if (game.requirements?.globs?.length) {
      const globProblems = game.requirements.globs.filter((entry) => {
        if (entry.error) {
          return true;
        }
        if (!Array.isArray(entry.matches)) {
          return true;
        }
        return entry.matches.length === 0;
      });
      if (globProblems.length === 0) {
        lines.push('- Manifest globs: all patterns matched files');
      } else {
        lines.push('- Manifest globs with no matches or invalid patterns:');
        for (const globEntry of globProblems) {
          lines.push(`  - ${globEntry.pattern ?? '[invalid pattern]'}`);
        }
      }
    }
    if (game.issues.length === 0) {
      lines.push('- Issues: none');
    } else {
      const severityCounts = summarizeSeverityCounts(game.issues);
      const severitySummary = [];
      for (const level of ISSUE_SEVERITY_ORDER) {
        const count = severityCounts[level];
        if (count > 0) {
          severitySummary.push(`${ISSUE_SEVERITY_LABELS[level]}: ${count}`);
        }
      }
      if (severitySummary.length > 0) {
        const hasBlockers = (severityCounts[ISSUE_SEVERITY_LEVEL.BLOCKER] ?? 0) > 0;
        const prefix = hasBlockers ? '- **Severity:** ' : '- Severity: ';
        lines.push(`${prefix}${severitySummary.join(', ')}`);
      }
      lines.push('- Issues:');
      for (const issue of game.issues) {
        const level = resolveIssueSeverityLevel(issue);
        const levelLabel = ISSUE_SEVERITY_SINGLE_LABELS[level] ?? level;
        const categoryLabel = issue.category && issue.category !== DEFAULT_ISSUE_CATEGORY
          ? ` [${issue.category}]`
          : '';
        let prefix;
        if (level === ISSUE_SEVERITY_LEVEL.BLOCKER) {
          prefix = '❌ Blocker';
        } else if (
          issueIsWarning(issue) ||
          level === ISSUE_SEVERITY_LEVEL.MINOR ||
          level === ISSUE_SEVERITY_LEVEL.INFO
        ) {
          prefix = '⚠️ Warning';
        } else {
          prefix = '❌ Error';
        }
        const detailLabel = levelLabel && !prefix.toLowerCase().includes(levelLabel.toLowerCase())
          ? ` (${levelLabel})`
          : '';
        lines.push(`  - ${prefix}${categoryLabel}${detailLabel}: ${issue.message}`);
        const entries = Object.entries(issue.context ?? {});
        if (entries.length) {
          for (const [key, value] of entries) {
            lines.push(`    - ${key}: ${JSON.stringify(value)}`);
          }
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

const WRITE_BASELINE_ENV = 'GAME_DOCTOR_ALLOW_WRITE_BASELINE';

function isBaselineWriteEnabled() {
  const flag = process.env[WRITE_BASELINE_ENV];
  if (!flag) {
    return false;
  }
  const normalized = String(flag).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  let strictMode = false;
  let baselinePath = DEFAULT_BASELINE;
  let writeBaseline = false;
  let changedRequested = false;
  const slugSources = new Map();

  function registerSlugList(value) {
    if (!value) {
      return;
    }
    for (const slug of parseSlugList(value)) {
      addSlugSource(slugSources, slug, 'cli');
    }
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--strict') {
      strictMode = true;
      continue;
    }

    if (arg === '--write-baseline') {
      writeBaseline = true;
      continue;
    }

    if (arg === '--changed') {
      changedRequested = true;
      continue;
    }

    if (arg.startsWith('--baseline=')) {
      const value = arg.slice('--baseline='.length);
      if (value.trim()) {
        baselinePath = path.isAbsolute(value) ? value : path.join(ROOT, value);
      }
      continue;
    }

    if (arg === '--baseline') {
      const value = args[index + 1];
      if (value && !value.startsWith('--')) {
        if (value.trim()) {
          baselinePath = path.isAbsolute(value) ? value : path.join(ROOT, value);
        }
        index += 1;
      }
      continue;
    }

    if (arg.startsWith('--slug=')) {
      registerSlugList(arg.slice('--slug='.length));
      continue;
    }

    if (arg === '--slug') {
      const value = args[index + 1];
      if (value && !value.startsWith('--')) {
        registerSlugList(value);
        index += 1;
      }
    }
  }

  return {
    strictMode,
    baselinePath,
    writeBaseline,
    changedRequested,
    slugSources,
    forceEmptyFilter: false,
  };
}

function buildBaselinePayload(report) {
  const games = report.games.map((game) => {
    const entry = {
      index: game.index,
      title: game.title,
      slug: game.slug,
      ok: game.ok,
      issues: game.issues,
      shell: game.shell,
      assets: game.assets,
      thumbnail: game.thumbnail,
      status: game.status,
    };
    if (game.requirements) {
      entry.requirements = game.requirements;
    }
    return entry;
  });

  return {
    generatedAt: report.generatedAt,
    summary: report.summary,
    games,
  };
}

function mapBaselineGames(baseline) {
  const bySlug = new Map();
  const byIndex = new Map();

  if (!baseline || typeof baseline !== 'object' || !Array.isArray(baseline.games)) {
    return { bySlug, byIndex };
  }

  for (const entry of baseline.games) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    if (typeof entry.slug === 'string' && entry.slug.trim()) {
      bySlug.set(entry.slug.trim(), entry);
    }
    if (typeof entry.index === 'number') {
      byIndex.set(entry.index, entry);
    }
  }

  return { bySlug, byIndex };
}

function selectBaselineEntry(game, maps) {
  if (game.slug && maps.bySlug.has(game.slug)) {
    return maps.bySlug.get(game.slug);
  }
  if (maps.byIndex.has(game.index)) {
    return maps.byIndex.get(game.index);
  }
  return null;
}

async function main() {
  const cliConfig = parseCliArgs();
  const { strictMode, baselinePath, writeBaseline } = cliConfig;
  const { slugSources } = cliConfig;
  let { changedRequested, forceEmptyFilter } = cliConfig;

  if (writeBaseline && !isBaselineWriteEnabled()) {
    console.error(
      `--write-baseline requested but ${WRITE_BASELINE_ENV} is not enabled. Refusing to write baseline.`,
    );
    process.exitCode = 1;
    return;
  }

  let validateGames;
  try {
    validateGames = await loadGamesValidator();
  } catch (error) {
    console.error(error.message ?? error);
    process.exitCode = 1;
    return;
  }

  if (!(await pathExists(gamesPath))) {
    console.error(`Unable to locate games catalog at ${relativeFromRoot(gamesPath)}.`);
    process.exitCode = 1;
    return;
  }

  const raw = await fs.readFile(gamesPath, 'utf8');
  let games;
  try {
    games = JSON.parse(raw);
  } catch (error) {
    console.error('Failed to parse games.json:', error);
    process.exitCode = 1;
    return;
  }

  if (!Array.isArray(games)) {
    console.error('Expected games.json to contain an array of games.');
    process.exitCode = 1;
    return;
  }

  const knownSlugs = new Set();
  for (const game of games) {
    const slug = deriveSlug(game);
    if (slug) {
      knownSlugs.add(slug);
    }
  }

  const assetCatalog = buildAssetCatalog(games);

  if (changedRequested) {
    const detection = await detectChangedSlugs(knownSlugs, assetCatalog);
    if (detection.slugs == null) {
      const reasonSuffix = detection.reason ? ` (${detection.reason})` : '';
      console.log(
        `Game doctor: unable to determine changed slugs${reasonSuffix}. Running full validation instead.`,
      );
      changedRequested = false;
    } else {
      if (detection.slugs.size > 0) {
        for (const slug of detection.slugs) {
          addSlugSource(slugSources, slug, 'changed');
        }
        const baseLabel = detection.base ?? 'git history';
        console.log(
          `Game doctor: targeting ${detection.slugs.size} changed game slug(s) based on git diff against ${baseLabel}.`,
        );
      } else if (slugSources.size === 0) {
        forceEmptyFilter = true;
        console.log('Game doctor: --changed detected no modified game slugs.');
      }
    }
  }

  const filterActive = slugSources.size > 0 || forceEmptyFilter;
  const slugFilter = filterActive ? new Set(slugSources.keys()) : null;
  const matchedSlugs = new Set();

  if (!validateGames(games)) {
    console.error('games.json failed schema validation:');
    for (const error of validateGames.errors ?? []) {
      console.error(` - ${formatSchemaError(error)}`);
    }
    process.exitCode = 1;
    return;
  }

  let manifest;
  try {
    manifest = await loadManifest();
  } catch (error) {
    console.error(error.message ?? error);
    process.exitCode = 1;
    return;
  }

  const manifestRequirements = manifest.requirements ?? {};
  const results = [];

  for (const [index, game] of games.entries()) {
    const issues = [];

    const slug = deriveSlug(game);
    if (!slug) {
      issues.push(formatIssue('Unable to determine slug for game entry', { index }));
    }

    if (slugFilter) {
      if (!slug || !slugFilter.has(slug)) {
        continue;
      }
      if (slug) {
        matchedSlugs.add(slug);
      }
    }

    const title = typeof game.title === 'string' ? game.title : `Game #${index + 1}`;

    let foundShell = null;
    let foundShellAbsolute = null;
    if (slug) {
      const shellCandidates = [
        path.join(ROOT, 'games', slug, 'index.html'),
        path.join(ROOT, 'gameshells', slug, 'index.html'),
      ];

      for (const candidate of shellCandidates) {
        // eslint-disable-next-line no-await-in-loop
        if (await pathExists(candidate)) {
          foundShellAbsolute = candidate;
          foundShell = relativeFromRoot(candidate);
          break;
        }
      }

      if (!foundShell) {
        issues.push(
          formatIssue('Missing playable shell', {
            tried: shellCandidates.map(relativeFromRoot),
          }),
        );
      }
    }

    if (slug === 'platformer') {
      const levelIssues = await validatePlatformerLevels();
      issues.push(...levelIssues);
    }

    const firstFrame = game.firstFrame ?? {};
    const spriteList = ensureArray(firstFrame.sprites, 'firstFrame.sprites', issues);
    const audioList = ensureArray(firstFrame.audio, 'firstFrame.audio', issues);

    const checkedSprites = [];
    for (const sprite of spriteList) {
      if (typeof sprite !== 'string' || !sprite.trim()) {
        issues.push(formatIssue('Sprite asset is not a valid path', { sprite }));
        continue;
      }
      if (!sprite.startsWith('/assets/')) {
        issues.push(formatIssue('Sprite asset must live under /assets/', { sprite }));
        continue;
      }
      const spritePath = path.join(ROOT, sprite.replace(/^\//, ''));
      // eslint-disable-next-line no-await-in-loop
      if (!(await pathExists(spritePath))) {
        issues.push(formatIssue('Sprite asset missing on disk', { sprite, expected: relativeFromRoot(spritePath) }));
        continue;
      }
      checkedSprites.push(relativeFromRoot(spritePath));
    }

    const checkedAudio = [];
    for (const audio of audioList) {
      if (typeof audio !== 'string' || !audio.trim()) {
        issues.push(formatIssue('Audio asset is not a valid path', { audio }));
        continue;
      }
      if (!audio.startsWith('/assets/')) {
        issues.push(formatIssue('Audio asset must live under /assets/', { audio }));
        continue;
      }
      const audioPath = path.join(ROOT, audio.replace(/^\//, ''));
      // eslint-disable-next-line no-await-in-loop
      if (!(await pathExists(audioPath))) {
        issues.push(formatIssue('Audio asset missing on disk', { audio, expected: relativeFromRoot(audioPath) }));
        continue;
      }
      checkedAudio.push(relativeFromRoot(audioPath));
    }

    const assetReferenceSummary = await analyzeShellAssetReferences(
      slug,
      foundShellAbsolute,
      issues,
    );

    let thumbnailFound = null;
    let thumbnailIsPlaceholder = false;
    if (slug) {
      const thumbCandidates = [];
      for (const ext of THUMB_EXTENSIONS) {
        thumbCandidates.push(path.join(ROOT, 'assets', 'thumbs', `${slug}.${ext}`));
      }
      for (const ext of THUMB_EXTENSIONS) {
        thumbCandidates.push(path.join(ROOT, 'games', slug, `thumb.${ext}`));
      }
      thumbCandidates.push(path.join(ROOT, PLACEHOLDER_THUMB));
      for (const candidate of thumbCandidates) {
        // eslint-disable-next-line no-await-in-loop
        if (await pathExists(candidate)) {
          thumbnailFound = relativeFromRoot(candidate);
          if (thumbnailFound === PLACEHOLDER_THUMB) {
            thumbnailIsPlaceholder = true;
          }
          break;
        }
      }
      if (!thumbnailFound) {
        issues.push(
          formatIssue('Thumbnail missing', {
            tried: thumbCandidates.map(relativeFromRoot),
          }),
        );
      } else if (thumbnailIsPlaceholder) {
        issues.push(
          formatIssue(
            'Thumbnail uses placeholder art',
            {
              thumbnail: thumbnailFound,
              recommendation:
                'Provide a bespoke thumbnail in assets/thumbs/<slug>.(png|svg) or games/<slug>/thumb.(png|svg)',
            },
            SEVERITY.WARNING,
          ),
        );
      }
    }

    const manifestCheck = await evaluateManifestRequirements(
      slug,
      foundShellAbsolute,
      manifestRequirements,
      issues,
    );

    const includeManifestDetails =
      manifestCheck.paths.length > 0 || manifestCheck.globs.length > 0;

    const hasErrors = issues.some(issueIsError);
    const hasWarnings = issues.some(issueIsWarning);

    const result = {
      index,
      title,
      slug,
      ok: !hasErrors,
      issues,
      shell: { found: foundShell },
      assets: {
        sprites: checkedSprites,
        audio: checkedAudio,
      },
      thumbnail: { found: thumbnailFound, placeholder: thumbnailIsPlaceholder },
      status: {
        errors: hasErrors,
        warnings: hasWarnings,
      },
    };

    if (
      assetReferenceSummary &&
      (assetReferenceSummary.total > 0 || assetReferenceSummary.missing > 0)
    ) {
      result.assets.references = assetReferenceSummary;
    }

    if (includeManifestDetails) {
      result.requirements = manifestCheck;
    }

    results.push(result);
  }

  const summary = {
    total: results.length,
    passing: results.filter((game) => game.ok).length,
    failing: results.filter((game) => !game.ok).length,
    withWarnings: results.filter((game) => game.issues.some(issueIsWarning)).length,
  };
  summary.issueCounts = summarizeIssueTotals(results);

  if (slugFilter) {
    const missingCliSlugs = [];
    const missingChangedSlugs = [];

    for (const [slug, sources] of slugSources.entries()) {
      if (matchedSlugs.has(slug)) {
        continue;
      }
      if (sources.has('cli')) {
        missingCliSlugs.push(slug);
      }
      if (sources.has('changed')) {
        missingChangedSlugs.push(slug);
      }
    }

    if (missingCliSlugs.length > 0) {
      console.error(
        `Game doctor: requested slug(s) not found in games.json: ${missingCliSlugs.join(', ')}.`,
      );
      process.exitCode = 1;
      return;
    }

    if (missingChangedSlugs.length > 0) {
      console.warn(
        `Game doctor: detected changed slug(s) not present in games.json: ${missingChangedSlugs.join(', ')}.`,
      );
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    manifest: {
      version: manifest.version ?? null,
      source: relativeFromRoot(MANIFEST_PATH),
    },
    games: results,
  };

  let baseline = null;
  let baselineMaps = { bySlug: new Map(), byIndex: new Map() };
  if (strictMode) {
    if (!(await pathExists(baselinePath))) {
      console.error(
        `Strict mode requested but no baseline found at ${relativeFromRoot(baselinePath)}.`,
      );
      process.exitCode = 1;
      return;
    }

    try {
      const baselineRaw = await fs.readFile(baselinePath, 'utf8');
      baseline = JSON.parse(baselineRaw);
      baselineMaps = mapBaselineGames(baseline);
    } catch (error) {
      console.error('Unable to read or parse Game Doctor baseline:', error);
      process.exitCode = 1;
      return;
    }
  }

  await fs.mkdir(HEALTH_DIR, { recursive: true });
  await fs.writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(REPORT_MD, `${buildMarkdownReport(report)}\n`, 'utf8');

  if (writeBaseline) {
    const baselineDir = path.dirname(baselinePath);
    await fs.mkdir(baselineDir, { recursive: true });
    const payload = buildBaselinePayload(report);
    await fs.writeFile(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(
      `Game doctor baseline written to ${relativeFromRoot(baselinePath)}.`,
    );
  }

  if (strictMode) {
    const regressions = [];
    const knownIssues = [];

    for (const game of results) {
      if (game.ok) {
        continue;
      }
      const baselineEntry = selectBaselineEntry(game, baselineMaps);
      if (!baselineEntry || baselineEntry.ok !== false) {
        regressions.push(game);
      } else {
        knownIssues.push(game);
      }
    }

    if (regressions.length > 0) {
      const list = regressions
        .map((game) => game.slug ?? game.title ?? `Game #${game.index + 1}`)
        .join(', ');
      console.error(
        `Game doctor strict mode detected ${regressions.length} regression(s): ${list}. See ${relativeFromRoot(
          REPORT_JSON,
        )} for details.`,
      );
      process.exitCode = 1;
      return;
    }

    if (summary.failing > 0) {
      const list = knownIssues
        .map((game) => game.slug ?? game.title ?? `Game #${game.index + 1}`)
        .join(', ');
      console.warn(
        `Game doctor strict mode: ${summary.failing} game(s) still failing but acknowledged in baseline (${list}).`,
      );
    } else {
      if (summary.withWarnings > 0) {
        console.log(
          `Game doctor strict mode: ${summary.total} game(s) passing with ${summary.withWarnings} warning(s).`,
        );
      } else {
        console.log(`Game doctor strict mode: all ${summary.total} game(s) look healthy!`);
      }
    }
  } else if (summary.failing > 0) {
    console.error(
      `Game doctor found ${summary.failing} of ${summary.total} game(s) with issues. See ${relativeFromRoot(
        REPORT_JSON,
      )} for details.`,
    );
    process.exitCode = 1;
  } else {
    if (summary.withWarnings > 0) {
      console.log(
        `Game doctor: ${summary.total} game(s) passing with ${summary.withWarnings} warning(s).`,
      );
    } else {
      console.log(`Game doctor: all ${summary.total} game(s) look healthy!`);
    }
  }
}

await main();
