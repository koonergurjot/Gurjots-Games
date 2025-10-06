import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HEALTH_DIR = path.join(ROOT, 'health');
const REPORT_JSON = path.join(HEALTH_DIR, 'report.json');
const REPORT_MD = path.join(HEALTH_DIR, 'report.md');
const PLACEHOLDER_THUMB = 'assets/placeholder-thumb.png';

const gamesPath = path.join(ROOT, 'games.json');

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function deriveSlug(game) {
  if (typeof game.slug === 'string' && game.slug.trim()) {
    return game.slug.trim();
  }
  if (typeof game.id === 'string' && game.id.trim()) {
    return game.id.trim();
  }
  if (typeof game.playUrl === 'string' && game.playUrl.trim()) {
    const trimmed = game.playUrl.trim().replace(/\/+$/, '');
    const parts = trimmed.split('/').filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  return null;
}

function formatIssue(message, context = {}) {
  return {
    message,
    context,
  };
}

function ensureArray(value, label, issues) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push(formatIssue(`${label} is not an array`, { received: value }));
    return [];
  }
  return value;
}

function relativeFromRoot(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push('# Game Doctor Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push(`- Total games: ${report.summary.total}`);
  lines.push(`- Passing: ${report.summary.passing}`);
  lines.push(`- Failing: ${report.summary.failing}`);
  lines.push('');
  for (const game of report.games) {
    lines.push(`## ${game.title ?? game.slug ?? 'Unknown Game'}`);
    lines.push('');
    lines.push(`- Slug: ${game.slug ?? 'N/A'}`);
    lines.push(`- Status: ${game.ok ? '✅ Healthy' : '❌ Needs attention'}`);
    if (game.shell?.found) {
      lines.push(`- Shell: ${game.shell.found}`);
    } else {
      lines.push(`- Shell: missing`);
    }
    lines.push(`- Thumbnail: ${game.thumbnail?.found ?? 'missing'}`);
    if (game.assets?.sprites?.length) {
      lines.push(`- Sprites checked: ${game.assets.sprites.length}`);
    }
    if (game.assets?.audio?.length) {
      lines.push(`- Audio checked: ${game.assets.audio.length}`);
    }
    if (game.issues.length === 0) {
      lines.push('- Issues: none');
    } else {
      lines.push('- Issues:');
      for (const issue of game.issues) {
        lines.push(`  - ${issue.message}`);
        const entries = Object.entries(issue.context ?? {});
        if (entries.length) {
          for (const [key, value] of entries) {
            lines.push(`    - ${key}: ${JSON.stringify(value)}`);
          }
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  if (!(await pathExists(gamesPath))) {
    console.error(`Unable to locate games catalog at ${relativeFromRoot(gamesPath)}.`);
    process.exitCode = 1;
    return;
  }

  const raw = await fs.readFile(gamesPath, 'utf8');
  let games;
  try {
    games = JSON.parse(raw);
  } catch (error) {
    console.error('Failed to parse games.json:', error);
    process.exitCode = 1;
    return;
  }

  if (!Array.isArray(games)) {
    console.error('Expected games.json to contain an array of games.');
    process.exitCode = 1;
    return;
  }

  const results = [];

  for (const [index, game] of games.entries()) {
    const issues = [];

    const slug = deriveSlug(game);
    if (!slug) {
      issues.push(formatIssue('Unable to determine slug for game entry', { index }));
    }

    const title = typeof game.title === 'string' ? game.title : `Game #${index + 1}`;

    let foundShell = null;
    if (slug) {
      const shellCandidates = [
        path.join(ROOT, 'games', slug, 'index.html'),
        path.join(ROOT, 'gameshells', slug, 'index.html'),
      ];

      for (const candidate of shellCandidates) {
        // eslint-disable-next-line no-await-in-loop
        if (await pathExists(candidate)) {
          foundShell = relativeFromRoot(candidate);
          break;
        }
      }

      if (!foundShell) {
        issues.push(
          formatIssue('Missing playable shell', {
            tried: shellCandidates.map(relativeFromRoot),
          }),
        );
      }
    }

    const firstFrame = game.firstFrame ?? {};
    const spriteList = ensureArray(firstFrame.sprites, 'firstFrame.sprites', issues);
    const audioList = ensureArray(firstFrame.audio, 'firstFrame.audio', issues);

    const checkedSprites = [];
    for (const sprite of spriteList) {
      if (typeof sprite !== 'string' || !sprite.trim()) {
        issues.push(formatIssue('Sprite asset is not a valid path', { sprite }));
        continue;
      }
      if (!sprite.startsWith('/assets/')) {
        issues.push(formatIssue('Sprite asset must live under /assets/', { sprite }));
        continue;
      }
      const spritePath = path.join(ROOT, sprite.replace(/^\//, ''));
      // eslint-disable-next-line no-await-in-loop
      if (!(await pathExists(spritePath))) {
        issues.push(formatIssue('Sprite asset missing on disk', { sprite, expected: relativeFromRoot(spritePath) }));
        continue;
      }
      checkedSprites.push(relativeFromRoot(spritePath));
    }

    const checkedAudio = [];
    for (const audio of audioList) {
      if (typeof audio !== 'string' || !audio.trim()) {
        issues.push(formatIssue('Audio asset is not a valid path', { audio }));
        continue;
      }
      if (!audio.startsWith('/assets/')) {
        issues.push(formatIssue('Audio asset must live under /assets/', { audio }));
        continue;
      }
      const audioPath = path.join(ROOT, audio.replace(/^\//, ''));
      // eslint-disable-next-line no-await-in-loop
      if (!(await pathExists(audioPath))) {
        issues.push(formatIssue('Audio asset missing on disk', { audio, expected: relativeFromRoot(audioPath) }));
        continue;
      }
      checkedAudio.push(relativeFromRoot(audioPath));
    }

    let thumbnailFound = null;
    if (slug) {
      const thumbCandidates = [
        path.join(ROOT, 'assets', 'thumbs', `${slug}.png`),
        path.join(ROOT, 'games', slug, 'thumb.png'),
        path.join(ROOT, PLACEHOLDER_THUMB),
      ];
      for (const candidate of thumbCandidates) {
        // eslint-disable-next-line no-await-in-loop
        if (await pathExists(candidate)) {
          thumbnailFound = relativeFromRoot(candidate);
          break;
        }
      }
      if (!thumbnailFound) {
        issues.push(
          formatIssue('Thumbnail missing', {
            tried: thumbCandidates.map(relativeFromRoot),
          }),
        );
      }
    }

    const result = {
      index,
      title,
      slug,
      ok: issues.length === 0,
      issues,
      shell: { found: foundShell },
      assets: {
        sprites: checkedSprites,
        audio: checkedAudio,
      },
      thumbnail: { found: thumbnailFound },
    };

    results.push(result);
  }

  const summary = {
    total: results.length,
    passing: results.filter((game) => game.ok).length,
    failing: results.filter((game) => !game.ok).length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    games: results,
  };

  await fs.mkdir(HEALTH_DIR, { recursive: true });
  await fs.writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(REPORT_MD, `${buildMarkdownReport(report)}\n`, 'utf8');

  if (summary.failing > 0) {
    console.error(
      `Game doctor found ${summary.failing} of ${summary.total} game(s) with issues. See ${relativeFromRoot(
        REPORT_JSON,
      )} for details.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`Game doctor: all ${summary.total} game(s) look healthy!`);
  }
}

await main();
