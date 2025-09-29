const globalScope = typeof window !== 'undefined' ? window : undefined;
const GAME_ID = 'platformer';
const BUTTON_ID = 'platformer-diagnostics-button';
const PANEL_ID = 'platformer-diagnostics-panel';
let updateTimer = 0;

function getBootRecord() {
  return globalScope?.__bootStatus?.[GAME_ID] || null;
}

function formatDetails(details) {
  if (!details || typeof details !== 'object') return '';
  const keys = Object.keys(details);
  if (!keys.length) return '';
  try {
    return JSON.stringify(details);
  } catch (_) {
    return String(details);
  }
}

function renderDiagnostics(panel) {
  const pre = panel?.querySelector('pre');
  if (!pre) return;
  const record = getBootRecord();
  const now = new Date();
  const lines = [];
  lines.push('Retro Platformer Diagnostics');
  lines.push(`Rendered at: ${now.toISOString()}`);
  lines.push('');

  if (!record) {
    lines.push('No boot status captured.');
    pre.textContent = lines.join('\n');
    return;
  }

  const origin = typeof record.createdAt === 'number' ? record.createdAt : 0;
  const phases = Array.isArray(record.phaseOrder) && record.phaseOrder.length
    ? record.phaseOrder.slice()
    : Object.keys(record.phases || {});
  phases.sort((a, b) => {
    const aAt = record.phases?.[a]?.at ?? 0;
    const bAt = record.phases?.[b]?.at ?? 0;
    return aAt - bAt;
  });

  lines.push('[Phases]');
  if (!phases.length) {
    lines.push('- (no phases recorded)');
  } else {
    for (const name of phases) {
      const entry = record.phases?.[name];
      if (!entry) continue;
      const at = entry.at ?? 0;
      const delta = origin ? at - origin : at;
      lines.push(`- ${name} @ +${Math.round(delta)}ms`);
      const meta = Object.assign({}, entry);
      delete meta.at;
      const detailText = formatDetails(meta);
      if (detailText) {
        lines.push(`    details: ${detailText}`);
      }
    }
  }

  lines.push('');
  lines.push('[Canvas]');
  const canvas = record.canvas || {};
  lines.push(`- size: ${(canvas.width ?? 'n/a')}x${(canvas.height ?? 'n/a')}`);
  if (typeof canvas.attached !== 'undefined') {
    lines.push(`- attached: ${canvas.attached}`);
  }
  if (canvas.lastChange) {
    const lastDelta = origin ? canvas.lastChange - origin : canvas.lastChange;
    lines.push(`- last change: +${Math.round(lastDelta)}ms`);
  }

  lines.push('');
  lines.push('[rAF]');
  const raf = record.raf || {};
  lines.push(`- ticks: ${raf.tickCount ?? 0}`);
  if (raf.sinceLastTick) {
    lines.push(`- last gap: ${Math.round(raf.sinceLastTick)}ms`);
  }
  if (raf.stalled) {
    lines.push('- stalled: true');
  }
  if (raf.noTickLogged) {
    lines.push('- watchdog noted missing ticks');
  }

  lines.push('');
  lines.push('[Watchdog logs]');
  const logs = Array.isArray(record.logs) ? record.logs.slice(-40) : [];
  if (!logs.length) {
    lines.push('- (no watchdog logs)');
  } else {
    for (const entry of logs) {
      const ts = entry.timestamp ? new Date(entry.timestamp).toISOString() : now.toISOString();
      const level = (entry.level || 'info').toUpperCase();
      lines.push(`- ${ts} ${level} ${entry.message}`);
      const detailText = formatDetails(entry.details);
      if (detailText) {
        lines.push(`    ${detailText}`);
      }
    }
  }

  pre.textContent = lines.join('\n');
}

function togglePanel(panel, button) {
  const isOpen = panel.dataset.open === 'true';
  if (isOpen) {
    panel.dataset.open = 'false';
    panel.style.display = 'none';
    panel.setAttribute('aria-hidden', 'true');
    button.setAttribute('aria-expanded', 'false');
    if (updateTimer) {
      if (globalScope?.clearInterval) {
        globalScope.clearInterval(updateTimer);
      }
      updateTimer = 0;
    }
  } else {
    panel.dataset.open = 'true';
    panel.style.display = 'block';
    panel.setAttribute('aria-hidden', 'false');
    button.setAttribute('aria-expanded', 'true');
    renderDiagnostics(panel);
    if (globalScope?.setInterval) {
      updateTimer = globalScope.setInterval(() => renderDiagnostics(panel), 1200);
    } else {
      updateTimer = 0;
    }
  }
}

function ensureUI() {
  if (!globalScope?.document) return;
  if (globalScope.document.getElementById(BUTTON_ID)) return;

  const button = globalScope.document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.className = 'btn';
  button.textContent = 'Diagnostics';
  button.style.position = 'fixed';
  button.style.right = '16px';
  button.style.bottom = '16px';
  button.style.zIndex = '1000';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');

  const panel = globalScope.document.createElement('div');
  panel.id = PANEL_ID;
  panel.dataset.open = 'false';
  panel.style.position = 'fixed';
  panel.style.right = '16px';
  panel.style.bottom = '68px';
  panel.style.width = '360px';
  panel.style.maxWidth = 'calc(100vw - 32px)';
  panel.style.maxHeight = '60vh';
  panel.style.padding = '12px 14px';
  panel.style.borderRadius = '12px';
  panel.style.border = '1px solid #27314b';
  panel.style.background = 'rgba(12, 16, 32, 0.95)';
  panel.style.boxShadow = '0 18px 40px rgba(0, 0, 0, 0.45)';
  panel.style.display = 'none';
  panel.style.color = '#e6f0ff';
  panel.style.fontFamily = 'ui-monospace, SFMono-Regular, Consolas, Menlo, monospace';
  panel.style.fontSize = '13px';
  panel.style.lineHeight = '1.5';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('aria-label', 'Platformer diagnostics');

  const pre = globalScope.document.createElement('pre');
  pre.style.margin = '0';
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.wordBreak = 'break-word';
  panel.appendChild(pre);

  button.addEventListener('click', () => togglePanel(panel, button));
  if (typeof globalScope.addEventListener === 'function') {
    globalScope.addEventListener('beforeunload', () => {
      if (updateTimer) {
        if (globalScope?.clearInterval) {
          globalScope.clearInterval(updateTimer);
        }
        updateTimer = 0;
      }
    }, { once: true });
  }

  globalScope.document.body.appendChild(button);
  globalScope.document.body.appendChild(panel);
}

function init() {
  if (!globalScope?.document) return;
  ensureUI();
}

if (globalScope?.document) {
  if (globalScope.document.readyState === 'loading') {
    globalScope.document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
