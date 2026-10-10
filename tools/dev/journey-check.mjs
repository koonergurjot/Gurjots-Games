/**
 * Player-journey check: launch every catalogued game the way the homepage does
 * (game.html?slug=...) and assert it actually shows up.
 *
 * boot-check.mjs opens /games/<slug>/ directly, which is not the page players
 * land on. This opens the real launch route on a phone-sized viewport and a
 * desktop one, then fails on page errors, failed requests, or a game whose
 * canvas is missing or clipped out of its frame.
 *
 *   node tools/dev/journey-check.mjs            # every game
 *   node tools/dev/journey-check.mjs snake      # just these
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './boot-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 850, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
];
const SETTLE_MS = Number(process.env.JOURNEY_SETTLE_MS || 2500);
// WebGL games render to a canvas headless CI cannot always draw; they must
// still be visible, but their pixels are not inspected.
const IGNORE = [/THREE\.WebGLProgram/i, /Shader Error/i, /shader is not compiled/i, /VALIDATE_STATUS/i,
  /SwiftShader/i, /Automatic fallback to software WebGL/i, /GroupMarkerNotSet/i, /WebGL/i];

async function launch() {
  try { return await chromium.launch(); } catch (err) {
    if (process.env.JOURNEY_CHANNEL) return chromium.launch({ channel: process.env.JOURNEY_CHANNEL });
    try { return await chromium.launch({ channel: 'msedge' }); } catch { throw err; }
  }
}

export async function journey(browser, port, slug, viewport) {
  const { name, ...contextOptions } = viewport;
  const context = await browser.newContext({ ...contextOptions, viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const problems = [];
  const origin = `http://127.0.0.1:${port}`;
  page.on('pageerror', e => problems.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.some(r => r.test(m.text()))) problems.push(`console: ${m.text().slice(0, 200)}`); });
  page.on('response', r => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url().replace(origin, '')}`); });
  try {
    await page.goto(`${origin}/game.html?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(slug)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(SETTLE_MS);
    const frame = page.frames().find(f => f !== page.mainFrame() && /\/(gameshells|games)\//.test(f.url()));
    if (!frame) { problems.push('no game frame loaded'); }
    else {
      const frameBox = await (await page.locator('iframe#game-frame').boundingBox());
      const stats = await frame.evaluate(() => {
        const visible = [...document.querySelectorAll('canvas')].map(c => c.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
        const biggest = visible.sort((a, b) => b.width * b.height - a.width * a.height)[0];
        return { hasContent: visible.length > 0 || document.body.innerText.trim().length > 0,
          clippedX: biggest ? Math.max(0, Math.round(biggest.right - innerWidth)) : 0,
          clippedY: biggest ? Math.max(0, Math.round(biggest.bottom - innerHeight)) : 0 };
      });
      if (!stats.hasContent) problems.push('game frame is empty');
      if (frameBox && frameBox.height < 240) problems.push(`game frame too small (${Math.round(frameBox.width)}x${Math.round(frameBox.height)})`);
      if (stats.clippedX > 4 || stats.clippedY > 4) problems.push(`game canvas clipped by ${stats.clippedX}px x / ${stats.clippedY}px y inside its frame`);
    }
  } catch (err) { problems.push(`fatal: ${String(err.message).slice(0, 200)}`); }
  await context.close().catch(() => {});
  return { slug, viewport: name, problems: [...new Set(problems)] };
}

async function main() {
  const requested = process.argv.slice(2);
  const catalog = JSON.parse(await readFile(path.join(ROOT, 'games.json'), 'utf8'));
  const slugs = requested.length ? requested : catalog.map(g => g.slug);
  const { server, port } = await startServer();
  const browser = await launch();
  const results = [];
  for (const slug of slugs) for (const vp of VIEWPORTS) {
    const r = await journey(browser, port, slug, vp);
    results.push(r);
    console.log(`${r.problems.length ? 'FAIL' : 'PASS'}  ${slug} (${vp.name})`);
    for (const p of r.problems.slice(0, 5)) console.log(`        ${p}`);
  }
  await browser.close(); server.close();
  const failed = results.filter(r => r.problems.length);
  console.log(`\n${results.length - failed.length}/${results.length} journeys clean.`);
  process.exitCode = failed.length ? 1 : 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
