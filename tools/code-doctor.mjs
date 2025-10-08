import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HEALTH_DIR = path.join(ROOT, 'health');
const REPORT_MD = path.join(HEALTH_DIR, 'code-report.md');
const REPORT_JSON = path.join(HEALTH_DIR, 'code-report.json');
const BASELINE_JSON = path.join(HEALTH_DIR, 'code-baseline.json');

const SYNTAX_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);
const IMPORT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const UNUSED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const RELATIVE_IMPORT_RESOLVE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'];
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.hg',
  '.svn',
  'coverage',
  'build',
  '.next',
  '.turbo',
]);
const UNUSED_ANALYSIS_EXCLUSIONS = [path.join('games', 'chess3d', 'ai', 'stockfish.js')];
const DEFAULT_CONCURRENCY = (() => {
  const cpuCount = Array.isArray(os.cpus()) ? os.cpus().length : 0;
  if (!cpuCount || Number.isNaN(cpuCount)) {
    return 4;
  }
  return Math.min(Math.max(cpuCount, 2), 12);
})();
const OPTIONAL_TOOL_CONFIG = [
  {
    key: 'eslint',
    label: 'ESLint',
    packageName: 'eslint',
    command: ['eslint', '.', '--max-warnings=0'],
  },
  {
    key: 'prettier',
    label: 'Prettier',
    packageName: 'prettier',
    command: ['prettier', '--check', '.'],
  },
  {
    key: 'typescript',
    label: 'TypeScript',
    packageName: 'typescript',
    command: ['tsc', '--noEmit'],
  },
];

const SCORE_RULES = {
  syntax: {
    failed: { base: 40, perIssue: 5 },
    issues: { base: 10, perIssue: 2 },
  },
  eslint: {
    failed: { base: 20, perIssue: 2 },
  },
  prettier: {
    failed: { base: 10, perIssue: 1 },
  },
  typescript: {
    failed: { base: 20, perIssue: 2 },
  },
  imports: {
    failed: { base: 15, perIssue: 2 },
    issues: { base: 5, perIssue: 1 },
  },
  circular: {
    failed: { base: 25, perIssue: 3 },
    issues: { base: 10, perIssue: 2 },
  },
  unused: {
    failed: { base: 10, perIssue: 2 },
    issues: { base: 5, perIssue: 1 },
  },
};

const BABEL_PARSER_OPTIONS = {
  sourceType: 'unambiguous',
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: false,
  plugins: [
    'jsx',
    'typescript',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'decorators-legacy',
    'dynamicImport',
    'importMeta',
    'topLevelAwait',
    'exportDefaultFrom',
    'exportNamespaceFrom',
    'optionalChaining',
    'nullishCoalescingOperator',
    'objectRestSpread',
  ],
};

const TYPE_DECLARATION_TESTERS = [
  'isTSTypeAliasDeclaration',
  'isTSInterfaceDeclaration',
  'isTSModuleDeclaration',
  'isTSImportEqualsDeclaration',
  'isTSEnumDeclaration',
  'isTSDeclareFunction',
];

function createDefaultResult(label) {
  return {
    label,
    status: 'skipped',
    summary: 'Not run.',
    ran: false,
    issues: [],
    output: '',
    exitCode: 0,
  };
}

async function ensureHealthDir() {
  await fs.mkdir(HEALTH_DIR, { recursive: true });
}

async function readPackageJson() {
  try {
    const raw = await fs.readFile(path.join(ROOT, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

function hasDependency(pkg, name) {
  if (!pkg || typeof pkg !== 'object') {
    return false;
  }
  const sections = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ];
  return sections.some((section) =>
    pkg[section] && Object.prototype.hasOwnProperty.call(pkg[section], name),
  );
}

async function readBaselineScore() {
  try {
    const raw = await fs.readFile(BASELINE_JSON, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.value === 'number') {
        return {
          score: {
            value: parsed.value,
            breakdown: Array.isArray(parsed.breakdown) ? parsed.breakdown : [],
          },
          generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : null,
        };
      }
      if (parsed.score && typeof parsed.score === 'object' && typeof parsed.score.value === 'number') {
        return {
          score: {
            value: parsed.score.value,
            breakdown: Array.isArray(parsed.score.breakdown)
              ? parsed.score.breakdown
              : [],
          },
          generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : null,
        };
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return null;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Failed to read ${relativePath(BASELINE_JSON)}: ${message}\n`,
    );
  }
  return null;
}

async function writeBaselineScore(score, generatedAt) {
  const payload = {
    generatedAt,
    score,
  };
  await fs.writeFile(BASELINE_JSON, JSON.stringify(payload, null, 2), 'utf8');
}

async function collectFiles(startDir) {
  const pending = [startDir];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }
        pending.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function statusSymbol(status) {
  switch (status) {
    case 'passed':
      return '✅';
    case 'failed':
      return '❌';
    case 'issues':
      return '⚠️';
    case 'skipped':
      return '⚪️';
    default:
      return 'ℹ️';
  }
}

function formatMarkdownBlock(content) {
  return ['```', content.trimEnd(), '```'].join('\n');
}

function formatScoreValue(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  return Number(value).toFixed(2);
}

function matchesTypeDeclaration(pathRef) {
  if (!pathRef) {
    return false;
  }
  return TYPE_DECLARATION_TESTERS.some((method) =>
    typeof pathRef[method] === 'function' ? pathRef[method]() : false,
  );
}

function isTypeOnlyDeclaration(bindingPath) {
  if (!bindingPath) {
    return false;
  }
  if (matchesTypeDeclaration(bindingPath)) {
    return true;
  }
  const declaringParent = bindingPath.findParent((parent) => {
    if (matchesTypeDeclaration(parent)) {
      return true;
    }
    if (
      (typeof parent.isVariableDeclaration === 'function' && parent.isVariableDeclaration()) ||
      (typeof parent.isFunctionDeclaration === 'function' && parent.isFunctionDeclaration()) ||
      (typeof parent.isClassDeclaration === 'function' && parent.isClassDeclaration())
    ) {
      return Boolean(parent.node && parent.node.declare);
    }
    return false;
  });
  if (!declaringParent) {
    return false;
  }
  if (matchesTypeDeclaration(declaringParent)) {
    return true;
  }
  if (
    (typeof declaringParent.isVariableDeclaration === 'function' && declaringParent.isVariableDeclaration()) ||
    (typeof declaringParent.isFunctionDeclaration === 'function' && declaringParent.isFunctionDeclaration()) ||
    (typeof declaringParent.isClassDeclaration === 'function' && declaringParent.isClassDeclaration())
  ) {
    return Boolean(declaringParent.node && declaringParent.node.declare);
  }
  return false;
}

function isBindingExported(bindingPath) {
  if (!bindingPath) {
    return false;
  }
  const exportParent = bindingPath.findParent((parent) => {
    if (typeof parent.isExportNamedDeclaration === 'function' && parent.isExportNamedDeclaration()) {
      return true;
    }
    if (typeof parent.isExportDefaultDeclaration === 'function' && parent.isExportDefaultDeclaration()) {
      return true;
    }
    if (typeof parent.isExportSpecifier === 'function' && parent.isExportSpecifier()) {
      return true;
    }
    return false;
  });
  return Boolean(exportParent);
}

function isTypeOnlyImport(binding) {
  if (!binding || !binding.path) {
    return false;
  }
  const pathRef = binding.path;
  if (
    (typeof pathRef.isImportSpecifier === 'function' && pathRef.isImportSpecifier()) ||
    (typeof pathRef.isImportDefaultSpecifier === 'function' && pathRef.isImportDefaultSpecifier()) ||
    (typeof pathRef.isImportNamespaceSpecifier === 'function' && pathRef.isImportNamespaceSpecifier())
  ) {
    if (pathRef.node && pathRef.node.importKind === 'type') {
      return true;
    }
    if (pathRef.parentPath && pathRef.parentPath.node && pathRef.parentPath.node.importKind === 'type') {
      return true;
    }
  }
  return false;
}

function shouldSkipUnusedAnalysis(filePath) {
  if (UNUSED_ANALYSIS_EXCLUSIONS.some((relativePath) => filePath.endsWith(relativePath))) {
    return true;
  }
  return filePath.endsWith('.d.ts');
}

function createUnusedIssue(filePath, type, name, loc) {
  const line = loc && loc.start ? loc.start.line : null;
  const column = loc && loc.start && typeof loc.start.column === 'number' ? loc.start.column + 1 : null;
  const message =
    type === 'import'
      ? `Unused import \`${name}\` may be removed.`
      : type === 'variable'
        ? `Unused variable \`${name}\` may be removed.`
        : `Unable to analyze \`${name}\`.`;
  return {
    file: relativePath(filePath),
    type,
    name,
    line,
    column,
    message,
  };
}

function analyzeUnusedBindings(ast, filePath) {
  const unused = [];
  traverse(ast, {
    Program(pathProgram) {
      const bindings = pathProgram.scope.getAllBindings();
      for (const binding of Object.values(bindings)) {
        if (!binding || !binding.identifier) {
          continue;
        }
        const { identifier } = binding;
        const name = identifier.name;
        if (!name || name.startsWith('_')) {
          continue;
        }
        if (binding.kind === 'param' || binding.kind === 'unknown' || binding.kind === 'global') {
          continue;
        }
        if (binding.kind === 'module') {
          if (binding.referenced) {
            continue;
          }
          if (isTypeOnlyImport(binding)) {
            continue;
          }
          if (isBindingExported(binding.path)) {
            continue;
          }
          unused.push(createUnusedIssue(filePath, 'import', name, identifier.loc));
          continue;
        }
        if (!binding.referenced) {
          if (isBindingExported(binding.path)) {
            continue;
          }
          if (isTypeOnlyDeclaration(binding.path)) {
            continue;
          }
          unused.push(createUnusedIssue(filePath, 'variable', name, identifier.loc));
        }
      }
      pathProgram.stop();
    },
  });
  return unused;
}

async function runWithConcurrency(items, worker, limit = DEFAULT_CONCURRENCY) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const boundedLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_CONCURRENCY;

  return new Promise((resolve, reject) => {
    const results = new Array(items.length);
    let nextIndex = 0;
    let active = 0;

    const launch = () => {
      if (nextIndex >= items.length) {
        if (active === 0) {
          resolve(results);
        }
        return;
      }

      const currentIndex = nextIndex++;
      active += 1;

      Promise.resolve(worker(items[currentIndex], currentIndex))
        .then((result) => {
          results[currentIndex] = result;
        })
        .catch((error) => {
          reject(error);
        })
        .finally(() => {
          active -= 1;
          if (nextIndex < items.length) {
            launch();
          } else if (active === 0) {
            resolve(results);
          }
        });
    };

    const initial = Math.min(boundedLimit, items.length);
    for (let i = 0; i < initial; i += 1) {
      launch();
    }
  });
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: stderr + error.message });
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runSyntaxCheck(files, result) {
  if (files.length === 0) {
    result.status = 'passed';
    result.summary = 'No JavaScript files found.';
    result.ran = false;
    return;
  }
  result.ran = true;
  const issues = [];
  await runWithConcurrency(files, async (filePath) => {
    const checkResult = await runCommand('node', ['--check', filePath]);
    if (checkResult.code !== 0) {
      issues.push({
        file: relativePath(filePath),
        output:
          (checkResult.stderr || checkResult.stdout || '').trim() ||
          'Unknown syntax error.',
      });
    }
  });
  if (issues.length === 0) {
    result.status = 'passed';
    result.summary = `Checked ${files.length} file${files.length === 1 ? '' : 's'}.`;
  } else {
    result.status = 'failed';
    result.summary = `${issues.length} file${issues.length === 1 ? '' : 's'} with syntax errors.`;
    result.issues = issues;
  }
}

async function runOptionalTools(pkgJson, resultMap) {
  for (const config of OPTIONAL_TOOL_CONFIG) {
    const result = resultMap[config.key];
    if (!hasDependency(pkgJson, config.packageName)) {
      result.status = 'skipped';
      result.summary = `${config.label} not installed.`;
      continue;
    }
    const commandResult = await runCommand('npx', config.command);
    result.ran = true;
    result.exitCode = commandResult.code ?? 1;
    result.output = (commandResult.stdout + commandResult.stderr).trim();
    if (commandResult.code === 0) {
      result.status = 'passed';
      result.summary = `${config.label} passed.`;
    } else {
      result.status = 'failed';
      result.summary = `${config.label} failed.`;
    }
  }
}

function normalizeImportSpecifier(specifier) {
  const cleaned = specifier.split('?')[0].split('#')[0];
  return cleaned;
}

function isRelativeImportSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function findImportSpecifiers(content) {
  const fromRegex = /from\s+['"]([^'"]+)['"]/g;
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const importCallRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const specifiers = [];
  let match;
  while ((match = fromRegex.exec(content)) != null) {
    specifiers.push(match[1]);
  }
  while ((match = requireRegex.exec(content)) != null) {
    specifiers.push(match[1]);
  }
  while ((match = importCallRegex.exec(content)) != null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

async function resolveRelativeImport(filePath, specifier, existenceCache, extensions) {
  if (!isRelativeImportSpecifier(specifier)) {
    return null;
  }

  const normalized = normalizeImportSpecifier(specifier);
  const baseDir = path.dirname(filePath);
  const targetBase = path.resolve(baseDir, normalized);
  const candidates = [];
  const seen = new Set();
  const extensionCandidates = extensions && extensions.length > 0 ? extensions : RELATIVE_IMPORT_RESOLVE_EXTENSIONS;

  const addCandidate = (candidate) => {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      candidates.push(candidate);
    }
  };

  addCandidate(targetBase);
  if (!path.extname(targetBase)) {
    for (const ext of extensionCandidates) {
      addCandidate(`${targetBase}${ext}`);
    }
  }
  for (const ext of extensionCandidates) {
    addCandidate(path.join(targetBase, `index${ext}`));
  }

  const getExists = async (candidate) => {
    if (existenceCache && existenceCache.has(candidate)) {
      return existenceCache.get(candidate);
    }
    try {
      const stat = await fs.stat(candidate);
      const exists = stat.isFile();
      if (existenceCache) {
        existenceCache.set(candidate, exists);
      }
      return exists;
    } catch {
      if (existenceCache) {
        existenceCache.set(candidate, false);
      }
      return false;
    }
  };

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await getExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function toPosixPath(value) {
  return value.replace(/\\/g, '/');
}

let gitTrackedFilesPromise = null;

async function getGitTrackedFiles() {
  if (gitTrackedFilesPromise) {
    return gitTrackedFilesPromise;
  }

  gitTrackedFilesPromise = (async () => {
    try {
      const { code, stdout } = await runCommand('git', ['ls-files']);
      if (code !== 0) {
        return [];
      }
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => toPosixPath(line));
    } catch {
      return [];
    }
  })();

  return gitTrackedFilesPromise;
}

function buildCaseSensitivityChecker(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return null;
  }

  const normalizedFiles = files.map((file) => toPosixPath(file));
  const fileMap = new Map();
  const dirMap = new Map();
  const extensions = new Set();

  dirMap.set('.', '.');

  for (const file of normalizedFiles) {
    const lowerFile = file.toLowerCase();
    if (!fileMap.has(lowerFile)) {
      fileMap.set(lowerFile, file);
    }

    const ext = path.posix.extname(file);
    if (ext) {
      extensions.add(ext);
    }

    let dir = path.posix.dirname(file);
    while (dir && dir !== '.' && dir !== '/') {
      const lowerDir = dir.toLowerCase();
      if (!dirMap.has(lowerDir)) {
        dirMap.set(lowerDir, dir);
      }
      const next = path.posix.dirname(dir);
      if (next === dir) {
        break;
      }
      dir = next;
    }
    if (dir === '.' || dir === '/') {
      dirMap.set('.', '.');
    }
  }

  const defaultExtensions = [''];
  for (const ext of extensions) {
    defaultExtensions.push(ext);
  }

  const seenCandidate = new Set();

  const resolveCandidates = (importer, specifier) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      return [];
    }

    const importerPosix = toPosixPath(importer);
    const normalizedSpecifier = toPosixPath(specifier);
    let relativeCandidate;

    if (normalizedSpecifier.startsWith('/')) {
      relativeCandidate = normalizedSpecifier.slice(1);
    } else {
      const importerDir = path.posix.dirname(importerPosix);
      const joined = path.posix.join(
        importerDir === '.' ? '' : importerDir,
        normalizedSpecifier,
      );
      relativeCandidate = path.posix.normalize(joined);
    }

    const cleanCandidate = relativeCandidate.replace(/\\/g, '/');
    const candidates = [];

    const addCandidate = (candidate) => {
      const normalized = candidate.replace(/\\/g, '/');
      const lower = normalized.toLowerCase();
      const key = `${lower}`;
      if (!seenCandidate.has(key)) {
        seenCandidate.add(key);
        candidates.push(normalized);
      }
    };

    seenCandidate.clear();
    addCandidate(cleanCandidate);
    for (const ext of defaultExtensions) {
      addCandidate(`${cleanCandidate}${ext}`);
    }
    for (const ext of defaultExtensions) {
      addCandidate(path.posix.join(cleanCandidate, `index${ext}`));
    }

    return candidates;
  };

  const checkImportCase = (importer, specifier) => {
    const candidates = resolveCandidates(importer, specifier);
    for (const candidate of candidates) {
      const lower = candidate.toLowerCase();
      if (fileMap.has(lower)) {
        const actual = fileMap.get(lower);
        if (actual !== candidate) {
          return { expected: actual, actual: candidate };
        }
        return null;
      }
      if (dirMap.has(lower)) {
        const actualDir = dirMap.get(lower);
        if (actualDir !== candidate) {
          return { expected: actualDir, actual: candidate };
        }
      }
    }
    return null;
  };

  return { checkImportCase };
}

let caseSensitivityCheckerPromise = null;

async function getCaseSensitivityChecker() {
  if (caseSensitivityCheckerPromise) {
    return caseSensitivityCheckerPromise;
  }

  caseSensitivityCheckerPromise = (async () => {
    const files = await getGitTrackedFiles();
    return buildCaseSensitivityChecker(files);
  })();

  return caseSensitivityCheckerPromise;
}

async function checkImportTargets(files, result) {
  if (files.length === 0) {
    result.status = 'passed';
    result.summary = 'No modules to scan.';
    result.ran = false;
    return;
  }
  result.ran = true;
  const existenceCache = new Map();

  const missing = [];
  const caseMismatches = [];
  const caseChecker = await getCaseSensitivityChecker();

  await runWithConcurrency(files, async (filePath) => {
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      return;
    }
    const specs = findImportSpecifiers(content);

    for (const rawSpecifier of specs) {
      const specifier = normalizeImportSpecifier(rawSpecifier);
      if (!isRelativeImportSpecifier(specifier)) {
        continue;
      }
      let hasCaseMismatch = false;
      if (caseChecker) {
        const caseIssue = caseChecker.checkImportCase(
          relativePath(filePath),
          specifier,
        );
        if (caseIssue) {
          caseMismatches.push({
            type: 'case-mismatch',
            file: relativePath(filePath),
            specifier: rawSpecifier,
            expected: caseIssue.expected,
            actual: caseIssue.actual,
          });
          hasCaseMismatch = true;
        }
      }
      const resolved = await resolveRelativeImport(
        filePath,
        specifier,
        existenceCache,
        RELATIVE_IMPORT_RESOLVE_EXTENSIONS,
      );
      if (!resolved && !hasCaseMismatch) {
        missing.push({
          type: 'missing',
          file: relativePath(filePath),
          specifier: rawSpecifier,
        });
      }
    }
  });
  if (missing.length === 0 && caseMismatches.length === 0) {
    result.status = 'passed';
    result.summary = 'All relative imports resolved.';
  } else {
    result.status = 'issues';
    const parts = [];
    if (missing.length > 0) {
      parts.push(
        `${missing.length} missing relative import${missing.length === 1 ? '' : 's'}`,
      );
    }
    if (caseMismatches.length > 0) {
      parts.push(
        `${caseMismatches.length} case mismatch${caseMismatches.length === 1 ? '' : 'es'}`,
      );
    }
    result.summary = `${parts.join(' and ')}.`;
    result.issues = missing.concat(caseMismatches);
  }
}

function canonicalizeCycle(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { key: '', path: [] };
  }

  const withoutTerminal = nodes[nodes.length - 1] === nodes[0] ? nodes.slice(0, -1) : nodes.slice();
  if (withoutTerminal.length === 0) {
    const single = relativePath(nodes[0]);
    return { key: single, path: [single, single] };
  }

  const relativeNodes = withoutTerminal.map((node) => relativePath(node));
  let bestIndex = 0;
  for (let i = 1; i < relativeNodes.length; i += 1) {
    if (relativeNodes[i].localeCompare(relativeNodes[bestIndex]) < 0) {
      bestIndex = i;
    }
  }

  const ordered = [];
  for (let i = 0; i < relativeNodes.length; i += 1) {
    ordered.push(relativeNodes[(bestIndex + i) % relativeNodes.length]);
  }
  ordered.push(ordered[0]);

  return { key: ordered.join(' -> '), path: ordered };
}

async function checkCircularDependencies(files, result) {
  const candidates = files.filter((filePath) =>
    IMPORT_EXTENSIONS.has(path.extname(filePath)),
  );

  if (candidates.length === 0) {
    result.status = 'passed';
    result.summary = 'No modules to scan for circular dependencies.';
    result.ran = false;
    return;
  }

  result.ran = true;
  const existenceCache = new Map();
  const graph = new Map();
  const analysisIssues = [];

  const dependencyResults = await runWithConcurrency(candidates, async (filePath) => {
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      return {
        filePath,
        error: error instanceof Error ? error.message : String(error),
        dependencies: [],
      };
    }

    const specifiers = findImportSpecifiers(content);
    const dependencies = [];
    for (const specifier of specifiers) {
      if (!isRelativeImportSpecifier(specifier)) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const resolved = await resolveRelativeImport(
        filePath,
        specifier,
        existenceCache,
        RELATIVE_IMPORT_RESOLVE_EXTENSIONS,
      );
      if (resolved) {
        dependencies.push(path.resolve(resolved));
      }
    }

    return { filePath, dependencies };
  });

  for (const entry of dependencyResults) {
    if (!entry) {
      continue;
    }
    const absolutePath = path.resolve(entry.filePath);
    if (entry.error) {
      analysisIssues.push({
        type: 'read-error',
        file: relativePath(entry.filePath),
        message: entry.error,
      });
      graph.set(absolutePath, new Set());
      continue;
    }
    graph.set(absolutePath, new Set(entry.dependencies));
  }

  for (const deps of graph.values()) {
    for (const dep of deps) {
      if (!graph.has(dep)) {
        graph.set(dep, new Set());
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cycles = [];
  const seenCycles = new Set();

  const dfs = (node) => {
    if (visiting.has(node)) {
      const cycleStart = stack.indexOf(node);
      if (cycleStart !== -1) {
        const cycleNodes = stack.slice(cycleStart).concat(node);
        const canonical = canonicalizeCycle(cycleNodes);
        if (canonical.key && !seenCycles.has(canonical.key)) {
          seenCycles.add(canonical.key);
          cycles.push(canonical.path);
        }
      }
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    stack.push(node);
    const neighbors = graph.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (!graph.has(neighbor)) {
        continue;
      }
      dfs(neighbor);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  const issues = [];
  if (cycles.length > 0) {
    for (const cycle of cycles) {
      issues.push({
        type: 'cycle',
        files: cycle,
        message: cycle.join(' -> '),
      });
    }
  }
  if (analysisIssues.length > 0) {
    issues.push(...analysisIssues);
  }

  if (cycles.length > 0) {
    const summaryParts = [`${cycles.length} circular dependenc${cycles.length === 1 ? 'y' : 'ies'} detected`];
    if (analysisIssues.length > 0) {
      summaryParts.push(
        `${analysisIssues.length} file${analysisIssues.length === 1 ? '' : 's'} could not be analyzed`,
      );
    }
    result.status = 'failed';
    result.summary = summaryParts.join('; ');
    result.issues = issues;
    return;
  }

  if (analysisIssues.length > 0) {
    result.status = 'issues';
    result.summary = `${analysisIssues.length} file${analysisIssues.length === 1 ? '' : 's'} could not be analyzed.`;
    result.issues = analysisIssues;
    return;
  }

  result.status = 'passed';
  result.summary = `Scanned ${graph.size} module${graph.size === 1 ? '' : 's'} with no circular dependencies detected.`;
}

async function checkUnusedCode(files, result) {
  const candidates = files.filter(
    (filePath) => UNUSED_EXTENSIONS.has(path.extname(filePath)) && !shouldSkipUnusedAnalysis(filePath),
  );
  if (candidates.length === 0) {
    result.status = 'passed';
    result.summary = 'No files eligible for unused code analysis.';
    result.ran = false;
    return;
  }
  result.ran = true;
  const issues = [];
  await runWithConcurrency(candidates, async (filePath) => {
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      issues.push({
        file: relativePath(filePath),
        type: 'read-error',
        name: path.basename(filePath),
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let ast;
    try {
      ast = parse(content, { ...BABEL_PARSER_OPTIONS, sourceFilename: filePath });
    } catch (error) {
      issues.push({
        file: relativePath(filePath),
        type: 'parse-error',
        name: path.basename(filePath),
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    try {
      const fileIssues = analyzeUnusedBindings(ast, filePath);
      if (fileIssues.length > 0) {
        issues.push(...fileIssues);
      }
    } catch (error) {
      issues.push({
        file: relativePath(filePath),
        type: 'analysis-error',
        name: path.basename(filePath),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  if (issues.length === 0) {
    result.status = 'passed';
    result.summary = `No unused imports or variables detected across ${candidates.length} file${candidates.length === 1 ? '' : 's'}.`;
    return;
  }

  issues.sort((a, b) => {
    const fileDiff = a.file.localeCompare(b.file);
    if (fileDiff !== 0) {
      return fileDiff;
    }
    const lineDiff = (a.line ?? 0) - (b.line ?? 0);
    if (lineDiff !== 0) {
      return lineDiff;
    }
    const columnDiff = (a.column ?? 0) - (b.column ?? 0);
    if (columnDiff !== 0) {
      return columnDiff;
    }
    return (a.type || '').localeCompare(b.type || '');
  });

  const counts = issues.reduce(
    (acc, issue) => {
      if (issue.type === 'import') {
        acc.imports += 1;
      } else if (issue.type === 'variable') {
        acc.variables += 1;
      } else {
        acc.failures += 1;
      }
      return acc;
    },
    { imports: 0, variables: 0, failures: 0 },
  );

  const summaryParts = [];
  const unusedCount = counts.imports + counts.variables;
  if (unusedCount > 0) {
    summaryParts.push(`${unusedCount} unused binding${unusedCount === 1 ? '' : 's'}`);
  }
  if (counts.failures > 0) {
    summaryParts.push(`${counts.failures} file${counts.failures === 1 ? '' : 's'} could not be analyzed`);
  }
  result.status = 'issues';
  result.summary = summaryParts.join('; ') || 'Unused code detected.';
  result.issues = issues;
}

function buildMarkdownReport(
  generatedAt,
  overallStatus,
  exitCode,
  results,
  fatalError,
  scoreDetails,
) {
  const lines = [];
  lines.push('# Code Doctor Report');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push(`Overall Status: ${statusSymbol(overallStatus)} ${overallStatus}`);
  lines.push('');

  const scoreValue = scoreDetails?.current ? formatScoreValue(scoreDetails.current.value) : null;
  const baselineValue = scoreDetails?.previous ? formatScoreValue(scoreDetails.previous.value) : null;
  const diffValue =
    typeof scoreDetails?.diff === 'number' && !Number.isNaN(scoreDetails.diff)
      ? formatScoreValue(scoreDetails.diff)
      : null;

  lines.push('## Code Health');
  lines.push('');
  if (scoreValue) {
    lines.push(`Score: **${scoreValue} / 100**`);
  } else {
    lines.push('Score: Unable to compute.');
  }

  if (baselineValue) {
    const diffPrefix = diffValue ? (Number(scoreDetails.diff) >= 0 ? '+' : '') : '';
    const diffLabel = diffValue ? ` (${diffPrefix}${diffValue} vs. baseline)` : '';
    lines.push(`Baseline: ${baselineValue} / 100${diffLabel}`);
    if (scoreDetails?.previousGeneratedAt) {
      lines.push(`Baseline Recorded: ${scoreDetails.previousGeneratedAt}`);
    }
  } else if (scoreDetails?.updated) {
    if (scoreValue) {
      lines.push(`Baseline: Initialized to ${scoreValue} / 100.`);
    } else {
      lines.push('Baseline: Initialized to current score.');
    }
  } else {
    lines.push('Baseline: Not available.');
  }

  if (scoreDetails?.updated) {
    lines.push(`Baseline updated (${scoreDetails.baselinePath}).`);
  } else if (scoreDetails?.updateRequested && scoreDetails?.updateError) {
    lines.push(`Baseline update skipped: ${scoreDetails.updateError}`);
  }

  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Check | Status | Details |');
  lines.push('| --- | --- | --- |');
  for (const key of ['syntax', 'eslint', 'prettier', 'typescript', 'imports', 'circular', 'unused']) {
    const result = results[key];
    const detail = result.summary || '';
    lines.push(`| ${result.label} | ${statusSymbol(result.status)} ${result.status} | ${detail.replace(/\n/g, ' ')} |`);
  }
  lines.push('');

  if (fatalError) {
    lines.push('## Errors');
    lines.push('');
    lines.push('The Code Doctor encountered a fatal error:');
    lines.push('');
    lines.push(formatMarkdownBlock(fatalError));
    lines.push('');
  }

  const syntaxResult = results.syntax;
  lines.push('## Checks');
  lines.push('');

  lines.push('### Syntax');
  lines.push('');
  lines.push(`Status: ${statusSymbol(syntaxResult.status)} ${syntaxResult.status}`);
  lines.push('');
  if (syntaxResult.issues.length === 0) {
    lines.push(syntaxResult.summary || 'No syntax issues found.');
  } else {
    lines.push(syntaxResult.summary || 'Syntax issues found:');
    lines.push('');
    for (const issue of syntaxResult.issues) {
      lines.push(`- **${issue.file}**`);
      if (issue.output) {
        lines.push('');
        lines.push(formatMarkdownBlock(issue.output));
        lines.push('');
      }
    }
  }
  lines.push('');

  for (const key of ['eslint', 'prettier', 'typescript']) {
    const result = results[key];
    lines.push(`### ${result.label}`);
    lines.push('');
    lines.push(`Status: ${statusSymbol(result.status)} ${result.status}`);
    lines.push('');
    if (result.output) {
      lines.push(result.summary || '');
      lines.push('');
      lines.push(formatMarkdownBlock(result.output));
    } else {
      lines.push(result.summary || '');
    }
    lines.push('');
  }

  const importResult = results.imports;
  lines.push('### Relative Imports');
  lines.push('');
  lines.push(`Status: ${statusSymbol(importResult.status)} ${importResult.status}`);
  lines.push('');
  if (importResult.issues.length === 0) {
    lines.push(importResult.summary || 'All relative imports resolved.');
  } else {
    lines.push(importResult.summary || 'Relative import issues detected:');
    lines.push('');
    for (const issue of importResult.issues) {
      if (issue.type === 'case-mismatch') {
        const details = issue.expected
          ? ` (case mismatch: expected \`${issue.expected}\`, imported \`${issue.actual}\`)`
          : ' (case mismatch)';
        lines.push(`- **${issue.file}** → \`${issue.specifier}\`${details}`);
      } else if (issue.type === 'missing') {
        lines.push(`- **${issue.file}** → \`${issue.specifier}\` (missing)`);
      } else {
        lines.push(`- **${issue.file}** → \`${issue.specifier}\``);
      }
    }
  }
  lines.push('');

  const circularResult = results.circular;
  lines.push('### Circular Dependencies');
  lines.push('');
  lines.push(`Status: ${statusSymbol(circularResult.status)} ${circularResult.status}`);
  lines.push('');
  if (circularResult.issues.length === 0) {
    lines.push(circularResult.summary || 'No circular dependencies detected.');
  } else {
    lines.push(circularResult.summary || 'Circular dependencies detected:');
    lines.push('');
    for (const issue of circularResult.issues) {
      if (issue.type === 'cycle') {
        lines.push(`- ${issue.message}`);
      } else if (issue.type === 'read-error') {
        lines.push(`- **${issue.file}** (read error)${issue.message ? ` — ${issue.message}` : ''}`);
      } else {
        lines.push(`- ${issue.message || 'Analysis issue.'}`);
      }
    }
  }
  lines.push('');

  const unusedResult = results.unused;
  lines.push('### Unused Code');
  lines.push('');
  lines.push(`Status: ${statusSymbol(unusedResult.status)} ${unusedResult.status}`);
  lines.push('');
  if (unusedResult.issues.length === 0) {
    lines.push(unusedResult.summary || 'No unused imports or variables detected.');
  } else {
    lines.push(unusedResult.summary || 'Unused code detected:');
    lines.push('');
    for (const issue of unusedResult.issues) {
      const location = issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : '';
      const label =
        issue.type === 'import'
          ? 'Unused import'
          : issue.type === 'variable'
            ? 'Unused variable'
            : 'Analysis issue';
      const message = issue.message ? ` — ${issue.message}` : '';
      lines.push(`- **${issue.file}${location}** (${label})${message}`);
    }
  }
  lines.push('');

  lines.push(`Exit Code: ${exitCode}`);
  lines.push('');

  return lines.join('\n');
}

function computeHealthScore(results) {
  let score = 100;
  const breakdown = [];

  for (const [key, ruleByStatus] of Object.entries(SCORE_RULES)) {
    const result = results[key];
    if (!result) {
      continue;
    }

    const statusRule = ruleByStatus[result.status];
    if (!statusRule) {
      continue;
    }

    const base = typeof statusRule.base === 'number' ? statusRule.base : 0;
    const perIssue = typeof statusRule.perIssue === 'number' ? statusRule.perIssue : 0;
    let issueCount = Array.isArray(result.issues) ? result.issues.length : 0;
    if (issueCount === 0 && (result.status === 'failed' || result.status === 'issues')) {
      issueCount = 1;
    }

    const penalty = base + perIssue * issueCount;
    if (penalty <= 0) {
      continue;
    }

    score -= penalty;
    breakdown.push({
      check: result.label ?? key,
      status: result.status,
      issues: issueCount,
      penalty,
      base,
      perIssue,
    });
  }

  const normalized = Math.max(0, Math.min(100, Number(score.toFixed(2))));

  return {
    value: normalized,
    breakdown,
  };
}

function buildJsonReport(
  generatedAt,
  overallStatus,
  exitCode,
  results,
  fatalError,
  scoreDetails,
) {
  const serialized = {
    generatedAt,
    overallStatus,
    exitCode,
    checks: {
      syntax: results.syntax,
      eslint: results.eslint,
      prettier: results.prettier,
      typescript: results.typescript,
      imports: results.imports,
      circular: results.circular,
      unused: results.unused,
    },
    score: scoreDetails?.current ?? null,
  };
  if (scoreDetails) {
    const baseline = {};
    if (scoreDetails.previous) {
      baseline.previous = scoreDetails.previous;
    }
    if (typeof scoreDetails.diff === 'number' && !Number.isNaN(scoreDetails.diff)) {
      baseline.diff = Number(scoreDetails.diff.toFixed(2));
    }
    if (scoreDetails.previousGeneratedAt) {
      baseline.previousGeneratedAt = scoreDetails.previousGeneratedAt;
    }
    if (
      scoreDetails.baselinePath &&
      (scoreDetails.previous || scoreDetails.updateRequested || scoreDetails.updated || scoreDetails.updateError)
    ) {
      baseline.path = scoreDetails.baselinePath;
    }
    if (scoreDetails.updateRequested) {
      baseline.updateRequested = true;
    }
    if (scoreDetails.updated) {
      baseline.updated = true;
    }
    if (scoreDetails.updateError) {
      baseline.updateError = scoreDetails.updateError;
    }
    if (Object.keys(baseline).length > 0) {
      serialized.baseline = baseline;
    }
  }
  if (fatalError) {
    serialized.error = fatalError;
  }
  return JSON.stringify(serialized, null, 2);
}

async function main() {
  await ensureHealthDir();

  const results = {
    syntax: createDefaultResult('Syntax'),
    eslint: createDefaultResult('ESLint'),
    prettier: createDefaultResult('Prettier'),
    typescript: createDefaultResult('TypeScript'),
    imports: createDefaultResult('Relative Imports'),
    circular: createDefaultResult('Circular Dependencies'),
    unused: createDefaultResult('Unused Code'),
  };

  let fatalErrorMessage = '';
  let exitCode = 0;
  const generatedAt = new Date().toISOString();

  try {
    const pkgJson = await readPackageJson();
    const allFiles = await collectFiles(ROOT);
    const syntaxFiles = allFiles.filter((filePath) =>
      SYNTAX_EXTENSIONS.has(path.extname(filePath)),
    );
    const importFiles = allFiles.filter((filePath) =>
      IMPORT_EXTENSIONS.has(path.extname(filePath)),
    );
    const unusedFiles = allFiles.filter((filePath) =>
      UNUSED_EXTENSIONS.has(path.extname(filePath)),
    );

    await runSyntaxCheck(syntaxFiles, results.syntax);
    await runOptionalTools(pkgJson, results);
    await checkImportTargets(importFiles, results.imports);
    await checkCircularDependencies(importFiles, results.circular);
    await checkUnusedCode(unusedFiles, results.unused);

    if (results.syntax.status === 'failed') {
      exitCode = 1;
    }
    if (results.typescript.ran && results.typescript.status === 'failed') {
      exitCode = 1;
    }
    if (results.eslint.ran && results.eslint.status === 'failed') {
      exitCode = 1;
    }
    if (results.prettier.ran && results.prettier.status === 'failed') {
      exitCode = 1;
    }
    if (results.circular.status === 'failed') {
      exitCode = 1;
    }
  } catch (error) {
    fatalErrorMessage = error instanceof Error ? error.stack || error.message : String(error);
    exitCode = 1;
  }

  const overallStatus = (() => {
    if (fatalErrorMessage) {
      return 'failed';
    }
    if (
      results.syntax.status === 'failed' ||
      (results.eslint.ran && results.eslint.status === 'failed') ||
      (results.prettier.ran && results.prettier.status === 'failed') ||
      (results.typescript.ran && results.typescript.status === 'failed') ||
      results.circular.status === 'failed'
    ) {
      return 'failed';
    }
    if (
      results.imports.status === 'issues' ||
      results.circular.status === 'issues' ||
      results.unused.status === 'issues'
    ) {
      return 'issues';
    }
    return 'passed';
  })();

  const currentScore = computeHealthScore(results);
  const baselineEntry = await readBaselineScore();
  const previousScore = baselineEntry?.score ?? null;
  const hasPreviousValue = previousScore && typeof previousScore.value === 'number';
  const scoreDiff = hasPreviousValue
    ? Number((currentScore.value - previousScore.value).toFixed(2))
    : null;
  const baselinePathRelative = relativePath(BASELINE_JSON);
  const updateRequested = Boolean(process.env.CODE_DOCTOR_UPDATE_BASELINE);
  let baselineUpdated = false;
  let baselineUpdateError = '';

  if (updateRequested) {
    if (exitCode === 0) {
      try {
        await writeBaselineScore(currentScore, generatedAt);
        baselineUpdated = true;
      } catch (error) {
        baselineUpdateError = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `Failed to update ${baselinePathRelative}: ${baselineUpdateError}\n`,
        );
      }
    } else {
      baselineUpdateError = 'Checks failed; baseline not updated.';
    }
  }

  const scoreDetails = {
    current: currentScore,
    previous: previousScore,
    previousGeneratedAt: baselineEntry?.generatedAt ?? null,
    diff: scoreDiff,
    baselinePath: baselinePathRelative,
    updateRequested,
    updated: baselineUpdated,
    updateError: baselineUpdateError,
  };

  const scoreValueString = formatScoreValue(currentScore.value) ?? String(currentScore.value);
  let scoreMessage = `[code-doctor] Code Health Score: ${scoreValueString}/100`;
  if (hasPreviousValue) {
    const baselineValueString = formatScoreValue(previousScore.value) ?? String(previousScore.value);
    if (scoreDiff !== null) {
      const diffValueString = formatScoreValue(scoreDiff) ?? String(scoreDiff);
      const prefix = scoreDiff >= 0 ? '+' : '';
      scoreMessage += ` (${prefix}${diffValueString} vs baseline ${baselineValueString})`;
    } else {
      scoreMessage += ` (baseline ${baselineValueString})`;
    }
  }
  console.log(scoreMessage);
  if (baselineUpdated) {
    console.log(`[code-doctor] Baseline updated at ${baselinePathRelative}.`);
  } else if (updateRequested && baselineUpdateError) {
    console.log(`[code-doctor] Baseline update skipped: ${baselineUpdateError}`);
  }

  try {
    await fs.writeFile(
      REPORT_MD,
      buildMarkdownReport(
        generatedAt,
        overallStatus,
        exitCode,
        results,
        fatalErrorMessage,
        scoreDetails,
      ),
      'utf8',
    );
  } catch (error) {
    process.stderr.write(`Failed to write ${relativePath(REPORT_MD)}: ${error.message}\n`);
  }

  try {
    await fs.writeFile(
      REPORT_JSON,
      buildJsonReport(
        generatedAt,
        overallStatus,
        exitCode,
        results,
        fatalErrorMessage,
        scoreDetails,
      ),
      'utf8',
    );
  } catch (error) {
    process.stderr.write(`Failed to write ${relativePath(REPORT_JSON)}: ${error.message}\n`);
  }

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}
`);
  process.exitCode = 1;
});
