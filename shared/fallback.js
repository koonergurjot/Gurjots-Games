const REPO_SLUG = 'koonergurjot/Gurjots-Games';
const ISSUE_BASE_URL = `https://github.com/${REPO_SLUG}/issues/new`;

export function renderFallbackPanel(error, gameName) {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('fallback-panel');
  if (existing) return existing;

  const panel = document.createElement('div');
  panel.id = 'fallback-panel';
  panel.style.position = 'fixed';
  panel.style.inset = '0';
  panel.style.background = 'rgba(0,0,0,0.85)';
  panel.style.color = '#fff';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.alignItems = 'center';
  panel.style.justifyContent = 'center';
  panel.style.padding = '20px';
  panel.style.zIndex = '9999';
  panel.style.fontFamily = 'system-ui, sans-serif';

  const msg = document.createElement('pre');
  msg.style.whiteSpace = 'pre-wrap';
  msg.style.maxWidth = '90%';
  msg.textContent = error && error.stack ? error.stack : String(error);

  const btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.onclick = () => location.reload();
  btn.style.marginRight = '10px';

  const issue = document.createElement('a');
  issue.textContent = 'Open issue';
  const normalizedSlug = typeof gameName === 'string' && gameName.trim() ? gameName.trim() : 'unknown';
  const errorMessage = error && error.stack ? error.stack : String(error);
  const issueUrl = new URL(ISSUE_BASE_URL);
  issueUrl.searchParams.set('title', `${normalizedSlug} crash`);
  issueUrl.searchParams.set('body', [`### Game`, normalizedSlug || 'unknown', '', `### Message`, '```', errorMessage, '```', ''].join('\n'));
  issueUrl.searchParams.set('slug', normalizedSlug);
  issueUrl.searchParams.set('message', errorMessage);
  issue.href = issueUrl.toString();
  issue.target = '_blank';
  issue.rel = 'noopener noreferrer';

  const actions = document.createElement('div');
  actions.style.margin = '20px 0';
  actions.append(btn, issue);

  const info = document.createElement('pre');
  info.style.fontSize = '12px';
  info.style.whiteSpace = 'pre-wrap';
  const ua = navigator.userAgent;
  const dpr = window.devicePixelRatio || 1;
  const vp = `${innerWidth}x${innerHeight}`;
  info.textContent = `UA: ${ua}\nDPR: ${dpr}\nViewport: ${vp}`;

  panel.append(msg, actions, info);
  document.body.appendChild(panel);
  return panel;
}
