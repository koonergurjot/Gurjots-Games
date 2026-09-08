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
import { createHash } from 'node:crypto';
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
  // Campaign mode (index.html). Night Rush lives at night.html, reached via an
  // in-game link, and is not part of the games.json-driven sweep this runs.
  runner: [' ', ' ', 'ArrowDown', ' '],
  // Campaign mode (index.html). Arena mode lives at arena.html, reached via an
  // in-game link, and is not part of the games.json-driven sweep this runs.
  shooter: ['ArrowLeft', ' ', 'ArrowRight', ' ', ' '],
  'pixel-platformer': ['ArrowRight', ' ', 'ArrowRight', 'ArrowLeft', ' '],
};

// Hash a screenshot of each on-screen canvas. Reading pixels through
// getImageData only works for 2D contexts and picks a single canvas; a page
// here may carry a diagnostics overlay larger than the board, plus a WebGL
// renderer that getImageData cannot read at all. Screenshotting each element
// sidesteps both problems, so "did anything move" is answered per canvas.
// Turn-based games are played with the mouse, and one click only selects. These
// get a sequence of clicks across the board so a move can actually be made --
// chess3d falls back to a DOM board under headless software rendering, where
// key presses do nothing at all.
const TURN_BASED = new Set(['chess', 'chess3d']);

// Games the player steers by holding a key rather than tapping one.
const HOLD_KEYS = {
  maze3d: 'KeyW',
  platformer: 'ArrowRight',
  'pixel-platformer': 'ArrowRight',
};

async function sampleCanvases(page) {
  const handles = await page.$$('canvas');
  const out = [];
  for (const handle of handles) {
    try {
      const box = await handle.boundingBox();
      if (!box || box.width < 40 || box.height < 40) continue;
      const shot = await handle.screenshot({ timeout: 4000 });
      out.push(createHash('sha1').update(shot).digest('hex').slice(0, 16));
    } catch { /* canvas went away or is offscreen */ }
  }
  return out;
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

// A WebGL canvas often screenshots identically under headless software
// rendering even while the scene moves, so canvas pixels alone can call a
// working 3D game dead. The HUD is the other half of the signal: a game that is
// actually running updates a timer, a score or a wave counter.
async function sampleHud(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    const m = text.match(/(?:time|score|distance|wave|level|pts)[^\n]{0,40}/gi);
    return m ? m.join('|').slice(0, 200) : '';
  }).catch(() => '');
}

async function sample(page, rec) {
  rec.frames.push(await sampleCanvases(page));
  rec.hudSamples.push(await sampleHud(page));
}

export async function playtest(browser, port, slug) {
  const rec = { slug, errors: [], frames: [], hudSamples: [], newStorage: [], hud: null };
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage();
  page.on('pageerror', e => rec.errors.push(String(e?.message ?? e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') rec.errors.push(`console: ${m.text().slice(0, 200)}`); });

  try {
    await page.goto(`http://${HOST}:${port}/games/${slug}/index.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(900);
    const before = await snapshotStorage(page);

    // Sample from the moment the game is up rather than after the input burst.
    // Some games auto-start and reach a game-over screen in about two seconds,
    // so a harness that waits before looking sees only the frozen end state and
    // wrongly calls a working game dead.
    await sample(page, rec);

    // Universal "get me into the game" sequence: click the canvas, then the
    // keys every start screen in this repo listens for.
    await page.mouse.click(500, 350).catch(() => {});
    for (const key of ['Enter', ' ']) {
      await page.keyboard.press(key === ' ' ? 'Space' : key).catch(() => {});
      await page.waitForTimeout(250);
      await sample(page, rec);
    }

    // Games with continuous movement barely change between two taps: the player
    // holds a direction. Hold one down for the input burst so these read fairly.
    const hold = HOLD_KEYS[slug];
    if (hold) await page.keyboard.down(hold).catch(() => {});

    if (TURN_BASED.has(slug)) {
      const board = await page.$('canvas, .fallback-board');
      const box = board && await board.boundingBox();
      if (box) {
        // Walk a few squares: select, then try a target a couple of ranks away.
        const cell = box.width / 8;
        for (const [file, rank] of [[4, 1], [4, 3], [1, 0], [2, 2]]) {
          await page.mouse.click(box.x + (file + 0.5) * cell, box.y + (7 - rank + 0.5) * (box.height / 8)).catch(() => {});
          await page.waitForTimeout(400);
          await sample(page, rec);
        }
      }
    }

    const keys = INPUTS[slug] || [' '];
    for (const key of keys) {
      await page.keyboard.press(key === ' ' ? 'Space' : key).catch(() => {});
      await page.waitForTimeout(200);
      await sample(page, rec);
    }
    if (hold) await page.keyboard.up(hold).catch(() => {});

    // Let it run untouched: a live game keeps animating with no input.
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(350);
      await sample(page, rec);
    }

    rec.hud = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      // A blocking panel still on screen at the end of the session tells us the
      // player never got past it -- or died and was left there.
      const blocking = [...document.querySelectorAll('div,section,dialog')].find(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height < 120) return false;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.2) return false;
        return /run complete|game over|press start|click start|paused|tap to play/i.test(el.innerText || '');
      });
      return {
        hasScore: /score|points|pts/i.test(text),
        hasLevel: /level|wave|stage|round/i.test(text),
        blocked: blocking ? (blocking.innerText || '').replace(/\s+/g, ' ').slice(0, 90) : null,
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

  // Count distinct renderings per canvas slot, then take the liveliest canvas:
  // if any surface on the page kept changing, the game is running.
  const slots = Math.max(0, ...rec.frames.map(f => f.length));
  let best = 0;
  for (let i = 0; i < slots; i++) {
    best = Math.max(best, new Set(rec.frames.map(f => f[i]).filter(Boolean)).size);
  }
  rec.distinctFrames = best;
  rec.distinctHud = new Set(rec.hudSamples.filter(Boolean)).size;
  // A game that changes neither a pixel nor a HUD readout across the session is
  // not playing.
  rec.animates = best > 2 || rec.distinctHud > 2;
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
    console.log(`${rec.ok ? 'PLAYS' : 'STUCK'}  ${slug.padEnd(18)} frames=${rec.distinctFrames} hud=${rec.distinctHud} score=${rec.hud?.hasScore ? 'y' : 'n'} level=${rec.hud?.hasLevel ? 'y' : 'n'} storage=${rec.newStorage.length}`);
    if (rec.hud?.blocked) console.log(`         ends on a panel: "${rec.hud.blocked}"`);
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
