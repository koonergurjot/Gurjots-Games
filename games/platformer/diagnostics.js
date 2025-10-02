import { pushEvent } from '../common/diag-adapter.js';

const globalScope = typeof window !== 'undefined' ? window : undefined;
const GAME_ID = 'platformer';
const SNAPSHOT_INTERVAL = 5000;
let intervalId = 0;

function getBootRecord() {
  return globalScope?.__bootStatus?.[GAME_ID] || null;
}

function buildPhaseSnapshot(record) {
  const phases = [];
  const source = Array.isArray(record.phaseOrder) && record.phaseOrder.length
    ? record.phaseOrder.slice()
    : Object.keys(record.phases || {});
  source.sort((a, b) => {
    const aAt = record.phases?.[a]?.at ?? 0;
    const bAt = record.phases?.[b]?.at ?? 0;
    return aAt - bAt;
  });
  for (const name of source.slice(-12)) {
    const entry = record.phases?.[name];
    if (!entry) continue;
    phases.push({
      name,
      at: entry.at ?? null,
      details: Object.keys(entry)
        .filter((key) => key !== 'at')
        .reduce((acc, key) => {
          acc[key] = entry[key];
          return acc;
        }, {}),
    });
  }
  return phases;
}

function buildLogSnapshot(record) {
  if (!Array.isArray(record.logs) || !record.logs.length) return [];
  return record.logs.slice(-10).map((entry) => ({
    level: entry.level || 'info',
    message: entry.message || '',
    timestamp: entry.timestamp || Date.now(),
  }));
}

function buildSnapshot(record) {
  return {
    createdAt: record.createdAt ?? null,
    phases: buildPhaseSnapshot(record),
    raf: record.raf
      ? {
          tickCount: record.raf.tickCount ?? 0,
          sinceLastTick: record.raf.sinceLastTick ?? null,
          stalled: !!record.raf.stalled,
          noTickLogged: !!record.raf.noTickLogged,
        }
      : null,
    canvas: record.canvas
      ? {
          width: record.canvas.width ?? null,
          height: record.canvas.height ?? null,
          attached: record.canvas.attached ?? null,
          lastChange: record.canvas.lastChange ?? null,
        }
      : null,
    watchdogs: record.watchdogs
      ? {
          active: !!record.watchdogs.active,
          armedAt: record.watchdogs.armedAt ?? null,
        }
      : null,
    logs: buildLogSnapshot(record),
  };
}

function publishSnapshot(reason) {
  const record = getBootRecord();
  if (!record) {
    pushEvent('game', {
      level: 'info',
      message: `[${GAME_ID}] ${reason}`,
      details: { note: 'No boot diagnostics recorded yet.' },
    });
    return;
  }

  const latestLog = Array.isArray(record.logs) && record.logs.length
    ? record.logs[record.logs.length - 1]
    : null;
  const level = latestLog?.level === 'error'
    ? 'error'
    : record.raf?.stalled
      ? 'warn'
      : 'info';

  pushEvent('game', {
    level,
    message: `[${GAME_ID}] ${reason}`,
    details: buildSnapshot(record),
  });
}

function startPublishing() {
  if (!globalScope || !globalScope.document) return;
  const trigger = () => publishSnapshot('snapshot ready');
  if (globalScope.document.readyState === 'loading') {
    globalScope.document.addEventListener('DOMContentLoaded', trigger, { once: true });
  } else {
    trigger();
  }
  if (typeof globalScope.setInterval === 'function') {
    intervalId = globalScope.setInterval(() => publishSnapshot('watchdog update'), SNAPSHOT_INTERVAL);
    globalScope.addEventListener?.('beforeunload', () => {
      if (intervalId && typeof globalScope.clearInterval === 'function') {
        globalScope.clearInterval(intervalId);
      }
      intervalId = 0;
    }, { once: true });
  }
}

startPublishing();
