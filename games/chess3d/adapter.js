import { registerGameDiagnostics } from "../common/diagnostics/adapter.js";
import { pushEvent } from "/games/common/diag-adapter.js";

const GAME_ID = "chess3d";
const globalScope = typeof window !== "undefined" ? window : undefined;

function getController() {
  return globalScope?.Chess3D || null;
}

function snapshotVector(vector) {
  if (!vector) return null;
  return {
    x: typeof vector.x === "number" ? vector.x : null,
    y: typeof vector.y === "number" ? vector.y : null,
    z: typeof vector.z === "number" ? vector.z : null,
  };
}

function snapshotCamera(camera) {
  if (!camera) return null;
  return {
    position: snapshotVector(camera.position),
    rotation: snapshotVector(camera.rotation),
    up: snapshotVector(camera.up),
    fov: typeof camera.fov === "number" ? camera.fov : null,
    aspect: typeof camera.aspect === "number" ? camera.aspect : null,
    near: typeof camera.near === "number" ? camera.near : null,
    far: typeof camera.far === "number" ? camera.far : null,
  };
}

function buildSnapshot(controller) {
  const depth = typeof controller.getAIDepth === "function"
    ? controller.getAIDepth()
    : null;
  return {
    state: controller.state || null,
    aiDepth: typeof depth === "number" ? depth : null,
    lastEvaluation: controller.lastEvaluation || null,
    camera: snapshotCamera(controller.camera || null),
  };
}

function registerAdapter() {
  if (!globalScope) return;
  const controller = getController();
  if (!controller) {
    pushEvent("game", {
      level: "error",
      message: `[${GAME_ID}] diagnostics adapter failed: controller unavailable`,
    });
    return;
  }

  let lastState = controller.state || null;
  const unsubscribe = typeof controller.onStateChange === "function"
    ? controller.onStateChange((state, meta) => {
        lastState = state;
        pushEvent("game", {
          level: state === "gameover" ? "warn" : "info",
          message: `[${GAME_ID}] state changed to ${state}`,
          details: {
            previous: meta?.previous ?? null,
            state,
            initial: !!meta?.initial,
          },
        });
      })
    : null;

  registerGameDiagnostics(GAME_ID, {
    hooks: {},
    api: {
      start() {
        controller.startRenderLoop?.();
      },
      pause() {
        controller.stopRenderLoop?.();
      },
      resume() {
        controller.startRenderLoop?.();
      },
      setDifficulty(level) {
        controller.setAIDepth?.(level);
      },
      getEntities() {
        return {
          state: lastState,
          snapshot: buildSnapshot(controller),
        };
      },
    },
  });

  if (typeof globalScope?.addEventListener === "function" && unsubscribe) {
    globalScope.addEventListener(
      "beforeunload",
      () => {
        try { unsubscribe(); } catch (_) {}
      },
      { once: true },
    );
  }
}

registerAdapter();
