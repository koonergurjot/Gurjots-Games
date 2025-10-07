import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HEALTH_DIR = path.join(ROOT, 'health');
const REPORT_MD = path.join(HEALTH_DIR, 'code-report.md');
const REPORT_JSON = path.join(HEALTH_DIR, 'code-report.json');

const SYNTAX_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);
const IMPORT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function hasLocalBinary(binaryName) {
  const binDir = path.join(ROOT, 'node_modules', '.bin');
  const candidates = [
    path.join(binDir, binaryName),
    path.join(binDir, `${binaryName}.cmd`),
    path.join(binDir, `${binaryName}.ps1`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return true;
    }
  }
  return false;
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
        if (entry.name === 'node_modules' || entry.name === 'dist') {
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

const MAX_SYNTAX_CONCURRENCY = 8;

async function runSyntaxCheck(files, result) {
  if (files.length === 0) {
    result.status = 'passed';
    result.summary = 'No JavaScript files found.';
    result.ran = false;
    return;
  }
  result.ran = true;
  const issues = [];
  const queue = files.slice();
  const workers = Array.from(
    { length: Math.min(MAX_SYNTAX_CONCURRENCY, queue.length) },
    () =>
      (async () => {
        while (queue.length > 0) {
          const filePath = queue.pop();
          if (!filePath) {
            break;
          }
          const checkResult = await runCommand('node', ['--check', filePath]);
          if (checkResult.code !== 0) {
            issues.push({
              file: relativePath(filePath),
              output: (checkResult.stderr || checkResult.stdout || '').trim() ||
                'Unknown syntax error.',
            });
          }
        }
      })(),
  );
  await Promise.all(workers);
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
    const dependencyDeclared = hasDependency(pkgJson, config.packageName);
    if (!dependencyDeclared) {
      result.status = 'skipped';
      result.summary = `${config.label} not installed.`;
      continue;
    }
    const binaryName = config.command[0];
    const binaryAvailable = await hasLocalBinary(binaryName);
    if (!binaryAvailable) {
      result.status = 'skipped';
      result.summary = `${config.label} dependency missing from node_modules.`;
      continue;
    }
    const commandResult = await runCommand('npx', ['--no-install', ...config.command]);
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

async function checkImportTargets(files, result) {
  if (files.length === 0) {
    result.status = 'passed';
    result.summary = 'No modules to scan.';
    result.ran = false;
    return;
  }
  result.ran = true;
  const missing = [];
  for (const filePath of files) {
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      continue;
    }
    const fromRegex = /from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const importCallRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const specs = [];
    let match;
    while ((match = fromRegex.exec(content)) != null) {
      specs.push(match[1]);
    }
    while ((match = requireRegex.exec(content)) != null) {
      specs.push(match[1]);
    }
    while ((match = importCallRegex.exec(content)) != null) {
      specs.push(match[1]);
    }

    for (const specifier of specs) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        continue;
      }
      const normalized = normalizeImportSpecifier(specifier);
      const baseDir = path.dirname(filePath);
      const targetBase = path.resolve(baseDir, normalized);
      const candidates = new Set();
      candidates.add(targetBase);
      const extensionCandidates = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'];
      if (!path.extname(targetBase)) {
        for (const ext of extensionCandidates) {
          candidates.add(`${targetBase}${ext}`);
        }
      }
      for (const ext of extensionCandidates) {
        candidates.add(path.join(targetBase, `index${ext}`));
      }
      let exists = false;
      for (const candidate of candidates) {
        try {
          await fs.access(candidate);
          exists = true;
          break;
        } catch {
          continue;
        }
      }
      if (!exists) {
        missing.push({
          file: relativePath(filePath),
          specifier,
        });
      }
    }
  }
  if (missing.length === 0) {
    result.status = 'passed';
    result.summary = 'All relative imports resolved.';
  } else {
    result.status = 'issues';
    result.summary = `${missing.length} missing relative import${missing.length === 1 ? '' : 's'}.`;
    result.issues = missing;
  }
}

function buildMarkdownReport(generatedAt, overallStatus, exitCode, results, fatalError) {
  const lines = [];
  lines.push('# Code Doctor Report');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push(`Overall Status: ${statusSymbol(overallStatus)} ${overallStatus}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Check | Status | Details |');
  lines.push('| --- | --- | --- |');
  for (const key of ['syntax', 'eslint', 'prettier', 'typescript', 'imports']) {
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
    lines.push(importResult.summary || 'Missing relative imports:');
    lines.push('');
    for (const issue of importResult.issues) {
      lines.push(`- **${issue.file}** → \`${issue.specifier}\``);
    }
  }
  lines.push('');

  lines.push(`Exit Code: ${exitCode}`);
  lines.push('');

  return lines.join('\n');
}

function buildJsonReport(generatedAt, overallStatus, exitCode, results, fatalError) {
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
    },
  };
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

    await runSyntaxCheck(syntaxFiles, results.syntax);
    await runOptionalTools(pkgJson, results);
    await checkImportTargets(importFiles, results.imports);

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
      (results.typescript.ran && results.typescript.status === 'failed')
    ) {
      return 'failed';
    }
    if (results.imports.status === 'issues') {
      return 'issues';
    }
    return 'passed';
  })();

  try {
    await fs.writeFile(
      REPORT_MD,
      buildMarkdownReport(generatedAt, overallStatus, exitCode, results, fatalErrorMessage),
      'utf8',
    );
  } catch (error) {
    process.stderr.write(`Failed to write ${relativePath(REPORT_MD)}: ${error.message}
`);
  }

  try {
    await fs.writeFile(
      REPORT_JSON,
      buildJsonReport(generatedAt, overallStatus, exitCode, results, fatalErrorMessage),
      'utf8',
    );
  } catch (error) {
    process.stderr.write(`Failed to write ${relativePath(REPORT_JSON)}: ${error.message}
`);
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
