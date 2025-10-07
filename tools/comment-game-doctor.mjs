import { promises as fs } from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPORT_MD_PATH = path.join(ROOT, 'health', 'report.md');
const REPORT_JSON_PATH = path.join(ROOT, 'health', 'report.json');

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
      warn(`Skipping comment because ${path.relative(ROOT, REPORT_MD_PATH)} is missing.`);
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
    return `**Summary:** ${passing}/${total} passing · ${failing} failing.`;
  } catch (error) {
    warn(`Unable to read summary from ${path.relative(ROOT, REPORT_JSON_PATH)}: ${error.message}`);
    return null;
  }
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
  if (!markdown) {
    return;
  }

  const summary = await readSummaryLine();

  const sections = ['### 🩺 Game Doctor results'];
  if (summary) {
    sections.push('', summary);
  }
  sections.push('', '<details>', '<summary>View full report</summary>', '', '```markdown', markdown, '```', '', '</details>');

  const commentBody = sections.join('\n');
  try {
    await postComment(context, commentBody);
  } catch (error) {
    warn(`Failed to post comment: ${error.message}`);
  }
}

await main();
