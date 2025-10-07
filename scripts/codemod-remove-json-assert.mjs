/**
 * Usage:
 *   node scripts/codemod-remove-json-assert.mjs
 *
 * Recursively scans ./games and ./shared for ESM import assertions and rewrites them
 * to runtime fetches compatible with browsers without JSON modules.
 */
import fs from "fs";
import path from "path";
const roots = ["games", "shared", "src"].filter(p => fs.existsSync(p));
const exts = new Set([".js", ".mjs", ".ts"]);

function walk(dir, out=[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (exts.has(path.extname(p))) out.push(p);
  }
  return out;
}

const files = roots.flatMap(r => walk(r));
const re = /import\s+(\w+)\s+from\s+["']([^"']+\.json)["']\s+assert\s*\{\s*type\s*:\s*["']json["']\s*\}\s*;?/g;

let changed = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  if (!re.test(src)) {
    continue;
  }

  re.lastIndex = 0;

  let out = src;
  const helper = "async function __loadJSON__(p){const r=await fetch(new URL(p, import.meta.url));return r.json();}\n\n";

  if (!out.includes("async function __loadJSON__")) {
    out = `${helper}${out}`;
  }

  out = out.replace(re, (_m, ident, rel) => `const ${ident} = await __loadJSON__('${rel}');`);

  fs.writeFileSync(file, out, "utf8");
  changed++;
  console.log("[codemod] Rewrote JSON import assertion in", file);
}

console.log("[codemod] Files changed:", changed);
