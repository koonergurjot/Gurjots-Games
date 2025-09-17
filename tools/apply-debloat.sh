#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" )" && pwd)"

print_usage() {
  cat <<'USAGE'
Usage: ./tools/apply-debloat.sh [--dry-run | --apply]

Runs the debloat scanner to refresh debloat-report.json and optionally
removes files listed in the report's to_remove array.

Options:
  --dry-run   Explicitly run in dry-run mode (default behaviour)
  --apply     Delete entries listed in debloat-report.json to_remove
  -h, --help  Show this help message
USAGE
}

fail() {
  echo "Error: $1" >&2
  exit 1
}

MODE="dry"
APPLY_SELECTED=false
DRY_SELECTED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_SELECTED=true
      ;;
    --apply)
      APPLY_SELECTED=true
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
  shift
done

if [[ "$APPLY_SELECTED" == true && "$DRY_SELECTED" == true ]]; then
  fail "Cannot pass both --apply and --dry-run"
fi

if [[ "$APPLY_SELECTED" == true ]]; then
  MODE="apply"
else
  MODE="dry"
fi

if [[ ! -d .git || ! -f package.json || ! -d tools ]]; then
  fail "This script must be executed from the repository root."
fi

if ! command -v node >/dev/null 2>&1; then
  fail "node is required to run the debloat scanner."
fi

PRESERVED_STATE="$(node <<'NODE'
const fs = require('fs');
const state = { present: false, data: [] };
try {
  const raw = fs.readFileSync('debloat-report.json', 'utf8');
  const json = JSON.parse(raw);
  const toRemove = json.to_remove;
  if (Array.isArray(toRemove) || (toRemove && typeof toRemove === 'object')) {
    state.present = true;
    state.data = toRemove;
  }
} catch (error) {
  // Ignore missing or invalid file during preservation stage.
}
process.stdout.write(JSON.stringify(state));
NODE
)"

if ! node "$SCRIPT_DIR/scan-debloat.js"; then
  fail "Debloat scanner failed."
fi

if [[ ! -f debloat-report.json ]]; then
  fail "scan-debloat did not produce debloat-report.json"
fi

if ! PRESERVED_STATE="$PRESERVED_STATE" node <<'NODE'
const fs = require('fs');
const stateRaw = process.env.PRESERVED_STATE || '';
let state;
try {
  state = stateRaw ? JSON.parse(stateRaw) : { present: false, data: [] };
} catch (error) {
  console.error('Unable to parse preserved state:', error.message);
  process.exit(1);
}
const reportPath = 'debloat-report.json';
let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error('Unable to read refreshed debloat-report.json:', error.message);
  process.exit(1);
}
if (state.present) {
  report.to_remove = state.data;
} else if (Object.prototype.hasOwnProperty.call(report, 'to_remove')) {
  delete report.to_remove;
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
NODE
then
  fail "Failed to restore preserved to_remove entries."
fi

SUMMARY_DATA_PATH="$(mktemp)"
trap 'rm -f "$SUMMARY_DATA_PATH"' EXIT

if ! SUMMARY_DATA_PATH="$SUMMARY_DATA_PATH" node <<'NODE'
const fs = require('fs');
const path = require('path');

function normalizeToRemove(raw) {
  if (raw == null) {
    return { entries: [], structure: { style: 'none', raw: null } };
  }

  if (Array.isArray(raw)) {
    const entries = [];
    for (const item of raw) {
      if (typeof item !== 'string' || item.trim() === '') {
        throw new Error('Invalid to_remove entry detected. All entries must be non-empty strings.');
      }
      entries.push({ path: item.trim(), kind: 'unspecified' });
    }
    return { entries, structure: { style: 'array', raw: raw.slice() } };
  }

  if (typeof raw === 'object') {
    const seen = new Set();
    const entries = [];
    const structure = { style: 'object', raw };

    const processList = (key, kind) => {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) {
        return;
      }
      const list = raw[key];
      if (!Array.isArray(list)) {
        throw new Error(`Invalid to_remove.${key} entry detected. Expected an array of strings.`);
      }
      for (const value of list) {
        if (typeof value !== 'string' || value.trim() === '') {
          throw new Error(`Invalid to_remove.${key} entry detected. All entries must be non-empty strings.`);
        }
        const trimmed = value.trim();
        if (seen.has(trimmed)) {
          continue;
        }
        seen.add(trimmed);
        entries.push({ path: trimmed, kind });
      }
    };

    processList('files', 'file');
    processList('dirs', 'dir');

    return { entries, structure };
  }

  throw new Error('Invalid to_remove entry detected. Expected an array or object.');
}

const summaryPath = process.env.SUMMARY_DATA_PATH;
if (!summaryPath) {
  console.error('Missing SUMMARY_DATA_PATH environment variable.');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync('debloat-report.json', 'utf8'));
} catch (error) {
  console.error('Unable to read debloat-report.json:', error.message);
  process.exit(1);
}

try {
  const { entries: baseEntries, structure } = normalizeToRemove(report.to_remove);

  const cwd = process.cwd();

  const seen = new Set();
  const entries = [];
  let totalBytes = 0;
  let existingCount = 0;
  const missing = [];

  function ensureSafePath(rel) {
    const resolved = path.resolve(cwd, rel);
    if (resolved === cwd) {
      throw new Error(`Refusing to operate on repository root via entry: ${rel}`);
    }
    if (!resolved.startsWith(cwd + path.sep)) {
      throw new Error(`Refusing to operate outside repository root: ${rel}`);
    }
    return resolved;
  }

  function computeSize(targetPath) {
    let stat;
    try {
      stat = fs.lstatSync(targetPath);
    } catch (error) {
      throw new Error(`Unable to stat ${path.relative(cwd, targetPath)}: ${error.message}`);
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      let sum = stat.size;
      for (const entry of fs.readdirSync(targetPath)) {
        sum += computeSize(path.join(targetPath, entry));
      }
      return sum;
    }
    return stat.size;
  }

  for (const entry of baseEntries) {
    if (seen.has(entry.path)) {
      continue;
    }
    seen.add(entry.path);
    const resolved = ensureSafePath(entry.path);
    if (fs.existsSync(resolved)) {
      const size = computeSize(resolved);
      totalBytes += size;
      existingCount += 1;
      entries.push({
        path: entry.path,
        absPath: resolved,
        sizeBytes: size,
        missing: false,
        kind: entry.kind
      });
    } else {
      missing.push(entry.path);
      entries.push({
        path: entry.path,
        absPath: resolved,
        sizeBytes: 0,
        missing: true,
        kind: entry.kind
      });
    }
  }

  const missingCount = missing.length;
  const summary = {
    totalEntries: baseEntries.length,
    existingCount,
    missingCount,
    totalBytes,
    entries,
    missing,
    structure
  };

  const mb = totalBytes / (1024 * 1024);
  console.log('Debloat dry-run summary:');
  console.log(`  Total entries in to_remove: ${baseEntries.length}`);
  console.log(`  Existing entries: ${existingCount}`);
  if (missingCount > 0) {
    console.log(`  Missing entries (will be ignored): ${missingCount}`);
  }
  console.log(`  Estimated reclaimable size: ${mb.toFixed(2)} MB (${totalBytes} bytes)`);

  fs.writeFileSync(summaryPath, JSON.stringify(summary));
} catch (error) {
  console.error(`Failed to prepare debloat summary: ${error.message}`);
  process.exit(1);
}
NODE
then
  echo "Error: Failed to compute debloat summary." >&2
  exit 1
fi

SUMMARY_JSON="$(cat "$SUMMARY_DATA_PATH")"

if [[ "$MODE" == "apply" ]]; then
  if ! SUMMARY_JSON="$SUMMARY_JSON" node <<'NODE'
const fs = require('fs');
const path = require('path');

const summary = JSON.parse(process.env.SUMMARY_JSON || '{}');
if (!summary || !Array.isArray(summary.entries)) {
  console.log('Nothing to remove.');
  process.exit(0);
}
if ((summary.totalEntries || 0) === 0) {
  console.log('No entries listed in to_remove; nothing to apply.');
  process.exit(0);
}

let removedCount = 0;
for (const entry of summary.entries) {
  if (!entry || typeof entry.path !== 'string') {
    continue;
  }
  if (entry.missing) {
    console.log(`Skipping ${entry.path} (not found).`);
    continue;
  }
  try {
    fs.rmSync(entry.absPath, { recursive: true, force: true });
    console.log(`Removed ${entry.path}`);
    removedCount += 1;
  } catch (error) {
    console.error(`Failed to remove ${entry.path}: ${error.message}`);
  }
}
console.log(`Removal complete. Removed ${removedCount} entr${removedCount === 1 ? 'y' : 'ies'}.`);
NODE
  then
    echo "Error: Failed to apply removals." >&2
    exit 1
  fi

  if ! SUMMARY_JSON="$SUMMARY_JSON" node <<'NODE'
const fs = require('fs');
const path = require('path');

function rebuildToRemove(structure, remainingEntries) {
  if (!Array.isArray(remainingEntries) || remainingEntries.length === 0) {
    return null;
  }

  if (!structure || structure.style === 'none' || structure.style === undefined) {
    return remainingEntries.map((entry) => entry.path);
  }

  if (structure.style === 'array') {
    return remainingEntries.map((entry) => entry.path);
  }

  if (structure.style === 'object') {
    const template = structure.raw && typeof structure.raw === 'object'
      ? JSON.parse(JSON.stringify(structure.raw))
      : {};

    const files = remainingEntries
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.path);
    const dirs = remainingEntries
      .filter((entry) => entry.kind === 'dir')
      .map((entry) => entry.path);

    if (files.length > 0) {
      template.files = files;
    } else {
      delete template.files;
    }

    if (dirs.length > 0) {
      template.dirs = dirs;
    } else {
      delete template.dirs;
    }

    return Object.keys(template).length > 0 ? template : null;
  }

  return remainingEntries.map((entry) => entry.path);
}

const summary = JSON.parse(process.env.SUMMARY_JSON || '{}');
const reportPath = 'debloat-report.json';
let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error('Unable to reopen debloat-report.json:', error.message);
  process.exit(1);
}
const remaining = [];
for (const entry of summary.entries || []) {
  if (!entry || typeof entry.path !== 'string') {
    continue;
  }
  const absPath = path.resolve(process.cwd(), entry.path);
  if (fs.existsSync(absPath)) {
    remaining.push({ path: entry.path, kind: entry.kind || 'unspecified' });
  }
}

const nextToRemove = rebuildToRemove(summary.structure, remaining);
if (nextToRemove && ((Array.isArray(nextToRemove) && nextToRemove.length > 0) || (!Array.isArray(nextToRemove) && Object.keys(nextToRemove).length > 0))) {
  report.to_remove = nextToRemove;
} else {
  delete report.to_remove;
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
NODE
  then
    echo "Error: Failed to update debloat-report.json after removal." >&2
    exit 1
  fi
fi

trap - EXIT
rm -f "$SUMMARY_DATA_PATH"

exit 0
