import { registerGameDiagnostics } from '../common/diagnostics/adapter.js';

const SLUG = 'shooter';
const globalScope = typeof window !== 'undefined' ? window : undefined;
let registered = false;

function cloneEntity(entity) {
  if (!entity || typeof entity !== 'object') return null;
  const snapshot = {};
  if ('x' in entity) snapshot.x = Number(entity.x);
  if ('y' in entity) snapshot.y = Number(entity.y);
  if ('r' in entity) snapshot.r = Number(entity.r);
  if ('vx' in entity) snapshot.vx = Number(entity.vx);
  if ('vy' in entity) snapshot.vy = Number(entity.vy);
  if ('hp' in entity) snapshot.hp = Number(entity.hp);
  if ('cd' in entity) snapshot.cd = Number(entity.cd);
  return snapshot;
}

function cloneCollection(list) {
  if (!Array.isArray(list)) return [];
  return list.map(cloneEntity).filter(Boolean);
}

function registerWithShooter(shooter) {
  if (!shooter || registered) return;
  try {
    registerGameDiagnostics(SLUG, {
      hooks: {},
      api: {
        start: () => shooter.startLoop?.(),
        pause: () => shooter.pauseForShell?.(),
        resume: () => shooter.resumeFromShell?.(),
        reset: () => shooter.restart?.(),
        getScore: () => ({
          score: shooter.score ?? 0,
          hp: shooter.hp ?? 0,
          state: shooter.state ?? 'unknown',
        }),
        getEntities: () => ({
          player: cloneEntity(shooter.player),
          enemies: cloneCollection(shooter.enemies),
          bullets: cloneCollection(shooter.bullets),
        }),
      },
    });
    registered = true;
  } catch (error) {
    console.warn('[shooter] diagnostics adapter registration failed', error);
  }
}

function subscribeToShooterReady(holder) {
  const target = holder && typeof holder === 'object' ? holder : {};
  const queue = Array.isArray(target.onReady) ? target.onReady : (target.onReady = []);
  queue.push((api) => {
    if (registered) return;
    const shooter = api && typeof api === 'object' ? api : globalScope?.Shooter;
    registerWithShooter(shooter);
  });
  if (!Array.isArray(holder?.onReady) && globalScope) {
    globalScope.Shooter = Object.assign(holder || {}, { onReady: queue });
  }
}

if (globalScope) {
  const shooter = globalScope.Shooter;
  if (shooter && typeof shooter === 'object' && typeof shooter.startLoop === 'function') {
    registerWithShooter(shooter);
  } else if (shooter && typeof shooter === 'object') {
    subscribeToShooterReady(shooter);
  } else {
    globalScope.Shooter = { onReady: [] };
    subscribeToShooterReady(globalScope.Shooter);
  }
}
