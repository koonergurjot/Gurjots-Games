#!/usr/bin/env node
/**
 * add-thumbnails.js
 * Auto-populates missing `thumbnail` fields in games.json by scanning /assets/<slug>/
 *
 * Usage:
 *   node scripts/add-thumbnails.js             # real run, modifies games.json (backs up games.json.bak)
 *   node scripts/add-thumbnails.js --dry       # dry run (prints proposed changes)
 *   node scripts/add-thumbnails.js --prefer=webp # prefer .webp over others when multiple found
 *
 * Heuristics:
 *   1) /assets/<slug>/thumb.(png|jpg|jpeg|webp|gif|svg)
 *   2) /assets/<slug>/<slug>.(png|jpg|jpeg|webp|gif|svg)
 *   3) /assets/<slug>/cover.(png|jpg|jpeg|webp|gif|svg)
 *   4) first image file in /assets/<slug>/ (non-recursive)
 *   5) fall back to /assets/placeholder-thumb.png if present
 *
 * Supports games.json as an array or a map keyed by slug.
 */
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const prefArg = (process.argv.find(a => a.startsWith('--prefer=')) || '').split('=')[1];
const PREFER = prefArg ? prefArg.toLowerCase() : null;

const IMG_EXT = ['webp','png','jpg','jpeg','gif','svg'];

function readJSON(p){
  return JSON.parse(fs.readFileSync(p,'utf8'));
}
function writeJSON(p, obj){
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}
function exists(p){ return fs.existsSync(p); }
function listDir(p){
  try { return fs.readdirSync(p, { withFileTypes: true }); }
  catch { return []; }
}
function pick(files, slug){
  let cands = [];
  // 1) thumb.*
  for (const ext of IMG_EXT) cands.push(`thumb.${ext}`);
  // 2) <slug>.*
  for (const ext of IMG_EXT) cands.push(`${slug}.${ext}`);
  // 3) cover.*
  for (const ext of IMG_EXT) cands.push(`cover.${ext}`);

  // availability set
  const set = new Set(files.filter(f => f.isFile()).map(f => f.name));

  // Prefer extension if requested
  function score(name){
    const ext = name.split('.').pop().toLowerCase();
    let s = 0;
    if (name.startsWith('thumb.')) s += 3;
    if (name.startsWith(`${slug}.`)) s += 2;
    if (name.startsWith('cover.')) s += 1;
    if (PREFER && ext === PREFER) s += 5;
    return s;
  }

  // Check strict candidates first
  const strict = cands.filter(n => set.has(n));
  if (strict.length){
    strict.sort((a,b)=>score(b)-score(a));
    return strict[0];
  }

  // Fallback: first image file in folder
  const anyImg = files.filter(f => f.isFile() && IMG_EXT.includes(f.name.split('.').pop().toLowerCase())).map(f => f.name);
  if (anyImg.length){
    anyImg.sort((a,b)=>score(b)-score(a));
    return anyImg[0];
  }

  return null;
}

function toArray(games){
  return Array.isArray(games) ? games : Object.keys(games).map(k => ({ slug:k, ...games[k] }));
}
function fromArray(arr, original){
  if (Array.isArray(original)) return arr;
  const obj = {};
  for (const g of arr){ obj[g.slug] = g; }
  return obj;
}

function main(){
  const root = process.cwd();
  const gamesPath = path.join(root, 'games.json');
  if (!exists(gamesPath)){
    console.error('games.json not found at repo root'); process.exit(1);
  }

  let games = readJSON(gamesPath);
  const arr = toArray(games);

  const changes = [];
  for (const g of arr){
    if (!g || !g.slug) continue;
    if (g.thumbnail && typeof g.thumbnail === 'string' && g.thumbnail.trim()) continue;

    const assetsDir = path.join(root, 'assets', g.slug);
    const files = listDir(assetsDir);
    const picked = pick(files, g.slug);
    let thumbPath;

    if (picked){
      thumbPath = `/assets/${g.slug}/${picked}`;
    } else if (exists(path.join(root, 'assets', 'placeholder-thumb.png'))) {
      thumbPath = `/assets/placeholder-thumb.png`;
    } else {
      thumbPath = null;
    }

    if (thumbPath){
      g.thumbnail = thumbPath;
      changes.push({ slug: g.slug, thumbnail: thumbPath });
    }
  }

  if (!changes.length){
    console.log('No thumbnails added — all entries already have thumbnails or no assets found.');
    process.exit(0);
  }

  const updated = fromArray(arr, games);

  if (DRY){
    console.log('[DRY RUN] Proposed thumbnail additions:');
    for (const c of changes){
      console.log(` - ${c.slug}: ${c.thumbnail}`);
    }
    process.exit(0);
  }

  // Backup & write
  const bak = gamesPath + '.bak';
  fs.copyFileSync(gamesPath, bak);
  writeJSON(gamesPath, updated);
  console.log(`Updated games.json with ${changes.length} thumbnails.`);
  console.log(`Backup created at ${bak}`);
}

if (require.main === module){
  try { main(); } catch (e){ console.error(e); process.exit(1); }
}
