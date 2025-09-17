\
/**
 * Usage:
 *   node scripts/codemod-assert-to-console.mjs
 */
import fs from "fs";
import path from "path";

const roots = ["games", "shared", "src"].filter(p => fs.existsSync(p));
const exts = new Set([".js", ".mjs", ".ts"]);
const assertRe = /(^|\W)assert\s*\(/g;

function walk(dir, out=[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (exts.has(path.extname(p))) out.push(p);
  }
  return out;
}

for (const file of roots.flatMap(walk)) {
  const src = fs.readFileSync(file, "utf8");
  if (/import\s+.*assert.*/.test(src)) continue; // skip files that import assert
  if (src.includes("console.assert")) continue;
  let changed = false;
  const out = src.replace(assertRe, (m, pre) => { changed = true; return `${pre}console.assert(`; });
  if (changed) {
    fs.writeFileSync(file, out, "utf8");
    console.log("[codemod] Patched", file);
  }
}
