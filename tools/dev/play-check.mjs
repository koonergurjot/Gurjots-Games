/**
 * Plays each game for a few seconds through the real launch route and checks
 * that it actually runs: dismiss the briefing, press Start, mash keys, and
 * require the picture to change while we play (a loaded-but-frozen or
 * never-started game fails). It does not judge fun; it catches dead games.
 *
 *   node tools/dev/play-check.mjs [slug ...]
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './boot-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VIEWPORTS = [
  { name: 'pc', width: 1366, height: 768 },
  { name: 'phone', width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];
const KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Space', 'Enter', 'KeyD', 'KeyA'];
const START = /^(start playing|start( match| run| game| mission)?|play|begin|new game|got it)$/i;
const hash = buf => createHash('sha1').update(buf).digest('hex');

async function launch() {
  try { return await chromium.launch(); } catch (err) {
    try { return await chromium.launch({ channel: 'msedge' }); } catch { throw err; }
  }
}

async function clickStarts(page) {
  for (const target of [page, ...page.frames().filter(f => f !== page.mainFrame())]) {
    for (let i = 0; i < 4; i++) {
      const button = target.getByRole('button', { name: START }).first();
      if (!(await button.count()) || !(await button.isVisible().catch(() => false))) break;
      await button.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(350);
    }
  }
}

// Phone players swipe (2048, Snake, Tetris) and tap (Match-3, Chess, Runner).
async function touchGesture(page, cdp, i, { width, height }) {
  const cx = width / 2, cy = height * 0.45;
  const swipes = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  if (i % 2 === 0) {
    const [dx, dy] = swipes[(i / 2) % 4];
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(cx, cy) });
    for (let k = 1; k <= 5; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(cx + dx * k * 30, cy + dy * k * 30) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    const spots = [[0.3, 0.3], [0.7, 0.4], [0.5, 0.55], [0.35, 0.5], [0.65, 0.3]];
    const [fx, fy] = spots[(i >> 1) % spots.length];
    await page.touchscreen.tap(width * fx, height * fy).catch(() => {});
  }
}

// Board games need aimed taps. Fractions are of the playfield canvas (x, y).
const TAP_PLANS = {
  'match3': [[0.12, 0.1], [0.24, 0.1], [0.12, 0.1], [0.12, 0.22]],
  'word-puzzle': [[0.1, 0.8], [0.2, 0.8], [0.3, 0.8], [0.4, 0.8], [0.5, 0.8], [0.9, 0.93]],
  'chess': [[0.53, 0.8], [0.53, 0.55], [0.4, 0.8], [0.4, 0.55]],
  'chess3d': [[0.53, 0.8], [0.53, 0.55], [0.4, 0.8], [0.4, 0.55]],
};

async function canvasRect(page) {
  const frame = page.frames().find(f => f !== page.mainFrame());
  if (!frame) return null;
  const inner = await frame.evaluate(() => {
    const list = ['game', 'game-canvas', 'b', 'c'].map(id => document.getElementById(id)).filter(Boolean);
    const all = [...document.querySelectorAll('canvas')];
    const el = list.find(e => e.getBoundingClientRect().width > 0) || all.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }).catch(() => null);
  const box = await page.locator('iframe#game-frame').boundingBox().catch(() => null);
  return inner && box ? { x: box.x + inner.x, y: box.y + inner.y, w: inner.w, h: inner.h } : null;
}

export async function play(browser, port, slug, viewport) {
  const { name, ...rest } = viewport;
  const context = await browser.newContext({ ...rest, viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(`pageerror: ${String(e.message).slice(0, 160)}`));
  try {
    await page.goto(`http://127.0.0.1:${port}/game.html?slug=${slug}&id=${slug}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    const cdp = rest.isMobile ? await context.newCDPSession(page) : null;
    const shot = () => page.screenshot({ animations: 'disabled' }).then(hash);
    const idle = await shot();
    await clickStarts(page);
    await page.waitForTimeout(500);
    const started = await shot();
    const seen = new Set([idle, started]);
    for (let i = 0; i < 10; i++) {
      if (!rest.isMobile) await page.keyboard.press(KEYS[i % KEYS.length]).catch(() => {});
      else if (TAP_PLANS[slug]) {
        const r = await canvasRect(page);
        const [fx, fy] = TAP_PLANS[slug][i % TAP_PLANS[slug].length];
        if (r) await page.touchscreen.tap(r.x + r.w * fx, r.y + r.h * fy).catch(() => {});
      } else await touchGesture(page, cdp, i, rest);
      await page.waitForTimeout(280);
      seen.add(await shot());
    }
    const noWebgl = await Promise.all(page.frames().map(f => f.evaluate(() => /WebGL renderer unavailable/i.test(document.body?.innerText || '')).catch(() => false)));
    if (noWebgl.some(Boolean)) return { slug, viewport: name, problems: [], skipped: 'no WebGL in this browser (2D fallback board)' };
    if (seen.size < 3) problems.push(`picture barely changes while playing (${seen.size} distinct frames)`);
  } catch (err) { problems.push(`fatal: ${String(err.message).slice(0, 160)}`); }
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
    const r = await play(browser, port, slug, vp);
    results.push(r);
    console.log(`${r.skipped ? 'SKIP' : r.problems.length ? 'FAIL' : 'PASS'}  ${slug} (${vp.name})${r.skipped ? ' - ' + r.skipped : ''}`);
    for (const p of r.problems) console.log(`        ${p}`);
  }
  await browser.close(); server.close();
  const failed = results.filter(r => r.problems.length);
  console.log(`\n${results.length - failed.length}/${results.length} games ran.`);
  process.exitCode = failed.length ? 1 : 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
