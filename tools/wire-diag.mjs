#!/usr/bin/env node
/**
 * tools/wire-diag.mjs
 * Bulk insert <script src="/games/common/diag-autowire.js" defer></script>
 * into every /games/<slug>/index.html just before </body>.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const gamesDir = path.join(repoRoot, 'games');
const targetSnippet = `<script src="/games/common/diag-autowire.js" defer></script>`;

function looksWired(html) {
  return html.includes('common/diag-autowire.js');
}
function insertBeforeBody(html, snippet) {
  const i = html.lastIndexOf('</body>');
  if (i === -1) return null;
  return html.slice(0, i) + `\n  ${snippet}\n` + html.slice(i);
}

async function main() {
  let touched = 0, skipped = 0, missing = 0;
  let dirs = await fs.readdir(gamesDir, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory() || d.name === 'common') continue;
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
      if (e.code !== 'ENOENT') console.warn(`[wire-diag] WARN: ${p}: ${e.message}`);
    }
  }
  console.log(`[wire-diag] done: ${touched} updated, ${skipped} skipped, ${missing} missing </body>`);
}
main().catch(e => { console.error(e); process.exit(1); });
