// scripts/validate-games.js
// Fails CI if games.json is malformed or referenced entry files don't exist.
const fs = require('fs');
const path = require('path');

function fail(msg) { console.error(msg); process.exit(1); }
if (!fs.existsSync('games.json')) {
  fail('games.json not found at repo root.');
}

let raw;
try {
  raw = fs.readFileSync('games.json','utf8');
} catch (e) {
  fail('Unable to read games.json: ' + e.message);
}

let games;
try {
  games = JSON.parse(raw);
} catch (e) {
  fail('games.json is not valid JSON: ' + e.message);
}

const arr = Array.isArray(games)
  ? games
  : Object.keys(games).map(k => ({ slug: k, ...games[k] }));

if (!Array.isArray(arr) || !arr.length) {
  fail('games.json: expected a non-empty array or object map of games');
}

const missing = [];
const problems = [];

for (const g of arr) {
  if (!g || typeof g !== 'object') {
    problems.push('Invalid record (not an object)');
    continue;
  }
  const { title, slug, entry } = g;
  if (!slug || !entry) {
    problems.push(`${slug || '(no slug)'}: missing slug/entry`);
    continue;
  }
  // Normalize: ensure entry is absolute (starts with /)
  if (!entry.startsWith('/')) {
    problems.push(`${slug}: entry should be an absolute path starting with "/": got "${entry}"`);
  }
  // File existence check (works on CI checkout)
  const diskPath = path.join('.', entry);
  if (!fs.existsSync(diskPath)) {
    missing.push(`${slug}: ${entry}`);
  }
}

if (problems.length) {
  console.error('Schema problems:\n - ' + problems.join('\n - '));
}
if (missing.length) {
  console.error('Missing files (paths do not exist in repo):\n - ' + missing.join('\n - '));
}

if (problems.length || missing.length) {
  process.exit(1);
}

console.log(`games.json OK: ${arr.length} entries; all entry files exist.`);
