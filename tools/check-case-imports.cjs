const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const gitFiles = execSync('git ls-files', { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

const lowerMap = new Map();
for (const file of gitFiles) {
  lowerMap.set(file.toLowerCase(), file);
}

const dirLowerMap = new Map();
for (const file of gitFiles) {
  const dir = path.dirname(file);
  const key = dir.toLowerCase();
  if (!dirLowerMap.has(key)) {
    dirLowerMap.set(key, dir);
  }
}

dirLowerMap.set('.', '.');

const extensions = Array.from(new Set(gitFiles.map(f => path.extname(f)).filter(Boolean)));
const defaultExtensions = ['', ...extensions];

function resolveImport(importer, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null;
  }
  let relPath;
  if (specifier.startsWith('/')) {
    relPath = specifier.slice(1);
  } else {
    const importerDir = path.dirname(importer);
    const absPath = path.normalize(path.join(importerDir, specifier));
    relPath = path.relative('.', absPath);
  }
  relPath = relPath.replace(/\\/g, '/');

  const candidates = [];
  candidates.push(relPath);
  for (const ext of defaultExtensions) {
    candidates.push(relPath + ext);
  }
  for (const ext of defaultExtensions) {
    candidates.push(path.posix.join(relPath, 'index' + ext));
  }
  return candidates;
}

function checkCase(importer, specifier) {
  const candidates = resolveImport(importer, specifier);
  if (!candidates) return null;

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (lowerMap.has(lower)) {
      const actual = lowerMap.get(lower);
      if (actual !== candidate) {
        return { candidate, actual };
      }
      return null;
    }
    if (dirLowerMap.has(lower)) {
      const actualDir = dirLowerMap.get(lower);
      if (actualDir !== candidate) {
        return { candidate, actual: actualDir };
      }
      return null;
    }
  }
  return null;
}

const importRegex = /import\s+(?:[^'";]+\s+from\s+)?['\"]([^'\"]+)['\"]/g;
const dynamicImportRegex = /import\(\s*['\"]([^'\"]+)['\"]\s*\)/g;
const requireRegex = /require\(\s*['\"]([^'\"]+)['\"]\s*\)/g;

const issues = [];

function trackIssue(file, specifier, candidate, actual) {
  issues.push({ file, specifier, candidate, actual });
}

for (const file of gitFiles) {
  if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  const regexes = [importRegex, dynamicImportRegex, requireRegex];
  for (const regex of regexes) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const specifier = match[1];
      const result = checkCase(file, specifier);
      if (result) {
        trackIssue(file, specifier, result.candidate, result.actual);
      }
    }
  }
}

const htmlAttrRegex = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const cssUrlRegex = /url\(\s*([^\)]+)\s*\)/gi;
const cssImportRegex = /@import\s+["']([^"']+)["']/gi;

for (const file of gitFiles) {
  if (/\.(html?)$/i.test(file)) {
    const content = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = htmlAttrRegex.exec(content)) !== null) {
      const specifier = match[1].trim().replace(/['\"]/g, '');
      if (!specifier || /^(https?:)?\/\//i.test(specifier) || specifier.startsWith('mailto:') || specifier.startsWith('#')) {
        continue;
      }
      const result = checkCase(file, specifier);
      if (result) {
        trackIssue(file, specifier, result.candidate, result.actual);
      }
    }
  }

  if (/\.(css)$/i.test(file)) {
    const content = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = cssImportRegex.exec(content)) !== null) {
      const specifier = match[1].trim();
      if (!specifier || /^(https?:)?\/\//i.test(specifier) || specifier.startsWith('data:')) continue;
      const result = checkCase(file, specifier);
      if (result) {
        trackIssue(file, specifier, result.candidate, result.actual);
      }
    }
    cssUrlRegex.lastIndex = 0;
    while ((match = cssUrlRegex.exec(content)) !== null) {
      let specifier = match[1].trim().replace(/["']/g, '');
      if (!specifier || /^(https?:)?\/\//i.test(specifier) || specifier.startsWith('data:') || specifier.startsWith('#')) continue;
      const result = checkCase(file, specifier);
      if (result) {
        trackIssue(file, specifier, result.candidate, result.actual);
      }
    }
  }
}

if (issues.length === 0) {
  console.log('No case mismatches found.');
  process.exit(0);
}

console.log('Found case mismatches:');
for (const issue of issues) {
  console.log(`${issue.file}: ${issue.specifier} -> expected ${issue.actual}, got ${issue.candidate}`);
}
process.exit(1);
