/**
 * Drive a game with real input and report whether it actually plays.
 *
 * boot-check.mjs proves a game loads without errors. That is not the same as
 * being playable: a game can boot clean and still render a frozen frame, ignore
 * the keyboard, or never persist a score. This harness presses the keys a player
 * would press and measures whether anything changed.
 *
 *   node tools/dev/playtest.mjs            # every catalogued game
 *   node tools/dev/playtest.mjs snake pong # just these
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './boot-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = '127.0.0.1';

// Keys each game responds to. Everything gets the universal start presses first.
const INPUTS = {
  pong: ['w', 'w', 's', 'w', 's', 's'],
  snake: ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight'],
  tetris: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft'],
  breakout: ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'],
  chess: [],
  chess3d: [],
  2048: ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'],
  asteroids: ['ArrowUp', 'ArrowLeft', ' ', 'ArrowRight', ' '],
  maze3d: ['w', 'a', 'w', 'd', 'w'],
  platformer: ['ArrowRight', ' ', 'ArrowRight', 'ArrowLeft', ' '],
  runner: [' ', ' ', 'ArrowDown', ' '],
  shooter: ['ArrowLeft', ' ', 'ArrowRight', ' ', ' '],
  'alien-shooter': ['a', ' ', 'd', ' ', ' '],
  'city-runner': [' ', ' ', 'ArrowDown', ' '],
  'pixel-platformer': ['ArrowRight', ' ', 'ArrowRight', 'ArrowLeft', ' '],
};

async function sampleCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return 'webgl';
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 4 * 31) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
      return String(h);
    } catch { return 'webgl'; }
  });
}

async function snapshotStorage(page) {
  return page.evaluate(() => {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = String(localStorage.getItem(k)).slice(0, 120);
      }
    } catch { /* storage blocked */ }
    return out;
  });
}

export async function playtest(browser, port, slug) {
  const rec = { slug, errors: [], frames: [], newStorage: [], hud: null };
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage();
  page.on('pageerror', e => rec.errors.push(String(e?.message ?? e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') rec.errors.push(`console: ${m.text().slice(0, 200)}`); });

  try {
    await page.goto(`http://${HOST}:${port}/games/${slug}/index.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);
    const before = await snapshotStorage(page);

    // Universal "get me into the game" sequence: click the canvas, then the
    // keys every start screen in this repo listens for.
    await page.mouse.click(500, 350).catch(() => {});
    for (const key of ['Enter', ' ']) {
      await page.keyboard.press(key === ' ' ? 'Space' : key).catch(() => {});
      await page.waitForTimeout(350);
    }

    rec.frames.push(await sampleCanvas(page));
    const keys = INPUTS[slug] || [' '];
    for (const key of keys) {
      await page.keyboard.press(key === ' ' ? 'Space' : key).catch(() => {});
      await page.waitForTimeout(220);
      rec.frames.push(await sampleCanvas(page));
    }
    // Let it run untouched: a live game keeps animating with no input.
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(400);
      rec.frames.push(await sampleCanvas(page));
    }

    rec.hud = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return {
        hasScore: /score|points|pts/i.test(text),
        hasLevel: /level|wave|stage|round/i.test(text),
        sample: text.replace(/\s+/g, ' ').slice(0, 240),
      };
    });

    const after = await snapshotStorage(page);
    rec.newStorage = Object.keys(after).filter(k => after[k] !== before[k]);
  } catch (err) {
    rec.fatal = String(err?.message ?? err).slice(0, 200);
  }

  const ENVIRONMENTAL = [/THREE\.WebGLProgram/i, /Shader Error/i, /shader is not compiled/i,
    /VALIDATE_STATUS/i, /SwiftShader/i, /software WebGL/i, /GroupMarkerNotSet/i];
  rec.errors = [...new Set(rec.errors.filter(e => !ENVIRONMENTAL.some(re => re.test(e))))];

  const real = rec.frames.filter(f => f && f !== 'webgl');
  rec.webgl = rec.frames.some(f => f === 'webgl');
  rec.distinctFrames = new Set(real).size;
  // A 2D game that never changes a pixel across ~4s of input is not playing.
  rec.animates = rec.webgl || rec.distinctFrames > 2;
  rec.ok = !rec.fatal && rec.errors.length === 0 && rec.animates;

  await context.close().catch(() => {});
  return rec;
}

async function main() {
  const requested = process.argv.slice(2);
  const catalog = JSON.parse(await readFile(path.join(ROOT, 'games.json'), 'utf8'));
  const slugs = requested.length ? requested : catalog.map(g => g.slug);
  const { server, port } = await startServer();
  const browser = await chromium.launch();
  const results = [];
  for (const slug of slugs) {
    const rec = await playtest(browser, port, slug);
    results.push(rec);
    console.log(`${rec.ok ? 'PLAYS' : 'STUCK'}  ${slug.padEnd(18)} frames=${rec.distinctFrames}${rec.webgl ? ' (webgl)' : ''} score=${rec.hud?.hasScore ? 'y' : 'n'} level=${rec.hud?.hasLevel ? 'y' : 'n'} storage=${rec.newStorage.length}`);
    if (rec.fatal) console.log(`         fatal: ${rec.fatal}`);
    for (const e of rec.errors.slice(0, 3)) console.log(`         ${e}`);
    if (!rec.animates) console.log(`         HUD: ${rec.hud?.sample || '(empty)'}`);
  }
  await browser.close();
  server.close();
  const stuck = results.filter(r => !r.ok);
  console.log(`\n${results.length - stuck.length}/${results.length} games respond to play.`);
  if (stuck.length) console.log(`Stuck: ${stuck.map(r => r.slug).join(', ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
