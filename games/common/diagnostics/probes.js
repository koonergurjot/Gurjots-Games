/* Gurjot's Games — diagnostics/probes.js
   Collection of built-in diagnostics probes and an execution helper.
*/
(function(globalFactoryScope, factory){
  const scope = globalFactoryScope || (typeof globalThis !== "undefined" ? globalThis : undefined);
  const api = factory();
  if (typeof module === "object" && module && typeof module.exports === "object") {
    module.exports = api;
  }
  if (scope) {
    const existing = scope.GGDiagProbes && typeof scope.GGDiagProbes === "object"
      ? scope.GGDiagProbes
      : {};
    scope.GGDiagProbes = Object.assign({}, existing, api);
  }
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : undefined), function(){
  const DEFAULT_PROBES = [
    { id: "adapter-summary", label: "Adapter summary", run: adapterSummaryProbe },
    { id: "score-api", label: "Score API", run: scoreProbe },
    { id: "entity-snapshot", label: "Entity snapshot", run: entitySnapshotProbe },
    { id: "collision-overlaps", label: "Collision overlaps", run: collisionProbe },
  ];

  const STATUS_LEVEL = {
    ok: "info",
    pass: "info",
    info: "info",
    warn: "warn",
    warning: "warn",
    error: "error",
    fail: "error",
    "not-supported": "info",
    unsupported: "info",
  };

  function createProbeRunner(options = {}){
    const adapter = options.adapter || null;
    const logFn = typeof options.log === "function" ? options.log : () => {};
    const cloneDetails = typeof options.cloneDetails === "function" ? options.cloneDetails : (value) => value;
    const probes = Array.isArray(options.probes) && options.probes.length
      ? options.probes
      : DEFAULT_PROBES;

    let hasRun = false;
    let inFlight = null;
    let lastReason = null;

    function run(reason){
      const normalizedReason = typeof reason === "string" && reason.trim()
        ? reason.trim()
        : (reason && reason.reason) || "auto";
      if (hasRun && inFlight) {
        return inFlight;
      }
      hasRun = true;
      const runId = Date.now();
      lastReason = normalizedReason;
      inFlight = execute(runId, normalizedReason);
      return inFlight;
    }

    async function execute(runId, reason){
      const results = [];
      const context = { runId, reason };
      for (const descriptor of probes){
        const runner = typeof descriptor === "function" ? descriptor : descriptor && descriptor.run;
        if (typeof runner !== "function") continue;
        let normalized;
        try {
          const result = await runner(adapter, Object.assign({}, context, descriptor && descriptor.context));
          normalized = normalizeProbeResult(result, descriptor, context);
        } catch (error) {
          normalized = normalizeProbeResult({
            status: "error",
            message: (descriptor && descriptor.label) ? `${descriptor.label} probe failed` : "Probe failed",
            error,
          }, descriptor, context);
        }
        if (!normalized) continue;
        const entry = {
          category: "probe",
          level: normalized.level,
          message: normalized.message,
          details: cloneDetails(normalized.details),
          timestamp: Date.now(),
        };
        try {
          logFn(entry);
        } catch (_) {
          /* ignore log failures */
        }
        results.push(normalized);
      }
      return results;
    }

    function reset(){
      hasRun = false;
      inFlight = null;
      lastReason = null;
    }

    return {
      run,
      reset,
      get lastReason(){ return lastReason; },
    };
  }

  function adapterSummaryProbe(adapter, context = {}){
    if (!adapter || typeof adapter !== "object") {
      return {
        status: "not-supported",
        reason: "No diagnostics adapter registered",
        data: { context },
      };
    }
    const hookKeys = Object.keys(adapter.hooks || {});
    const apiKeys = Object.keys(adapter.api || {});
    return {
      status: "ok",
      message: `Adapter exposes ${hookKeys.length} hook${hookKeys.length === 1 ? "" : "s"} and ${apiKeys.length} API function${apiKeys.length === 1 ? "" : "s"}.`,
      data: {
        slug: adapter.slug || null,
        hooks: hookKeys,
        api: apiKeys,
        context,
      },
    };
  }

  async function scoreProbe(adapter, context = {}){
    if (!adapter || !adapter.api || typeof adapter.api.getScore !== "function") {
      return {
        status: "not-supported",
        reason: "Adapter does not expose getScore()",
        data: { context },
      };
    }
    try {
      const value = await adapter.api.getScore({
        slug: adapter.slug,
        reason: context.reason || "probe/score",
        runId: context.runId,
      });
      return {
        status: "ok",
        message: "Score API responded successfully",
        data: { score: value, context },
      };
    } catch (error) {
      return {
        status: "error",
        message: "Score API threw an error",
        error,
        data: { context },
      };
    }
  }

  async function entitySnapshotProbe(adapter, context = {}){
    if (!adapter || !adapter.api || typeof adapter.api.getEntities !== "function") {
      return {
        status: "not-supported",
        reason: "Adapter does not expose getEntities()",
        data: { context },
      };
    }
    try {
      const snapshot = await adapter.api.getEntities({
        slug: adapter.slug,
        reason: context.reason || "probe/entities",
        runId: context.runId,
        options: { probe: "entities", source: "probeRunner" },
      });
      if (snapshot && typeof snapshot === "object" && snapshot.supported === false) {
        return {
          status: "not-supported",
          reason: snapshot.reason || "Adapter reported unsupported",
          data: snapshot.data ?? null,
          meta: Object.assign({ context }, snapshot.meta || {}),
        };
      }
      const count = countEntities(snapshot);
      return {
        status: "ok",
        message: count != null ? `Captured ${count} entities` : "Captured entity snapshot",
        data: clipValue(snapshot),
        meta: { count, context },
      };
    } catch (error) {
      return {
        status: "error",
        message: "getEntities() threw an error",
        error,
        data: { context },
      };
    }
  }

  async function collisionProbe(adapter, context = {}){
    if (!adapter || !adapter.api || typeof adapter.api.getEntities !== "function") {
      return {
        status: "not-supported",
        reason: "Adapter does not expose getEntities()",
        data: { context },
      };
    }
    let snapshot;
    try {
      snapshot = await adapter.api.getEntities({
        slug: adapter.slug,
        reason: context.reason || "probe/collision",
        runId: context.runId,
        options: { probe: "collision", source: "probeRunner", includeBounds: true },
      });
    } catch (error) {
      return {
        status: "error",
        message: "getEntities() failed during collision probe",
        error,
        data: { context },
      };
    }
    const analysis = analyseCollisionSnapshot(snapshot);
    if (!analysis.supported) {
      return {
        status: "not-supported",
        reason: analysis.reason || "Collision data unavailable",
        data: analysis.sample,
        meta: { context },
      };
    }
    if (!analysis.collisions.length) {
      return {
        status: "ok",
        message: "No overlapping bounds detected",
        data: {
          total: analysis.total,
          sample: analysis.sample,
        },
        meta: { context },
      };
    }
    return {
      status: "warn",
      message: `${analysis.collisions.length} overlapping bound${analysis.collisions.length === 1 ? "" : "s"} detected`,
      data: {
        total: analysis.total,
        collisions: analysis.collisions,
        sample: analysis.sample,
      },
      meta: { context },
    };
  }

  function analyseCollisionSnapshot(snapshot){
    const extracted = extractColliderShapes(snapshot);
    if (!extracted.shapes.length) {
      return {
        supported: false,
        reason: extracted.reason || "No collider shapes found",
        sample: extracted.sample,
      };
    }
    const collisions = [];
    for (let i = 0; i < extracted.shapes.length; i += 1){
      const a = extracted.shapes[i];
      for (let j = i + 1; j < extracted.shapes.length; j += 1){
        const b = extracted.shapes[j];
        const overlap = computeOverlap(a, b);
        if (!overlap) continue;
        collisions.push({
          pair: [a.id, b.id],
          overlap,
          a: summarizeShape(a),
          b: summarizeShape(b),
        });
        if (collisions.length >= 20) break;
      }
      if (collisions.length >= 20) break;
    }
    return {
      supported: true,
      total: extracted.shapes.length,
      collisions,
      sample: extracted.sample,
    };
  }

  function extractColliderShapes(snapshot){
    const sources = [];
    if (Array.isArray(snapshot)) sources.push(snapshot);
    if (snapshot && typeof snapshot === "object") {
      if (Array.isArray(snapshot.entities)) sources.push(snapshot.entities);
      if (Array.isArray(snapshot.colliders)) sources.push(snapshot.colliders);
      if (snapshot.collision && typeof snapshot.collision === "object") {
        const collision = snapshot.collision;
        if (Array.isArray(collision.entities)) sources.push(collision.entities);
        if (Array.isArray(collision.colliders)) sources.push(collision.colliders);
        if (Array.isArray(collision.shapes)) sources.push(collision.shapes);
      }
      if (snapshot.collisionTest && typeof snapshot.collisionTest === "object") {
        const collisionTest = snapshot.collisionTest;
        if (Array.isArray(collisionTest.entities)) sources.push(collisionTest.entities);
        if (Array.isArray(collisionTest.shapes)) sources.push(collisionTest.shapes);
      }
      if (snapshot.probes && typeof snapshot.probes === "object") {
        const probes = snapshot.probes;
        if (Array.isArray(probes.colliders)) sources.push(probes.colliders);
      }
    }
    let shapes = [];
    for (const list of sources){
      const normalized = normalizeShapeList(list);
      if (normalized.length > shapes.length) {
        shapes = normalized;
      }
    }
    const sample = shapes.slice(0, 10).map(summarizeShape);
    if (!shapes.length) {
      return {
        shapes,
        reason: sources.length ? "Collider shapes missing bounds" : "No collider sources provided",
        sample,
      };
    }
    return { shapes, sample };
  }

  function normalizeShapeList(list){
    if (!Array.isArray(list)) return [];
    const shapes = [];
    for (let index = 0; index < list.length; index += 1){
      const entity = list[index];
      const shape = toShape(entity, index);
      if (shape) shapes.push(shape);
    }
    return shapes;
  }

  function toShape(entity, index){
    if (!entity || typeof entity !== "object") return null;
    const id = deriveId(entity, index);
    const rect = extractRect(entity);
    if (rect) {
      return Object.assign({ id, type: "rect" }, rect);
    }
    const circle = extractCircle(entity);
    if (circle) {
      return Object.assign({ id, type: "circle" }, circle);
    }
    return null;
  }

  function deriveId(entity, index){
    const candidates = [entity.id, entity.key, entity.name, entity.type, entity.kind, entity.label];
    for (const value of candidates){
      if (value === undefined || value === null) continue;
      const str = String(value).trim();
      if (str) return str;
    }
    return `entity-${index}`;
  }

  function extractRect(entity){
    if (entity.bounds && typeof entity.bounds === "object") {
      const { x, y, left, top, width, height } = entity.bounds;
      const rect = buildRect(x ?? left, y ?? top, width, height);
      if (rect) return rect;
    }
    const rect = buildRect(
      entity.left ?? entity.x ?? entity.position?.x ?? entity.pos?.x ?? entity.center?.x ?? null,
      entity.top ?? entity.y ?? entity.position?.y ?? entity.pos?.y ?? entity.center?.y ?? null,
      entity.width ?? entity.w ?? entity.size?.width ?? entity.size?.w ?? entity.dimensions?.width ?? entity.dimensions?.w ?? null,
      entity.height ?? entity.h ?? entity.size?.height ?? entity.size?.h ?? entity.dimensions?.height ?? entity.dimensions?.h ?? null,
    );
    if (rect) return rect;
    return null;
  }

  function buildRect(x, y, width, height){
    const w = toFinite(width);
    const h = toFinite(height);
    if (w == null || h == null || w <= 0 || h <= 0) return null;
    const left = toFinite(x);
    const top = toFinite(y);
    const rectLeft = left != null ? left : 0;
    const rectTop = top != null ? top : 0;
    return {
      left: rectLeft,
      top: rectTop,
      right: rectLeft + w,
      bottom: rectTop + h,
      width: w,
      height: h,
      tags: collectTags(entity),
    };
  }

  function extractCircle(entity){
    const radius = toFinite(entity.radius ?? entity.r ?? (typeof entity.diameter === "number" ? entity.diameter / 2 : null));
    if (radius == null || radius <= 0) return null;
    const x = toFinite(entity.x ?? entity.center?.x ?? entity.position?.x ?? entity.pos?.x);
    const y = toFinite(entity.y ?? entity.center?.y ?? entity.position?.y ?? entity.pos?.y);
    if (x == null || y == null) return null;
    return {
      center: { x, y },
      radius,
      left: x - radius,
      top: y - radius,
      right: x + radius,
      bottom: y + radius,
      tags: collectTags(entity),
    };
  }

  function collectTags(entity){
    if (!entity || typeof entity !== "object") return null;
    const tags = {};
    const keys = ["type", "kind", "role", "team", "state", "layer", "group", "owner"];
    for (const key of keys){
      if (entity[key] === undefined) continue;
      const value = entity[key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        tags[key] = value;
      }
    }
    return Object.keys(tags).length ? tags : null;
  }

  function summarizeShape(shape){
    if (!shape) return null;
    const summary = {
      id: shape.id,
      type: shape.type,
      bounds: {
        left: toFinite(shape.left ?? shape.bounds?.left ?? shape.bounds?.x ?? null),
        top: toFinite(shape.top ?? shape.bounds?.top ?? shape.bounds?.y ?? null),
        right: toFinite(shape.right ?? null),
        bottom: toFinite(shape.bottom ?? null),
      },
    };
    if (shape.width != null) summary.width = toFinite(shape.width);
    if (shape.height != null) summary.height = toFinite(shape.height);
    if (shape.radius != null) summary.radius = toFinite(shape.radius);
    if (shape.center) {
      summary.center = {
        x: toFinite(shape.center.x ?? null),
        y: toFinite(shape.center.y ?? null),
      };
    }
    if (shape.tags) summary.tags = shape.tags;
    return summary;
  }

  function computeOverlap(a, b){
    if (!a || !b) return null;
    if (a.type === "circle" && b.type === "circle") {
      return computeCircleOverlap(a, b);
    }
    return computeRectOverlap(a, b);
  }

  function computeRectOverlap(a, b){
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return null;
    return {
      type: "rect",
      width,
      height,
      area: width * height,
    };
  }

  function computeCircleOverlap(a, b){
    const dx = (a.center?.x ?? 0) - (b.center?.x ?? 0);
    const dy = (a.center?.y ?? 0) - (b.center?.y ?? 0);
    const distance = Math.sqrt(dx * dx + dy * dy);
    const radiusSum = (a.radius || 0) + (b.radius || 0);
    if (!Number.isFinite(distance) || distance >= radiusSum) return null;
    return {
      type: "circle",
      distance,
      penetration: radiusSum - distance,
    };
  }

  function normalizeProbeResult(result, descriptor = {}, context = {}){
    if (result == null) return null;
    let payload = result;
    if (typeof result === "string") {
      payload = { message: result };
    } else if (typeof result === "boolean") {
      payload = { status: result ? "ok" : "warn" };
    }
    const id = (descriptor && descriptor.id) || payload.id || "probe";
    const label = (descriptor && descriptor.label) || payload.label || id;
    const status = normalizeStatus(payload.status, payload.reason, payload.supported);
    const level = normalizeLevel(payload.level, status);
    const message = normalizeMessage(payload.message, label, status, payload.reason);
    const details = {
      id,
      label,
      status,
      supported: status !== "not-supported",
      reason: payload.reason || null,
      data: payload.data ?? payload.snapshot ?? payload.entities ?? null,
      meta: mergeMeta(payload.meta, context),
    };
    if (payload.error) {
      details.error = serializeError(payload.error);
    }
    return { id, label, status, level, message, details };
  }

  function normalizeStatus(status, reason, supported){
    if (typeof status === "string") {
      const normalized = status.toLowerCase();
      if (normalized === "ok" || normalized === "pass" || normalized === "info" || normalized === "success") return "ok";
      if (normalized === "warn" || normalized === "warning") return "warn";
      if (normalized === "error" || normalized === "fail" || normalized === "failed") return "error";
      if (normalized === "unsupported" || normalized === "not-supported" || normalized === "not_supported") return "not-supported";
    }
    if (supported === false) return "not-supported";
    if (reason && !status) return "not-supported";
    return status || "ok";
  }

  function normalizeLevel(level, status){
    if (typeof level === "string" && level.trim()) {
      const normalized = level.toLowerCase();
      if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
        return normalized;
      }
    }
    return STATUS_LEVEL[status] || "info";
  }

  function normalizeMessage(message, label, status, reason){
    if (message && typeof message === "string") return message;
    if (status === "not-supported") {
      return reason ? `${label} not supported: ${reason}` : `${label} not supported`;
    }
    if (status === "warn") return `${label} reported warnings`;
    if (status === "error") return `${label} failed`;
    return `${label} completed`;
  }

  function mergeMeta(meta, context){
    const merged = Object.assign({}, context);
    if (meta && typeof meta === "object") {
      const keys = Object.keys(meta);
      for (const key of keys){
        merged[key] = meta[key];
      }
    }
    return merged;
  }

  function serializeError(error){
    if (!error) return null;
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    if (typeof error === "object") {
      const output = {};
      for (const key of Object.keys(error).slice(0, 20)){
        output[key] = clipValue(error[key]);
      }
      return output;
    }
    return { message: String(error) };
  }

  function countEntities(snapshot){
    if (!snapshot) return null;
    if (Array.isArray(snapshot)) return snapshot.length;
    if (snapshot && typeof snapshot === "object") {
      if (Array.isArray(snapshot.entities)) return snapshot.entities.length;
      if (Array.isArray(snapshot.collision?.entities)) return snapshot.collision.entities.length;
    }
    return null;
  }

  function clipValue(value, depth = 0){
    if (value === null || value === undefined) return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return `${value.toString()}n`;
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "function") return `[Function${value.name ? ` ${value.name}` : ""}]`;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    if (depth >= 3) return `[Depth ${depth}]`;
    if (Array.isArray(value)) {
      return value.slice(0, 20).map((item) => clipValue(item, depth + 1));
    }
    if (typeof value === "object") {
      const output = {};
      const keys = Object.keys(value).slice(0, 20);
      for (const key of keys){
        try {
          output[key] = clipValue(value[key], depth + 1);
        } catch (err) {
          output[key] = `[Unserializable: ${err?.message || err}]`;
        }
      }
      return output;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return String(value);
    }
  }

  function toFinite(value){
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  return {
    createProbeRunner,
    adapterSummaryProbe,
    scoreProbe,
    entitySnapshotProbe,
    collisionProbe,
  };
});
