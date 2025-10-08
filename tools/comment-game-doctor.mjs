import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPORT_MD_PATH = path.join(ROOT, 'health', 'report.md');
const REPORT_JSON_PATH = path.join(ROOT, 'health', 'report.json');
const DEFAULT_TEST_LOG_PATH = path.join('health', 'game-doctor-tests.log');
const DEFAULT_RUN_LOG_PATH = path.join('health', 'game-doctor.log');
const MAX_LOG_CHARACTERS = 60000;

function log(message) {
  console.log(`[comment-game-doctor] ${message}`);
}

function warn(message) {
  console.warn(`[comment-game-doctor] ${message}`);
}

async function readReportMarkdown() {
  try {
    const markdown = await fs.readFile(REPORT_MD_PATH, 'utf8');
    return markdown.trim();
  } catch (error) {
    if (error.code === 'ENOENT') {
      warn(`Game Doctor report markdown missing at ${path.relative(ROOT, REPORT_MD_PATH)}.`);
      return null;
    }
    throw error;
  }
}

async function readSummaryLine() {
  try {
    const raw = await fs.readFile(REPORT_JSON_PATH, 'utf8');
    const report = JSON.parse(raw);
    const summary = report?.summary ?? {};
    const total = summary.total ?? 0;
    const passing = summary.passing ?? 0;
    const failing = summary.failing ?? 0;
    const warnings = summary.withWarnings ?? 0;
    const warningSegment = warnings > 0 ? ` · ${warnings} with warnings` : '';
    return `**Summary:** ${passing}/${total} passing · ${failing} failing${warningSegment}.`;
  } catch (error) {
    warn(`Unable to read summary from ${path.relative(ROOT, REPORT_JSON_PATH)}: ${error.message}`);
    return null;
  }
}

function parseExitCode(raw) {
  if (raw == null || raw === '') {
    return null;
  }
  const value = Number.parseInt(String(raw), 10);
  if (Number.isNaN(value)) {
    return null;
  }
  return value;
}

function resolveLogPath(rawPath, fallbackRelative) {
  const candidate = rawPath && rawPath.trim().length > 0 ? rawPath.trim() : fallbackRelative;
  if (!candidate) {
    return null;
  }
  return path.isAbsolute(candidate) ? candidate : path.join(ROOT, candidate);
}

async function loadLogDetails(label, rawPath) {
  if (!rawPath) {
    return { missing: true, relativePath: null };
  }
  const relativePath = path.relative(ROOT, rawPath);
  try {
    const raw = await fs.readFile(rawPath, 'utf8');
    let content = raw.replace(/\s+$/u, '');
    let truncated = false;
    if (content.length > MAX_LOG_CHARACTERS) {
      truncated = true;
      content = content.slice(content.length - MAX_LOG_CHARACTERS);
      const firstNewline = content.indexOf('\n');
      if (firstNewline > 0) {
        content = content.slice(firstNewline + 1);
      }
      content = content.replace(/^\s+/u, '');
    }
    return { content, truncated, relativePath };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      warn(`Log for ${label} not found at ${relativePath}.`);
      return { missing: true, relativePath };
    }
    warn(`Unable to read log for ${label} at ${relativePath}: ${error.message}`);
    return { missing: true, relativePath };
  }
}

async function collectFailureDetails() {
  const failures = [];
  const descriptors = [
    {
      label: 'Game Doctor tests',
      exitCode: parseExitCode(process.env.GAME_DOCTOR_TESTS_EXIT_CODE),
      rawPath: resolveLogPath(process.env.GAME_DOCTOR_TESTS_LOG, DEFAULT_TEST_LOG_PATH),
    },
    {
      label: 'Game Doctor run',
      exitCode: parseExitCode(process.env.GAME_DOCTOR_EXIT_CODE),
      rawPath: resolveLogPath(process.env.GAME_DOCTOR_LOG, DEFAULT_RUN_LOG_PATH),
    },
  ];

  for (const descriptor of descriptors) {
    if (descriptor.exitCode == null || descriptor.exitCode === 0) {
      continue;
    }
    const log = await loadLogDetails(descriptor.label, descriptor.rawPath);
    failures.push({ label: descriptor.label, exitCode: descriptor.exitCode, log });
  }

  return failures;
}

async function loadPullRequestContext() {
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  if (!eventName.startsWith('pull_request')) {
    log(`Skipping comment because event \"${eventName}\" is not a pull request.`);
    return null;
  }

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    warn('Skipping comment because GITHUB_REPOSITORY is not set.');
    return null;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    warn('Skipping comment because GITHUB_EVENT_PATH is not provided.');
    return null;
  }

  let payload;
  try {
    const raw = await fs.readFile(eventPath, 'utf8');
    payload = JSON.parse(raw);
  } catch (error) {
    warn(`Skipping comment because workflow event payload cannot be read: ${error.message}`);
    return null;
  }

  const prNumber = payload?.number ?? payload?.pull_request?.number ?? null;
  if (!prNumber) {
    warn('Skipping comment because pull request number could not be determined from event payload.');
    return null;
  }

  const headRepo = payload?.pull_request?.head?.repo?.full_name;
  const baseRepo = payload?.pull_request?.base?.repo?.full_name;
  const isFork = payload?.pull_request?.head?.repo?.fork ?? false;
  if (isFork && headRepo && baseRepo && headRepo !== baseRepo) {
    log('Skipping comment because the pull request originates from a forked repository.');
    return null;
  }

  return { repo, prNumber };
}

async function postComment({ repo, prNumber }, body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    warn('Skipping comment because GITHUB_TOKEN is not set.');
    return;
  }

  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'game-doctor-commenter',
    },
    body: JSON.stringify({ body }),
  });

  if (response.ok) {
    log(`Posted comment to pull request #${prNumber}.`);
    return;
  }

  const responseText = await response.text();
  if (response.status === 403) {
    warn(
      `GitHub API returned 403 Forbidden when creating comment. Message: ${responseText.trim() || 'no response body.'}`,
    );
    return;
  }

  throw new Error(`GitHub API responded with ${response.status}: ${responseText}`);
}

async function main() {
  const context = await loadPullRequestContext();
  if (!context) {
    return;
  }

  const markdown = await readReportMarkdown();
  const summary = await readSummaryLine();
  const failures = await collectFailureDetails();

  const hasReport = Boolean(markdown);
  let summaryLine = summary;
  if (!summaryLine) {
    if (failures.length > 0) {
      summaryLine = '⚠️ Game Doctor encountered failures. See logs below.';
    } else if (hasReport) {
      summaryLine = '✅ Game Doctor report generated. See details below.';
    } else {
      summaryLine = '⚠️ Game Doctor report was not generated.';
    }
  }

  if (!hasReport && failures.length === 0 && !summaryLine) {
    warn('Skipping comment because no report or failure information is available.');
    return;
  }

  const sections = ['### 🩺 Game Doctor results'];
  if (summaryLine) {
    sections.push('', summaryLine);
  }

  if (failures.length > 0) {
    sections.push('', '#### ❌ Failure details');
    for (const failure of failures) {
      sections.push('', `**${failure.label}** exited with code ${failure.exitCode}.`);
      if (failure.log?.content) {
        sections.push(
          '',
          '<details>',
          `<summary>View ${failure.label.toLowerCase()} log</summary>`,
          '',
          '```text',
          failure.log.content,
          '```',
        );
        if (failure.log.truncated) {
          sections.push('', `_Log truncated to the last ${MAX_LOG_CHARACTERS.toLocaleString('en-US')} characters._`);
        }
        sections.push('', '</details>');
      } else if (failure.log?.missing) {
        const relativePath = failure.log.relativePath ?? '(unknown path)';
        sections.push('', `_Log file ${relativePath} is not available._`);
      }
    }
  }

  if (hasReport) {
    sections.push('', '<details>', '<summary>View full report</summary>', '', '```markdown', markdown, '```', '', '</details>');
  }

  const commentBody = sections.join('\n');
  try {
    await postComment(context, commentBody);
  } catch (error) {
    warn(`Failed to post comment: ${error.message}`);
  }
}

await main();
