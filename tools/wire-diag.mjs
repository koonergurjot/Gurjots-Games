#!/usr/bin/env node
/**
 * Wire diag-upgrades into every /games/<slug>/index.html
 * - Idempotent: skips files already wired
 * - Inserts before </body>
 * - Prints a summary of changes
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const gamesDir = path.join(repoRoot, 'games');
const targetSnippet = `<script src="../common/diag-upgrades.js" defer></script>`;

function looksWired(html) {
  return html.includes('common/diag-upgrades.js');
}
function insertBeforeBody(html, snippet) {
  const i = html.lastIndexOf('</body>');
  if (i === -1) return null;
  const head = html.slice(0, i);
  const tail = html.slice(i);
  return `${head}\n  ${snippet}\n${tail}`;
}

async function main() {
  let touched = 0;
  let skipped = 0;
  let missing = 0;

  let dirs;
  try {
    dirs = await fs.readdir(gamesDir, { withFileTypes: true });
  } catch (e) {
    console.error(`[wire-diag] ERROR: cannot read ${gamesDir} — ${e.message}`);
    process.exit(1);
  }

  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    if (d.name === 'common') continue; // skip shared folder
    const p = path.join(gamesDir, d.name, 'index.html');
    try {
      const html = await fs.readFile(p, 'utf8');
      if (looksWired(html)) { skipped++; continue; }
      const next = insertBeforeBody(html, targetSnippet);
      if (!next) { console.warn(`[wire-diag] WARN: no </body> in ${p}`); missing++; continue; }
      await fs.writeFile(p, next, 'utf8');
      console.log(`[wire-diag] wired: ${p}`);
      touched++;
    } catch (e) {
      // ignore non-existent files quietly
      if (e.code !== 'ENOENT') console.warn(`[wire-diag] WARN: ${p}: ${e.message}`);
    }
  }

  console.log(`[wire-diag] done: ${touched} updated, ${skipped} already wired, ${missing} missing </body>`);
  if (touched === 0 && skipped === 0) {
    console.log(`[wire-diag] NOTE: no games/*/index.html found`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
