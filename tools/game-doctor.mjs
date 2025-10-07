import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HEALTH_DIR = path.join(ROOT, 'health');
const REPORT_JSON = path.join(HEALTH_DIR, 'report.json');
const REPORT_MD = path.join(HEALTH_DIR, 'report.md');
const DEFAULT_BASELINE = path.join(HEALTH_DIR, 'baseline.json');
const PLACEHOLDER_THUMB = 'assets/placeholder-thumb.png';
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

function formatIssue(message, context = {}) {
  return {
    message,
    context,
  };
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

function analyzeChangedFiles(files) {
  const slugs = new Set();

  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
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
    }
  }

  return { slugs, reason: null };
}

async function detectChangedSlugs() {
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
      const analysis = analyzeChangedFiles(files);
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
  if (report.manifest) {
    lines.push(`- Manifest version: ${report.manifest.version ?? 'unknown'}`);
    lines.push(`- Manifest source: ${report.manifest.source ?? relativeFromRoot(MANIFEST_PATH)}`);
  }
  lines.push('');
  for (const game of report.games) {
    lines.push(`## ${game.title ?? game.slug ?? 'Unknown Game'}`);
    lines.push('');
    lines.push(`- Slug: ${game.slug ?? 'N/A'}`);
    lines.push(`- Status: ${game.ok ? '✅ Healthy' : '❌ Needs attention'}`);
    if (game.shell?.found) {
      lines.push(`- Shell: ${game.shell.found}`);
    } else {
      lines.push(`- Shell: missing`);
    }
    lines.push(`- Thumbnail: ${game.thumbnail?.found ?? 'missing'}`);
    if (game.assets?.sprites?.length) {
      lines.push(`- Sprites checked: ${game.assets.sprites.length}`);
    }
    if (game.assets?.audio?.length) {
      lines.push(`- Audio checked: ${game.assets.audio.length}`);
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
      lines.push('- Issues:');
      for (const issue of game.issues) {
        lines.push(`  - ${issue.message}`);
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

function parseCliArgs() {
  const args = process.argv.slice(2);
  let strictMode = false;
  let baselinePath = DEFAULT_BASELINE;
  const cliSlugs = new Set();
  let changedRequested = false;

  for (const arg of args) {
    if (arg === '--strict') {
      strictMode = true;
    } else if (arg.startsWith('--baseline=')) {
      const value = arg.slice('--baseline='.length);
      if (value.trim()) {
        baselinePath = path.isAbsolute(value) ? value : path.join(ROOT, value);
      }
    } else if (arg === '--changed') {
      changedRequested = true;
    } else if (arg.startsWith('--slug=')) {
      const value = arg.slice('--slug='.length);
      for (const slug of parseSlugList(value)) {
        cliSlugs.add(slug);
      }
    }
  }

  return { strictMode, baselinePath, cliSlugs, changedRequested };
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
  const { strictMode, baselinePath, cliSlugs, changedRequested: initialChangedRequested } = parseCliArgs();

  const slugSources = new Map();
  for (const slug of cliSlugs) {
    addSlugSource(slugSources, slug, 'cli');
  }

  let changedRequested = initialChangedRequested;
  let forceEmptyFilter = false;

  if (changedRequested) {
    const detection = await detectChangedSlugs();
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

    let thumbnailFound = null;
    if (slug) {
      const thumbCandidates = [
        path.join(ROOT, 'assets', 'thumbs', `${slug}.png`),
        path.join(ROOT, 'games', slug, 'thumb.png'),
        path.join(ROOT, PLACEHOLDER_THUMB),
      ];
      for (const candidate of thumbCandidates) {
        // eslint-disable-next-line no-await-in-loop
        if (await pathExists(candidate)) {
          thumbnailFound = relativeFromRoot(candidate);
          break;
        }
      }
      if (!thumbnailFound) {
        issues.push(
          formatIssue('Thumbnail missing', {
            tried: thumbCandidates.map(relativeFromRoot),
          }),
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

    const result = {
      index,
      title,
      slug,
      ok: issues.length === 0,
      issues,
      shell: { found: foundShell },
      assets: {
        sprites: checkedSprites,
        audio: checkedAudio,
      },
      thumbnail: { found: thumbnailFound },
    };

    if (includeManifestDetails) {
      result.requirements = manifestCheck;
    }

    results.push(result);
  }

  const summary = {
    total: results.length,
    passing: results.filter((game) => game.ok).length,
    failing: results.filter((game) => !game.ok).length,
  };

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
      console.log(`Game doctor strict mode: all ${summary.total} game(s) look healthy!`);
    }
  } else if (summary.failing > 0) {
    console.error(
      `Game doctor found ${summary.failing} of ${summary.total} game(s) with issues. See ${relativeFromRoot(
        REPORT_JSON,
      )} for details.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`Game doctor: all ${summary.total} game(s) look healthy!`);
  }
}

await main();
