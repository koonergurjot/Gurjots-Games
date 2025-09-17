#!/usr/bin/env node
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const repoRoot = process.cwd();
const REQUIRED_ROOT_ITEMS = ['index.html', 'games'];
const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cmake',
  '.config',
  '.cpp',
  '.csv',
  '.css',
  '.env',
  '.go',
  '.graphql',
  '.h',
  '.hbs',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.lock',
  '.log',
  '.lua',
  '.m',
  '.md',
  '.mjs',
  '.php',
  '.pl',
  '.properties',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.srt',
  '.styl',
  '.svg',
  '.swift',
  '.tex',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.wasm.map',
  '.xml',
  '.yaml',
  '.yml'
]);
const BINARY_EXTENSIONS = new Set([
  '.7z',
  '.bmp',
  '.class',
  '.dat',
  '.dll',
  '.dylib',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.ogg',
  '.otf',
  '.pdf',
  '.png',
  '.psd',
  '.so',
  '.tar',
  '.tgz',
  '.tif',
  '.tiff',
  '.ttf',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.zip'
]);

const JUNK_DIR_RULES = [
  {
    match: (rel, name) => name === '__MACOSX',
    reason: 'macOS archive metadata directory'
  },
  {
    match: (rel, name) => name === '.Trashes' || name === '.Trash',
    reason: 'Trash directory from macOS archives'
  },
  {
    match: (rel, name) => name === '.Spotlight-V100',
    reason: 'macOS Spotlight index data'
  },
  {
    match: (rel, name) => name === '.fseventsd',
    reason: 'macOS file system events logs'
  },
  {
    match: (rel, name) => name === '.TemporaryItems',
    reason: 'Temporary workspace files from macOS'
  }
];

const JUNK_FILE_RULES = [
  {
    match: (rel, name) => name === '.DS_Store',
    reason: 'macOS Finder metadata file'
  },
  {
    match: (rel, name) => name.toLowerCase() === 'thumbs.db',
    reason: 'Windows Explorer thumbnail cache file'
  },
  {
    match: (rel, name) => name.toLowerCase() === 'desktop.ini',
    reason: 'Windows Explorer metadata file'
  },
  {
    match: (rel, name) => name.toLowerCase() === 'ehthumbs.db',
    reason: 'Legacy Windows thumbnail cache file'
  },
  {
    match: (rel, name) => name.endsWith('~') || name.endsWith('.swp') || name.endsWith('.tmp'),
    reason: 'Editor or operating system temporary file'
  }
];

const IGNORED_DIRECTORIES = new Set(['.git', '.hg', '.svn']);
const LARGE_ASSET_THRESHOLD = 200 * 1024;

const { access, readdir, stat, open, readFile, writeFile } = fsp;

async function ensureRepoRoot() {
  for (const item of REQUIRED_ROOT_ITEMS) {
    try {
      await access(path.join(repoRoot, item), fs.constants.F_OK);
    } catch (error) {
      throw new Error(
        `scan-debloat must be executed from the repository root. Missing required entry: ${item}`
      );
    }
  }
}

function isLikelyTextBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    return true;
  }
  let suspicious = 0;
  const limit = Math.min(buffer.length, 4096);
  for (let i = 0; i < limit; i += 1) {
    const byte = buffer[i];
    if (byte === 0) {
      return false;
    }
    if (byte < 7 || (byte > 13 && byte < 32) || byte === 127) {
      suspicious += 1;
    }
  }
  return suspicious / limit < 0.3;
}

async function detectTextStatus(absPath, size, extension) {
  if (TEXT_EXTENSIONS.has(extension)) {
    try {
      const content = await readFile(absPath, 'utf8');
      return { isText: true, content };
    } catch (error) {
      return { isText: false, content: null };
    }
  }
  if (BINARY_EXTENSIONS.has(extension)) {
    return { isText: false, content: null };
  }

  const fd = await open(absPath, 'r');
  try {
    const length = Math.min(size, 4096);
    const buffer = Buffer.alloc(length);
    await fd.read(buffer, 0, length, 0);
    const isText = isLikelyTextBuffer(buffer);
    if (!isText) {
      return { isText: false, content: null };
    }
  } finally {
    await fd.close();
  }

  try {
    const content = await readFile(absPath, 'utf8');
    return { isText: true, content };
  } catch (error) {
    return { isText: false, content: null };
  }
}

function getJunkDirectoryReason(relPath, entryName) {
  for (const rule of JUNK_DIR_RULES) {
    if (rule.match(relPath, entryName)) {
      return rule.reason;
    }
  }
  return null;
}

function getJunkFileReason(relPath, entryName) {
  for (const rule of JUNK_FILE_RULES) {
    if (rule.match(relPath, entryName)) {
      return rule.reason;
    }
  }
  return null;
}

function toPosixRelative(targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join('/');
}

function computeFileHash(absPath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(absPath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function walkDirectory(currentPath, activeJunkDirs = []) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(currentPath, entry.name);
    const relPath = toPosixRelative(absPath);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const reason = getJunkDirectoryReason(relPath, entry.name);
      if (reason && !junkDirectoriesMap.has(relPath)) {
        junkDirectoriesMap.set(relPath, {
          path: relPath,
          reason,
          estimatedSizeBytes: 0,
          fileCount: 0
        });
      }
      const nextActive = [...activeJunkDirs];
      if (reason) {
        nextActive.push(relPath);
      }
      await walkDirectory(absPath, nextActive);
      continue;
    }
    if (entry.isFile()) {
      await analyzeFile(absPath, relPath, activeJunkDirs);
    }
  }
}

async function analyzeFile(absPath, relPath, activeJunkDirs) {
  const fileStat = await stat(absPath);
  if (!fileStat.isFile()) {
    return;
  }
  const sizeBytes = fileStat.size;
  const extension = path.extname(relPath).toLowerCase();

  totals.fileCount += 1;
  totals.totalSizeBytes += sizeBytes;

  const { isText, content } = await detectTextStatus(absPath, sizeBytes, extension);
  if (isText) {
    textFiles.push({
      path: relPath,
      sizeBytes,
      extension: extension || null
    });
    textContents.push({ path: relPath, content: content ?? '' });
    textTotals.fileCount += 1;
    textTotals.totalSizeBytes += sizeBytes;

    const bucket = extension || '<no-ext>';
    if (!textTotals.byExtension[bucket]) {
      textTotals.byExtension[bucket] = { fileCount: 0, totalSizeBytes: 0 };
    }
    textTotals.byExtension[bucket].fileCount += 1;
    textTotals.byExtension[bucket].totalSizeBytes += sizeBytes;
  }

  const junkFileReason = getJunkFileReason(relPath, path.basename(relPath));
  if (junkFileReason) {
    junkFiles.push({ path: relPath, reason: junkFileReason, sizeBytes });
    registerRemovalCandidate(relPath, sizeBytes, `Junk file: ${junkFileReason}`);
  }

  if (
    relPath.startsWith('assets/libs/') ||
    relPath === 'assets/libs' ||
    relPath.startsWith('libs/') ||
    relPath === 'libs'
  ) {
    if (fileStat.isFile()) {
      const hash = await computeFileHash(absPath);
      const entry = {
        path: relPath,
        fileName: path.posix.basename(relPath),
        sizeBytes,
        sha256: hash
      };
      libraryEntries.push(entry);
    }
  }

  if (
    (relPath.startsWith('assets/') || relPath.startsWith('public/') || relPath.startsWith('static/')) &&
    sizeBytes >= LARGE_ASSET_THRESHOLD
  ) {
    assetCandidates.push({ path: relPath, sizeBytes });
  }

  for (const dirPath of activeJunkDirs) {
    const dirInfo = junkDirectoriesMap.get(dirPath);
    if (dirInfo) {
      dirInfo.estimatedSizeBytes += sizeBytes;
      dirInfo.fileCount += 1;
    }
  }
}

function registerRemovalCandidate(pathKey, sizeBytes, reason) {
  if (!removalCandidates.has(pathKey)) {
    removalCandidates.set(pathKey, { path: pathKey, sizeBytes, reason });
  }
}

function detectDuplicateLibraries() {
  const groups = new Map();
  for (const entry of libraryEntries) {
    const key = `${entry.sha256}::${entry.fileName}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
  }

  const duplicates = [];
  for (const [key, entries] of groups.entries()) {
    if (entries.length > 1) {
      const [hash, name] = key.split('::');
      duplicates.push({
        fileName: name,
        sha256: hash,
        instances: entries.map((entry) => ({ path: entry.path, sizeBytes: entry.sizeBytes }))
      });

      const sortedBySize = entries.slice().sort((a, b) => b.sizeBytes - a.sizeBytes);
      const [keep] = sortedBySize;
      for (const candidate of entries) {
        if (candidate.path === keep.path) {
          continue;
        }
        registerRemovalCandidate(
          candidate.path,
          candidate.sizeBytes,
          `Duplicate library (same name and SHA-256 as ${keep.path})`
        );
      }
    }
  }
  return duplicates;
}

function markUnreferencedAssets() {
  if (assetCandidates.length === 0) {
    return [];
  }

  const referenced = new Set();
  for (const textEntry of textContents) {
    const content = textEntry.content;
    if (!content) {
      continue;
    }
    for (const asset of assetCandidates) {
      if (referenced.has(asset.path)) {
        continue;
      }
      if (content.includes(asset.path)) {
        referenced.add(asset.path);
      }
    }
  }

  const unreferenced = [];
  for (const asset of assetCandidates) {
    if (!referenced.has(asset.path)) {
      unreferenced.push({
        path: asset.path,
        sizeBytes: asset.sizeBytes,
        reason: 'Asset >=200KB not referenced by textual files'
      });
      registerRemovalCandidate(
        asset.path,
        asset.sizeBytes,
        'Unreferenced large asset (no textual references found)'
      );
    }
  }
  return unreferenced;
}

function buildReport(duplicateLibraries, unreferencedAssets) {
  const removalList = Array.from(removalCandidates.values());
  const removableSizeBytes = removalList.reduce((sum, item) => sum + item.sizeBytes, 0);
  const removableCount = removalList.length;

  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    repoRoot,
    initialTotals: { ...totals },
    textInventory: {
      fileCount: textTotals.fileCount,
      totalSizeBytes: textTotals.totalSizeBytes,
      byExtension: textTotals.byExtension,
      files: textFiles
    },
    libraryHashes: {
      assetsLibs: libraryEntries
        .filter((entry) => entry.path.startsWith('assets/libs/'))
        .map((entry) => ({ path: entry.path, sizeBytes: entry.sizeBytes, sha256: entry.sha256 })),
      rootLibs: libraryEntries
        .filter((entry) => entry.path.startsWith('libs/'))
        .map((entry) => ({ path: entry.path, sizeBytes: entry.sizeBytes, sha256: entry.sha256 }))
    },
    duplicateLibraries,
    junk: {
      directories: Array.from(junkDirectoriesMap.values()),
      files: junkFiles
    },
    largeAssets: {
      thresholdBytes: LARGE_ASSET_THRESHOLD,
      scannedCount: assetCandidates.length,
      unreferenced: unreferencedAssets
    },
    removalCandidates: removalList,
    finalEstimates: {
      removableCount,
      removableSizeBytes,
      estimatedRemainingCount: Math.max(totals.fileCount - removableCount, 0),
      estimatedRemainingSizeBytes: Math.max(totals.totalSizeBytes - removableSizeBytes, 0)
    },
    notes: [
      'This helper only reports findings and never deletes or modifies repository files.',
      'Large asset analysis is conservative and relies on substring matches across textual files; runtime or hashed references may not be detected.',
      'Junk directory and file rules target well-known OS metadata and editor artifacts to avoid flagging project assets.'
    ]
  };
}

const totals = {
  fileCount: 0,
  totalSizeBytes: 0
};
const textTotals = {
  fileCount: 0,
  totalSizeBytes: 0,
  byExtension: {}
};
const textFiles = [];
const textContents = [];
const libraryEntries = [];
const junkDirectoriesMap = new Map();
const junkFiles = [];
const assetCandidates = [];
const removalCandidates = new Map();

async function main() {
  try {
    await ensureRepoRoot();
    await walkDirectory(repoRoot);
    const duplicateLibraries = detectDuplicateLibraries();
    const unreferencedAssets = markUnreferencedAssets();
    const report = buildReport(duplicateLibraries, unreferencedAssets);
    const outputPath = path.join(repoRoot, 'debloat-report.json');
    await writeFile(outputPath, JSON.stringify(report, null, 2));
    console.log(`Debloat report generated at ${outputPath}`);
  } catch (error) {
    console.error(`scan-debloat failed: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
