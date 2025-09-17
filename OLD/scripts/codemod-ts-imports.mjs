#!/usr/bin/env node
/**
 * Replace TypeScript import specifiers ending with ".ts" to ".js".
 * This avoids browsers trying to load TS directly (wrong MIME + syntax).
 * 
 * Usage: node scripts/codemod-ts-imports.mjs
 */
import fs from 'fs';
import path from 'path';

const roots = ['games','src'].filter(p => fs.existsSync(p));
const files = [];
function walk(dir){
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(js|mjs|ts|tsx)$/.test(e.name)) files.push(p);
  }
}
roots.forEach(walk);

const importRe = /(import\s+[^'"]*from\s*['"])([^'"]+\.ts)(['"]\s*;?)/g;
let changed = 0, missing = 0;

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  if (!importRe.test(src)) continue;
  src = src.replace(importRe, (m, pre, spec, post) => {
    const jsSpec = spec.replace(/\.ts$/, '.js');
    const abs = path.resolve(path.dirname(file), jsSpec);
    if (!fs.existsSync(abs)) {
      console.warn('[codemod] WARNING: JS target missing for', spec, '->', jsSpec, 'in', file);
      missing++;
    }
    changed++;
    return pre + jsSpec + post;
  });
  fs.writeFileSync(file, src, 'utf8');
  console.log('[codemod] patched', file);
}
console.log('[codemod] files changed:', changed, 'missing js targets:', missing);
