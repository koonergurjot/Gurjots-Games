/**
 * Home page check: loads the arcade home on PC and phone, scrolls the whole
 * page, and asserts what a player depends on: no page errors, no horizontal
 * scroll, every card has a thumbnail that loaded, search and the genre chips
 * filter the grid, "Surprise me" lands on a real game, and the featured
 * button points at a catalogued game.
 *
 *   node tools/dev/home-check.mjs
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './boot-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VIEWPORTS = [
  { name: 'pc', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];

async function launch() {
  try { return await chromium.launch(); } catch (err) {
    try { return await chromium.launch({ channel: 'msedge' }); } catch { throw err; }
  }
}

async function check(browser, port, vp, slugs) {
  const { name, ...rest } = vp;
  const context = await browser.newContext({ ...rest, viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(`pageerror: ${String(e.message).slice(0, 160)}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 160)}`); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bolt-card', { timeout: 10000 }).catch(() => problems.push('no game cards rendered'));

  // Scroll through so lazy images load.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 300) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
    scrollTo(0, 0);
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.bolt-card .bolt-shot img')].every(i => i.complete), null, { timeout: 5000 }).catch(() => {});

  const cards = await page.locator('.bolt-card').count();
  if (cards !== slugs.length) problems.push(`expected ${slugs.length} cards, found ${cards}`);
  const broken = await page.evaluate(() => [...document.querySelectorAll('.bolt-card .bolt-shot img')]
    .filter(i => !i.complete || i.naturalWidth === 0).map(i => i.alt));
  if (broken.length) problems.push(`thumbnails not loaded: ${broken.join(', ')}`);
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) problems.push('page scrolls sideways');

  // Every Play link must target a catalogued game.
  const hrefs = await page.locator('.bolt-card a.bolt-primary').evaluateAll(as => as.map(a => a.getAttribute('href')));
  const bad = hrefs.filter(h => !slugs.includes(new URL(h, 'http://x/').searchParams.get('slug')));
  if (bad.length) problems.push(`Play links to unknown games: ${bad.join(', ')}`);

  // Featured button.
  const featured = await page.locator('[data-featured-play]').getAttribute('href');
  if (!slugs.includes(new URL(featured, 'http://x/').searchParams.get('slug'))) problems.push(`featured play link is not a catalogued game: ${featured}`);

  // Search narrows, then clears.
  const search = page.locator('#bolt-search');
  await search.fill('tetris');
  await page.waitForTimeout(150);
  const found = await page.locator('.bolt-card').count();
  if (found !== 1) problems.push(`search "tetris" returned ${found} cards`);
  await search.fill('');
  await page.waitForTimeout(150);

  // Genre chip narrows.
  await page.locator('.bolt-chip', { hasText: /^Puzzle$/ }).first().click();
  await page.waitForTimeout(150);
  const puzzle = await page.locator('.bolt-card').count();
  if (!(puzzle > 0 && puzzle < slugs.length)) problems.push(`Puzzle chip showed ${puzzle} cards`);

  // "/" focuses search on PC.
  if (!rest.isMobile) {
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await page.keyboard.press('/');
    if (!(await page.evaluate(() => document.activeElement?.id === 'bolt-search'))) problems.push('"/" did not focus search');
  }

  // Surprise me lands on a real game.
  const surprise = page.locator('[data-surprise]:visible').first();
  if (await surprise.count()) {
    await Promise.all([page.waitForURL(/game\.html\?slug=/, { timeout: 8000 }).catch(() => problems.push('Surprise me did not navigate')), surprise.click()]);
    const slug = new URL(page.url()).searchParams.get('slug');
    if (!slugs.includes(slug)) problems.push(`Surprise me opened unknown game "${slug}"`);
  }
  await context.close().catch(() => {});
  return { viewport: name, problems };
}

async function main() {
  const catalog = JSON.parse(await readFile(path.join(ROOT, 'games.json'), 'utf8'));
  const slugs = catalog.map(g => g.slug);
  const { server, port } = await startServer();
  const browser = await launch();
  const results = [];
  for (const vp of VIEWPORTS) {
    const r = await check(browser, port, vp, slugs);
    results.push(r);
    console.log(`${r.problems.length ? 'FAIL' : 'PASS'}  home (${r.viewport})`);
    for (const p of r.problems) console.log(`        ${p}`);
  }
  await browser.close(); server.close();
  process.exitCode = results.some(r => r.problems.length) ? 1 : 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
