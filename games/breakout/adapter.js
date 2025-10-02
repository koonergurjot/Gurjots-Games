import { registerGameDiagnostics } from '../common/diagnostics/adapter.js';
import { pushEvent } from '../common/diag-adapter.js';

const scope = typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : undefined);

function whenBreakoutReady(callback) {
  if (!scope || typeof callback !== 'function') return;
  const queue = Array.isArray(scope.__BREAKOUT_READY__)
    ? scope.__BREAKOUT_READY__
    : (scope.__BREAKOUT_READY__ = []);
  if (scope.Breakout && scope.Breakout.engine) {
    callback(scope.Breakout);
    return;
  }
  queue.push(callback);
}

function snapshot(game) {
  const source = game || {};
  const ball = source.ball || null;
  const paddle = source.paddle || null;
  const bricks = Array.isArray(source.bricks) ? source.bricks : [];
  return {
    score: typeof source.score === 'number' ? source.score : Number(source.score) || 0,
    ball: ball ? {
      x: ball.x,
      y: ball.y,
      vx: ball.vx,
      vy: ball.vy,
      speed: ball.speed,
      radius: ball.r,
      stuck: !!ball.stuck,
    } : null,
    paddle: paddle ? {
      x: paddle.x,
      y: paddle.y,
      w: paddle.w,
      h: paddle.h,
    } : null,
    bricks: bricks.map((brick, index) => ({
      index,
      x: brick.x,
      y: brick.y,
      w: brick.w,
      h: brick.h,
      hp: brick.hp,
      power: brick.pu || null,
    })),
  };
}

whenBreakoutReady((game) => {
  try {
    registerGameDiagnostics('breakout', {
      hooks: {
        onReady(context) {
          pushEvent('breakout', {
            level: 'info',
            message: 'Breakout diagnostics adapter ready',
            details: { score: game.score ?? 0 },
          });
          if (typeof context?.requestProbeRun === 'function') {
            context.requestProbeRun('Initial breakout snapshot');
          }
        },
      },
      api: {
        start() {
          game.engine?.start?.();
        },
        pause() {
          game.engine?.pause?.();
        },
        resume() {
          game.engine?.resume?.();
        },
        reset() {
          game.resetMatch?.();
        },
        getScore() {
          return game.score ?? 0;
        },
        async getEntities() {
          return snapshot(game);
        },
      },
    });
  } catch (err) {
    pushEvent('breakout', {
      level: 'error',
      message: 'Failed to register Breakout diagnostics adapter',
      error: err,
    });
  }
});
