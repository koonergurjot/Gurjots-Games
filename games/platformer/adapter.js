import { registerGameDiagnostics } from '../common/diagnostics/adapter.js';

const globalScope = typeof window !== 'undefined' ? window : undefined;
const GAME_SLUG = 'platformer';

if (globalScope) {
  const platformer = (() => {
    const existing = globalScope.Platformer;
    if (existing && typeof existing === 'object') {
      return existing;
    }
    const api = {};
    globalScope.Platformer = api;
    return api;
  })();

  const ensureArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'function') return [value];
    if (typeof Set !== 'undefined' && value instanceof Set) {
      return Array.from(value);
    }
    return [];
  };

  platformer.onState = ensureArray(platformer.onState);
  platformer.onScore = ensureArray(platformer.onScore);

  const stateEvents = [];
  const scoreEvents = [];

  const handleState = (event) => {
    if (!event) return;
    stateEvents.push(event);
    if (stateEvents.length > 25) stateEvents.shift();
  };

  const handleScore = (event) => {
    if (!event) return;
    scoreEvents.push(event);
    if (scoreEvents.length > 25) scoreEvents.shift();
  };

  platformer.onState.push(handleState);
  platformer.onScore.push(handleScore);

  registerGameDiagnostics(GAME_SLUG, {
    hooks: {
      onReady(context) {
        if (platformer.onState.includes(handleState) === false) {
          platformer.onState.push(handleState);
        }
        if (platformer.onScore.includes(handleScore) === false) {
          platformer.onScore.push(handleScore);
        }
        context.summaryRefs?.status?.setAttribute?.('data-platformer-status', 'ready');
      },
      onStateChange(context) {
        if (!context || !context.summaryRefs) return;
        const latest = stateEvents[stateEvents.length - 1];
        if (!latest) return;
        const status = context.summaryRefs.status;
        if (status) {
          const label = latest.type === 'gameover' ? 'Game Over' : latest.type === 'collect' ? 'Collecting' : latest.type === 'restart' ? 'Restarted' : 'Running';
          status.textContent = label;
          status.dataset.platformerState = latest.type;
        }
      },
      onScoreChange(context) {
        const score = scoreEvents[scoreEvents.length - 1];
        if (!score) return;
        if (context.summaryRefs?.score) {
          context.summaryRefs.score.textContent = `${score.collected}/${score.totalCoins}`;
        }
      },
    },
    api: {
      start() {
        return platformer.start?.();
      },
      pause() {
        return platformer.pause?.();
      },
      resume() {
        return platformer.resume?.();
      },
      reset() {
        return platformer.restartGame?.();
      },
      getScore() {
        return platformer.localPlayer?.collected ?? 0;
      },
      async getEntities() {
        const localPlayer = platformer.localPlayer ? { ...platformer.localPlayer } : null;
        const coins = Array.isArray(platformer.coins)
          ? platformer.coins.map((coin) => ({ ...coin }))
          : [];
        const goal = platformer.goal ? { ...platformer.goal } : null;
        return { localPlayer, coins, goal };
      },
    },
  });
}
