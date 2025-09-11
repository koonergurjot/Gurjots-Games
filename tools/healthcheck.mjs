import { promises as fs } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { parse } from 'acorn';
import { exec } from 'node:child_process';

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function resolveAsset(base, asset) {
  if (!asset || asset.startsWith('http://') || asset.startsWith('https://') || asset.startsWith('//') || asset.startsWith('data:')) {
    return null;
  }
  return path.normalize(path.join(base, asset));
}

function collectPattern(node, set) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier':
      set.add(node.name);
      break;
    case 'ObjectPattern':
      for (const prop of node.properties) collectPattern(prop.value, set);
      break;
    case 'ArrayPattern':
      for (const el of node.elements) if (el) collectPattern(el, set);
      break;
    case 'AssignmentPattern':
      collectPattern(node.left, set);
      break;
    case 'RestElement':
      collectPattern(node.argument, set);
      break;
  }
}

async function analyzeJS(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const code = await fs.readFile(file, 'utf8');
  let ast;
  try {
    ast = parse(code, { sourceType: 'module', ecmaVersion: 'latest' });
  } catch (err) {
    const result = { exports: new Set(), hasDefault: false, errors: [`Parse error in ${file}: ${err.message}`], missing: 0 };
    cache.set(file, result);
    return result;
  }
  const exports = new Set();
  let hasDefault = false;
  const errors = [];
  let missing = 0;

  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        if (node.declaration.type === 'VariableDeclaration') {
          for (const decl of node.declaration.declarations) collectPattern(decl.id, exports);
        } else if (node.declaration.id) {
          exports.add(node.declaration.id.name);
        }
      }
      if (node.specifiers) {
        for (const spec of node.specifiers) exports.add(spec.exported.name);
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      hasDefault = true;
    }
  }

  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      const imp = node.source.value;
      if (imp.startsWith('http') || imp.startsWith('//')) continue;
      let target = path.resolve(path.dirname(file), imp);
      if (!path.extname(target)) target += '.js';
      if (!(await fileExists(target))) {
        errors.push(`Missing module ${imp} imported in ${file}`);
        missing++;
        continue;
      }
      const info = await analyzeJS(target, cache);
      missing += info.missing;
      errors.push(...info.errors);
      for (const spec of node.specifiers) {
        if (spec.type === 'ImportDefaultSpecifier') {
          if (!info.hasDefault) errors.push(`Missing default export in ${imp} (imported in ${file})`);
        } else if (spec.type === 'ImportSpecifier') {
          if (!info.exports.has(spec.imported.name)) errors.push(`Missing export ${spec.imported.name} in ${imp} (imported in ${file})`);
        }
      }
    } else if (node.type === 'ExportAllDeclaration') {
      const imp = node.source && node.source.value;
      if (imp && !imp.startsWith('http') && !imp.startsWith('//')) {
        let target = path.resolve(path.dirname(file), imp);
        if (!path.extname(target)) target += '.js';
        if (!(await fileExists(target))) {
          errors.push(`Missing module ${imp} re-exported in ${file}`);
          missing++;
        } else {
          const info = await analyzeJS(target, cache);
          missing += info.missing;
          errors.push(...info.errors);
        }
      }
    }
  }

  const result = { exports, hasDefault, errors, missing };
  cache.set(file, result);
  return result;
}

async function runBuild() {
  return await new Promise((resolve) => {
    exec('npm run build', (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

async function main() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const gamesRoot = path.join(root, 'games');
  const entries = await fs.readdir(gamesRoot, { withFileTypes: true });
  const games = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const build = await runBuild();
  const buildOKGlobal = !build.error;

  const results = [];

  for (const game of games) {
    const gameDir = path.join(gamesRoot, game);
    const index = path.join(gameDir, 'index.html');
    const importErrors = [];
    let missing = 0;
    let hasIndex = true;
    if (!(await fileExists(index))) {
      hasIndex = false;
      missing++;
    }
    if (hasIndex) {
      const html = await fs.readFile(index, 'utf8');
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      const assets = new Set();
      doc.querySelectorAll('script[src]').forEach((el) => assets.add(el.getAttribute('src')));
      doc.querySelectorAll('link[rel="stylesheet"][href]').forEach((el) => assets.add(el.getAttribute('href')));
      doc.querySelectorAll('[src]').forEach((el) => assets.add(el.getAttribute('src')));
      doc.querySelectorAll('[href]').forEach((el) => assets.add(el.getAttribute('href')));
      for (const asset of assets) {
        const resolved = resolveAsset(gameDir, asset);
        if (!resolved) continue;
        if (!(await fileExists(resolved))) {
          missing++;
          continue;
        }
        if (resolved.endsWith('.js')) {
          const info = await analyzeJS(resolved);
          missing += info.missing;
          importErrors.push(...info.errors);
        }
      }
    }

    let buildOK = buildOKGlobal;
    if (!buildOKGlobal && build.stderr.includes(`games/${game}`)) buildOK = false;
    const bootOK = hasIndex && missing === 0 && importErrors.length === 0;
    results.push({ Game: game, BuildOK: buildOK, MissingFileCount: missing, ImportErrors: importErrors, BootOK: bootOK });
  }

  await fs.writeFile(path.join(root, 'healthcheck.json'), JSON.stringify(results, null, 2));
  console.table(results.map((r) => ({ Game: r.Game, BuildOK: r.BuildOK, MissingFileCount: r.MissingFileCount, ImportErrors: r.ImportErrors.length, BootOK: r.BootOK })));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

