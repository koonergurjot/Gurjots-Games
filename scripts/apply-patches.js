#!/usr/bin/env node
/**
 * Safe patcher for Gurjot's Games
 * - Injects #game-root + loader script into game.html
 * - Ensures viewport meta + minimal style
 * - Adds network-first rule for *.js in sw.js
 *
 * Usage:
 *   node scripts/apply-patches.js            # real run
 *   DRY=1 node scripts/apply-patches.js     # dry run (prints what it would change)
 *
 * Assumes you run this from repo root.
 */
const fs = require('fs');
const path = require('path');

const DRY = !!process.env.DRY;

function backup(file) {
  const bak = file + '.bak';
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(file, bak);
    log(`Backed up ${file} -> ${bak}`);
  }
}

function log(msg){ console.log(`[patch] ${msg}`); }

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function patchGameHTML(file) {
  if (!fs.existsSync(file)) { log(`SKIP: ${file} not found`); return; }
  let src = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Ensure viewport meta
  if (!/name=["']viewport["']/i.test(src)) {
    src = src.replace(/<head([^>]*)>/i, (m, g1) => `${m}\n    <meta name="viewport" content="width=device-width, initial-scale=1" />`);
    changed = true;
    log('Inserted viewport meta');
  }

  // Ensure #game-root and loader script before </body>
  if (!/id=["']game-root["']/.test(src)) {
    src = src.replace(/<\/body>/i, (m) => `  <div id="game-root" aria-live="polite" style="display:block;min-height:100vh"></div>\n${m}`);
    changed = true;
    log('Inserted <div id="game-root">');
  }

  if (!/js\/game-loader\.js/.test(src)) {
    src = src.replace(/<\/body>/i, (m) => `  <script src="/js/game-loader.js"></script>\n${m}`);
    changed = true;
    log('Injected <script src="/js/game-loader.js">');
  }

  if (changed && !DRY) {
    backup(file);
    fs.writeFileSync(file, src);
    log(`Patched ${file}`);
  } else if (changed) {
    log(`Would patch ${file} (DRY RUN)`);
  } else {
    log(`No changes needed for ${file}`);
  }
}

function patchSW(file) {
  if (!fs.existsSync(file)) { log(`SKIP: ${file} not found`); return; }
  let src = fs.readFileSync(file, 'utf8');
  let changed = false;

  const block = `
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith('.js')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request, { cache: 'no-store' });
        if (fresh && fresh.ok) return fresh;
      } catch (e) {}
      const cached = await caches.match(event.request);
      return cached || fetch(event.request);
    })());
    return;
  }
});`.trim();

  // If there is already a fetch event with .js handling, skip.
  if (/addEventListener\(['"]fetch['"][\s\S]+\.js/.test(src)) {
    log('SW already appears to handle JS network-first; skipping');
    return;
  }

  // Try to append at end of file, preserving existing logic.
  const newSrc = src.trimEnd() + '\n\n// --- Injected network-first for JS ---\n' + block + '\n';
  if (newSrc !== src) {
    changed = true;
  }

  if (changed && !DRY) {
    backup(file);
    fs.writeFileSync(file, newSrc);
    log(`Patched ${file}`);
  } else if (changed) {
    log(`Would patch ${file} (DRY RUN)`);
  } else {
    log(`No changes needed for ${file}`);
  }
}

function copyGameLoader() {
  const src = path.join(__dirname, '..', 'js', 'game-loader.js');
  const dest = path.join(process.cwd(), 'js', 'game-loader.js');
  ensureDir(path.dirname(dest));
  if (!DRY) {
    fs.copyFileSync(src, dest);
    log(`Copied ${src} -> ${dest}`);
  } else {
    log(`Would copy ${src} -> ${dest} (DRY RUN)`);
  }
}

function main() {
  log('Starting patches...');
  copyGameLoader();
  patchGameHTML(path.join(process.cwd(), 'game.html'));
  patchSW(path.join(process.cwd(), 'sw.js'));
  log('Done.');
}

if (require.main === module) {
  try { main(); } catch (e) {
    console.error('[patch] ERROR:', e);
    process.exit(1);
  }
}
