/**
 * Boot one or more games over HTTP in a headless browser and report what breaks.
 *
 * Game Doctor boots games from file://, which breaks their absolute /assets/
 * paths and masks real failures. This serves the repo over HTTP, the way the
 * site actually runs.
 *
 *   node tools/dev/boot-check.mjs            # every catalogued game
 *   node tools/dev/boot-check.mjs snake pong # just these
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SETTLE_MS = Number(process.env.BOOT_CHECK_SETTLE_MS || 3000);
const TIMEOUT_MS = Number(process.env.BOOT_CHECK_TIMEOUT_MS || 25000);
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json',
  '.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.gif':'image/gif','.webp':'image/webp','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg',
  '.txt':'text/plain','.ts':'text/javascript','.map':'application/json' };

export async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch (err) { res.writeHead(500); res.end(String(err)); }
  });
  await new Promise(resolve => server.listen(0, resolve));
  return { server, port: server.address().port };
}

export async function bootGame(browser, port, slug, { screenshotDir } = {}) {
  const record = { slug, errors: [], failedRequests: [], signals: [] };
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage();

  page.on('pageerror', err => record.errors.push(String(err?.message ?? err).slice(0, 300)));
  page.on('console', msg => { if (msg.type() === 'error') record.errors.push(`console: ${msg.text().slice(0, 300)}`); });
  page.on('response', res => {
    if (res.status() >= 400) record.failedRequests.push(`${res.status()} ${res.url().replace(`http://localhost:${port}`, '')}`);
  });
  await page.addInitScript(() => {
    window.__bootSignals = [];
    window.addEventListener('message', event => {
      if (event.data && event.data.type) window.__bootSignals.push(event.data.type);
    });
  });

  try {
    await Promise.race([
      (async () => {
        await page.goto(`http://localhost:${port}/games/${slug}/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(SETTLE_MS);
        record.signals = await page.evaluate(() => window.__bootSignals || []);
        record.canvas = await page.evaluate(() => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return { present: false };
          let distinctColors = null;
          try {
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            const seen = new Set();
            for (let i = 0; i < data.length; i += 4 * 97) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
            distinctColors = seen.size;
          } catch { distinctColors = 'webgl'; }
          return { present: true, width: canvas.width, height: canvas.height, distinctColors };
        });
        // A stuck boot leaves the shell's own overlay on screen.
        record.stuckOverlay = await page.evaluate(() =>
          /Taking longer than expected|failed to start|didn.t load/i.test(document.body?.innerText || ''));
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${slug}.png`) });
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`hard timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)),
    ]);
  } catch (err) {
    record.fatal = String(err?.message ?? err).slice(0, 300);
  }

  record.errors = [...new Set(record.errors)];
  record.failedRequests = [...new Set(record.failedRequests)];
  record.signals = [...new Set(record.signals)];
  record.ok = !record.fatal
    && record.errors.length === 0
    && !record.stuckOverlay
    && !record.signals.includes('GAME_ERROR');

  await context.close().catch(() => {});
  return record;
}

async function main() {
  const requested = process.argv.slice(2);
  const catalog = JSON.parse(await readFile(path.join(ROOT, 'games.json'), 'utf8'));
  const slugs = requested.length ? requested : catalog.map(game => game.slug);
  const { server, port } = await startServer();
  const browser = await chromium.launch();
  const results = [];
  for (const slug of slugs) {
    const record = await bootGame(browser, port, slug, { screenshotDir: process.env.BOOT_CHECK_SHOTS });
    results.push(record);
    const status = record.ok ? 'PASS' : 'FAIL';
    console.log(`${status}  ${slug}`);
    if (record.fatal) console.log(`        fatal: ${record.fatal}`);
    if (record.stuckOverlay) console.log('        stuck on the shell boot overlay');
    for (const err of record.errors.slice(0, 4)) console.log(`        ${err}`);
    for (const req of record.failedRequests.slice(0, 4)) console.log(`        ${req}`);
  }
  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} games boot clean.`);
  if (failed.length) console.log(`Failing: ${failed.map(r => r.slug).join(', ')}`);
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
