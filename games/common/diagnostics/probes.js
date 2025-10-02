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
    { id: "adapter-summary", label: "Adapter", run: adapterSummaryProbe },
    { id: "loop-controls", label: "Loop", run: loopProbe },
    { id: "state-snapshot", label: "State", run: stateProbe },
    { id: "input-snapshot", label: "Input", run: inputProbe },
    { id: "score-api", label: "Score", run: scoreProbe },
    { id: "asset-scan", label: "Assets", run: assetProbe },
    { id: "entity-snapshot", label: "Entities", run: entitySnapshotProbe },
    { id: "collision-overlaps", label: "Collision", run: collisionProbe },
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

  const DEFAULT_TIMING_BUCKETS = [1, 4, 8, 16, 33, 66, 100, 250, 500, 1000];
  const ASSET_PATTERN = /(\.(png|jpe?g|gif|svg|webp|mp3|wav|ogg|m4a|aac|flac|mp4|webm|json|atlas|ttf|otf|woff2?)(\?.*)?$)|(^data:[^;]+;base64,)/i;

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

  async function callAdapterApi(adapter, method, context = {}, config = {}){
    if (!adapter || typeof adapter !== "object" || !adapter.api || typeof adapter.api[method] !== "function") {
      return { supported: false, reason: `Adapter does not expose ${method}()` };
    }
    const fn = adapter.api[method];
    const probeId = config.probeId || method;
    let args = [];
    let request = null;
    if (Array.isArray(config.args)) {
      args = config.args;
    } else if (config.buildRequest !== false) {
      request = buildProbeRequest(adapter, context, probeId, config.request || {});
      args = [request];
    }
    const measurement = await measureCall(() => fn.apply(adapter.api, args));
    return Object.assign({ supported: true, method, args, request }, measurement);
  }

  function buildProbeRequest(adapter, context = {}, probeId = "probe", request = {}){
    const payload = Object.assign({}, request.payload || {});
    if (payload.slug === undefined) payload.slug = adapter && adapter.slug != null ? adapter.slug : null;
    if (payload.runId === undefined && context && Object.prototype.hasOwnProperty.call(context, "runId")) {
      payload.runId = context.runId;
    }
    const baseReason = request.reason || (context && context.reason) || `probe/${probeId}`;
    payload.reason = baseReason;
    if (request.includeOptions !== false) {
      const baseOptions = Object.assign({ probe: probeId, source: "probeRunner" }, request.options || {});
      payload.options = baseOptions;
    }
    return payload;
  }

  async function measureCall(fn){
    const started = now();
    try {
      const value = await fn();
      return { duration: now() - started, value };
    } catch (error) {
      return { duration: now() - started, error };
    }
  }

  function now(){
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function summarizeTimings(samples = [], options = {}){
    const sanitized = [];
    for (const sample of samples){
      const num = Number(sample);
      if (Number.isFinite(num) && num >= 0) sanitized.push(num);
    }
    if (!sanitized.length) {
      return { count: 0, min: null, max: null, average: null, median: null, buckets: [] };
    }
    sanitized.sort((a, b) => a - b);
    const count = sanitized.length;
    const sum = sanitized.reduce((total, value) => total + value, 0);
    const average = sum / count;
    const median = sanitized[Math.floor((count - 1) / 2)];
    return {
      count,
      min: roundTiming(sanitized[0]),
      max: roundTiming(sanitized[sanitized.length - 1]),
      average: roundTiming(average),
      median: roundTiming(median),
      buckets: createTimingBuckets(sanitized, options),
    };
  }

  function createTimingBuckets(samples = [], options = {}){
    if (!Array.isArray(samples) || !samples.length) return [];
    const boundaries = Array.isArray(options.boundaries) && options.boundaries.length
      ? options.boundaries.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
      : DEFAULT_TIMING_BUCKETS;
    const counts = new Array(boundaries.length + 1).fill(0);
    for (const sample of samples){
      const value = Number(sample);
      if (!Number.isFinite(value) || value < 0) continue;
      let bucketIndex = boundaries.length;
      for (let index = 0; index < boundaries.length; index += 1){
        if (value < boundaries[index]) {
          bucketIndex = index;
          break;
        }
      }
      counts[bucketIndex] += 1;
    }
    const buckets = [];
    for (let index = 0; index < counts.length; index += 1){
      const count = counts[index];
      if (!count) continue;
      if (index === 0) {
        buckets.push({ label: `<${boundaries[0]}ms`, count });
      } else if (index === boundaries.length) {
        buckets.push({ label: `≥${boundaries[boundaries.length - 1]}ms`, count });
      } else {
        const lower = boundaries[index - 1];
        const upper = boundaries[index];
        buckets.push({ label: `${lower}-${upper}ms`, count });
      }
    }
    return buckets;
  }

  function roundTiming(value){
    return Math.round(value * 1000) / 1000;
  }

  function collectEntitiesFromSnapshot(snapshot, options = {}){
    const limit = typeof options.limit === "number" && options.limit > 0 ? options.limit : 200;
    const collected = [];
    const pushEntity = (entity) => {
      if (!entity || typeof entity !== "object") return;
      collected.push(entity);
    };
    if (Array.isArray(snapshot)) {
      for (const entity of snapshot){
        pushEntity(entity);
        if (collected.length >= limit) break;
      }
    }
    if (!snapshot || typeof snapshot !== "object" || collected.length >= limit) {
      return collected;
    }
    const keys = Object.keys(snapshot);
    for (const key of keys){
      const value = snapshot[key];
      if (Array.isArray(value)) {
        for (const entity of value){
          pushEntity(entity);
          if (collected.length >= limit) break;
        }
      } else if (value && typeof value === "object") {
        if (Array.isArray(value.entities)) {
          for (const entity of value.entities){
            pushEntity(entity);
            if (collected.length >= limit) break;
          }
        }
        if (Array.isArray(value.players)) {
          for (const entity of value.players){
            pushEntity(entity);
            if (collected.length >= limit) break;
          }
        }
      }
      if (collected.length >= limit) break;
    }
    return collected;
  }

  function collectStateMetadata(snapshot){
    const entities = collectEntitiesFromSnapshot(snapshot);
    const stateCounts = new Map();
    const statusCounts = new Map();
    const phaseCounts = new Map();
    const modeCounts = new Map();
    const flags = { active: 0, inactive: 0, removed: 0 };
    for (const entity of entities){
      if (!entity || typeof entity !== "object") continue;
      countLabel(stateCounts, entity.state ?? entity.status ?? null);
      countLabel(statusCounts, entity.status ?? entity.state ?? null);
      countLabel(phaseCounts, entity.phase ?? entity.stage ?? null);
      countLabel(modeCounts, entity.mode ?? entity.behaviour ?? entity.behavior ?? null);
      if (entity.active === true || entity.isActive === true) flags.active += 1;
      if (entity.active === false || entity.isActive === false) flags.inactive += 1;
      if (entity.removed || entity.isRemoved || entity.destroyed) flags.removed += 1;
    }
    return {
      totalEntities: entities.length,
      states: mapToSortedList(stateCounts),
      statuses: mapToSortedList(statusCounts),
      phases: mapToSortedList(phaseCounts),
      modes: mapToSortedList(modeCounts),
      flags,
      sample: clipValue(entities.slice(0, 5)),
    };
  }

  function countLabel(map, value){
    if (value === undefined || value === null) return;
    let str = null;
    if (typeof value === "string") {
      str = value.trim();
    } else if (typeof value === "number" || typeof value === "boolean") {
      str = String(value);
    }
    if (!str) return;
    map.set(str, (map.get(str) || 0) + 1);
  }

  function mapToSortedList(map, limit = 6){
    const list = Array.from(map.entries()).map(([label, count]) => ({ label, count }));
    list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return list.slice(0, limit);
  }

  function sampleInputMetadata(snapshot, options = {}){
    const limit = typeof options.limit === "number" && options.limit > 0 ? options.limit : 8;
    const axisThreshold = typeof options.axisThreshold === "number" ? options.axisThreshold : 0.1;
    const sources = [];
    const seenPaths = new Set();
    traverseSnapshot(snapshot, (value, path) => {
      const summary = summarizeInputValue(value);
      if (!summary) return;
      const location = formatPath(path);
      if (seenPaths.has(location)) return;
      seenPaths.add(location);
      sources.push(Object.assign({ path: location }, summary));
    }, { maxDepth: options.maxDepth ?? 4, maxEntries: options.maxEntries ?? 600 });
    const activeSources = sources.filter((source) => {
      if (Array.isArray(source.activeKeys) && source.activeKeys.length) return true;
      if (Array.isArray(source.pressed) && source.pressed.length) return true;
      if (Array.isArray(source.axes) && source.axes.some((axis) => Math.abs(axis.value) > axisThreshold)) return true;
      return false;
    });
    return {
      totalSources: sources.length,
      activeSources: activeSources.length,
      sources: sources.slice(0, limit).map((source) => ({
        path: source.path,
        type: source.type,
        keys: source.keys,
        activeKeys: source.activeKeys,
        axes: source.axes,
        pressed: source.pressed,
        meta: source.meta,
      })),
    };
  }

  function summarizeInputValue(value){
    if (!value || typeof value !== "object") {
      if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
        return { type: "array", pressed: value.slice(0, 10), meta: { total: value.length } };
      }
      return null;
    }
    if (Array.isArray(value)) {
      const strings = value.filter((entry) => typeof entry === "string");
      if (!strings.length) return null;
      return { type: "array", pressed: strings.slice(0, 10), meta: { total: strings.length } };
    }
    const keys = [];
    const activeKeys = [];
    const axes = [];
    const pressed = [];
    const meta = { totalKeys: 0 };
    let matched = false;
    const entries = Object.entries(value).slice(0, 30);
    for (const [key, entry] of entries){
      if (typeof entry === "boolean") {
        matched = true;
        keys.push(key);
        if (entry) activeKeys.push(key);
      } else if (typeof entry === "number" && Number.isFinite(entry)) {
        matched = true;
        axes.push({ axis: key, value: roundTiming(clamp(entry, -1, 1)) });
      } else if (Array.isArray(entry) && entry.length && entry.every((item) => typeof item === "string")) {
        matched = true;
        pressed.push({ key, values: entry.slice(0, 10) });
      } else if (typeof entry === "string" && entry.trim()) {
        matched = true;
        pressed.push({ key, values: [entry.trim()] });
      }
    }
    if (!matched) return null;
    meta.totalKeys = keys.length;
    return {
      type: "object",
      keys: keys.slice(0, 10),
      activeKeys: activeKeys.slice(0, 10),
      axes: axes.slice(0, 6),
      pressed: pressed.slice(0, 6),
      meta,
    };
  }

  function collectAssetMetadata(snapshot, options = {}){
    const limit = typeof options.limit === "number" && options.limit > 0 ? options.limit : 12;
    const maxPathsPerAsset = typeof options.maxPathsPerAsset === "number" && options.maxPathsPerAsset > 0
      ? options.maxPathsPerAsset
      : 3;
    const matches = new Map();
    traverseSnapshot(snapshot, (value, path) => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (!trimmed) return;
      if (!ASSET_PATTERN.test(trimmed) && !trimmed.includes("/assets/")) return;
      const existing = matches.get(trimmed) || { value: trimmed, occurrences: 0, paths: [] };
      existing.occurrences += 1;
      if (existing.paths.length < maxPathsPerAsset) {
        existing.paths.push(formatPath(path));
      }
      matches.set(trimmed, existing);
    }, { maxDepth: options.maxDepth ?? 5, maxEntries: options.maxEntries ?? 1200 });
    const assets = Array.from(matches.values());
    assets.sort((a, b) => b.occurrences - a.occurrences || a.value.localeCompare(b.value));
    return {
      total: assets.length,
      assets: assets.slice(0, limit),
    };
  }

  function traverseSnapshot(value, visitor, options = {}){
    const maxDepth = typeof options.maxDepth === "number" ? options.maxDepth : 4;
    const maxEntries = typeof options.maxEntries === "number" ? options.maxEntries : 800;
    const maxKeys = typeof options.maxKeys === "number" ? options.maxKeys : 20;
    const maxArray = typeof options.maxArray === "number" ? options.maxArray : 20;
    const seen = typeof WeakSet === "function" ? new WeakSet() : null;
    let visited = 0;
    function walk(node, path = [], depth = 0){
      if (visited >= maxEntries) return;
      if (node && typeof node === "object") {
        if (seen) {
          if (seen.has(node)) return;
          seen.add(node);
        }
      }
      visited += 1;
      try {
        visitor(node, path);
      } catch (_) { /* ignore visitor errors */ }
      if (depth >= maxDepth) return;
      if (Array.isArray(node)) {
        const length = Math.min(node.length, maxArray);
        for (let index = 0; index < length; index += 1){
          walk(node[index], path.concat(index), depth + 1);
          if (visited >= maxEntries) break;
        }
      } else if (node && typeof node === "object") {
        const keys = Object.keys(node).slice(0, maxKeys);
        for (const key of keys){
          walk(node[key], path.concat(key), depth + 1);
          if (visited >= maxEntries) break;
        }
      }
    }
    walk(value, []);
  }

  function formatPath(path = []){
    if (!Array.isArray(path) || !path.length) return "$";
    let output = "$";
    for (const segment of path){
      if (typeof segment === "number") {
        output += `[${segment}]`;
      } else {
        output += `.${segment}`;
      }
    }
    return output;
  }

  function clamp(value, min, max){
    const num = Number(value);
    if (!Number.isFinite(num)) return num;
    return Math.min(Math.max(num, min), max);
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

  async function loopProbe(adapter, context = {}){
    if (!adapter || !adapter.api) {
      return {
        status: "not-supported",
        reason: "Adapter does not expose loop controls",
        data: { context },
      };
    }
    const lifecycle = ["start", "pause", "resume", "reset"];
    const available = lifecycle.filter((fn) => typeof adapter.api[fn] === "function");
    if (!available.length) {
      return {
        status: "not-supported",
        reason: "Adapter does not expose loop controls",
        data: { context },
      };
    }
    const operations = {};
    const durations = [];
    let failures = 0;
    for (const fnName of lifecycle){
      if (typeof adapter.api[fnName] !== "function") {
        operations[fnName] = { supported: false };
        continue;
      }
      const result = await callAdapterApi(adapter, fnName, context, { args: [] });
      const duration = Number.isFinite(result.duration) ? roundTiming(result.duration) : result.duration;
      if (Number.isFinite(result.duration)) durations.push(result.duration);
      const entry = {
        supported: true,
        status: result.error ? "error" : "ok",
        duration,
      };
      if (result.error) {
        failures += 1;
        entry.error = serializeError(result.error);
      } else if (result.value !== undefined) {
        entry.result = clipValue(result.value);
      }
      operations[fnName] = entry;
    }
    const timingSummary = summarizeTimings(durations);
    const message = failures
      ? `${failures} loop call${failures === 1 ? "" : "s"} failed`
      : `Loop controls responded (${available.length} function${available.length === 1 ? "" : "s"})`;
    return {
      status: failures ? "warn" : "ok",
      message,
      data: {
        operations,
        timings: timingSummary,
      },
      meta: { functions: available },
    };
  }

  async function stateProbe(adapter, context = {}){
    const result = await callAdapterApi(adapter, "getEntities", context, {
      probeId: "state",
      request: { options: { probe: "state", source: "probeRunner", includeState: true } },
    });
    if (!result.supported) {
      return {
        status: "not-supported",
        reason: result.reason || "Adapter does not expose getEntities()",
        data: { context },
      };
    }
    if (result.error) {
      return {
        status: "error",
        message: "State snapshot probe failed",
        error: result.error,
        data: { context },
        meta: { duration: result.duration },
      };
    }
    const snapshot = result.value;
    if (snapshot && typeof snapshot === "object" && snapshot.supported === false) {
      return {
        status: "not-supported",
        reason: snapshot.reason || "Adapter reported unsupported",
        data: snapshot.data ?? null,
        meta: Object.assign({ duration: result.duration }, snapshot.meta || {}),
      };
    }
    const summary = collectStateMetadata(snapshot);
    const timingSummary = summarizeTimings([result.duration]);
    const entityCount = summary.totalEntities;
    const message = entityCount
      ? `State captured for ${entityCount} entit${entityCount === 1 ? "y" : "ies"}`
      : "No entity state detected";
    return {
      status: entityCount ? "ok" : "info",
      message,
      data: summary,
      meta: { duration: result.duration, timings: timingSummary },
    };
  }

  async function inputProbe(adapter, context = {}){
    const result = await callAdapterApi(adapter, "getEntities", context, {
      probeId: "input",
      request: { options: { probe: "input", source: "probeRunner", includeInputs: true } },
    });
    if (!result.supported) {
      return {
        status: "not-supported",
        reason: result.reason || "Adapter does not expose getEntities()",
        data: { context },
      };
    }
    if (result.error) {
      return {
        status: "error",
        message: "Input probe failed",
        error: result.error,
        data: { context },
        meta: { duration: result.duration },
      };
    }
    const snapshot = result.value;
    if (snapshot && typeof snapshot === "object" && snapshot.supported === false) {
      return {
        status: "not-supported",
        reason: snapshot.reason || "Adapter reported unsupported",
        data: snapshot.data ?? null,
        meta: Object.assign({ duration: result.duration }, snapshot.meta || {}),
      };
    }
    const summary = sampleInputMetadata(snapshot);
    const timingSummary = summarizeTimings([result.duration]);
    const message = summary.activeSources
      ? `Detected ${summary.activeSources}/${summary.totalSources} active input source${summary.activeSources === 1 ? "" : "s"}`
      : (summary.totalSources
        ? "Input metadata detected but no active inputs"
        : "No input metadata detected");
    const status = summary.activeSources ? "ok" : (summary.totalSources ? "warn" : "info");
    return {
      status,
      message,
      data: summary,
      meta: { duration: result.duration, timings: timingSummary },
    };
  }

  async function assetProbe(adapter, context = {}){
    const result = await callAdapterApi(adapter, "getEntities", context, {
      probeId: "assets",
      request: { options: { probe: "assets", source: "probeRunner", includeAssets: true } },
    });
    if (!result.supported) {
      return {
        status: "not-supported",
        reason: result.reason || "Adapter does not expose getEntities()",
        data: { context },
      };
    }
    if (result.error) {
      return {
        status: "error",
        message: "Asset probe failed",
        error: result.error,
        data: { context },
        meta: { duration: result.duration },
      };
    }
    const snapshot = result.value;
    if (snapshot && typeof snapshot === "object" && snapshot.supported === false) {
      return {
        status: "not-supported",
        reason: snapshot.reason || "Adapter reported unsupported",
        data: snapshot.data ?? null,
        meta: Object.assign({ duration: result.duration }, snapshot.meta || {}),
      };
    }
    const assets = collectAssetMetadata(snapshot);
    const timingSummary = summarizeTimings([result.duration]);
    const message = assets.total
      ? `Discovered ${assets.total} asset reference${assets.total === 1 ? "" : "s"}`
      : "No asset references detected";
    return {
      status: assets.total ? "ok" : "info",
      message,
      data: assets,
      meta: { duration: result.duration, timings: timingSummary },
    };
  }

  async function scoreProbe(adapter, context = {}){
    const result = await callAdapterApi(adapter, "getScore", context, {
      probeId: "score",
      request: { includeOptions: false },
    });
    if (!result.supported) {
      return {
        status: "not-supported",
        reason: result.reason || "Adapter does not expose getScore()",
        data: { context },
      };
    }
    if (result.error) {
      return {
        status: "error",
        message: "Score API threw an error",
        error: result.error,
        data: { context },
        meta: { duration: result.duration },
      };
    }
    const value = result.value;
    if (value && typeof value === "object" && value.supported === false) {
      return {
        status: "not-supported",
        reason: value.reason || "Adapter reported unsupported",
        data: value.data ?? null,
        meta: Object.assign({ duration: result.duration }, value.meta || {}),
      };
    }
    const timingSummary = summarizeTimings([result.duration]);
    const message = Number.isFinite(result.duration)
      ? `Score API responded in ${roundTiming(result.duration)}ms`
      : "Score API responded successfully";
    return {
      status: "ok",
      message,
      data: {
        score: clipValue(value),
        timings: timingSummary,
      },
      meta: { duration: result.duration },
    };
  }

  async function entitySnapshotProbe(adapter, context = {}){
    const result = await callAdapterApi(adapter, "getEntities", context, {
      probeId: "entities",
      request: { options: { probe: "entities", source: "probeRunner" } },
    });
    if (!result.supported) {
      return {
        status: "not-supported",
        reason: result.reason || "Adapter does not expose getEntities()",
        data: { context },
      };
    }
    if (result.error) {
      return {
        status: "error",
        message: "getEntities() threw an error",
        error: result.error,
        data: { context },
        meta: { duration: result.duration },
      };
    }
    const snapshot = result.value;
    if (snapshot && typeof snapshot === "object" && snapshot.supported === false) {
      return {
        status: "not-supported",
        reason: snapshot.reason || "Adapter reported unsupported",
        data: snapshot.data ?? null,
        meta: Object.assign({ duration: result.duration }, snapshot.meta || {}),
      };
    }
    const count = countEntities(snapshot);
    const timings = summarizeTimings([result.duration]);
    return {
      status: "ok",
      message: count != null ? `Captured ${count} entit${count === 1 ? "y" : "ies"}` : "Captured entity snapshot",
      data: clipValue(snapshot),
      meta: { count, duration: result.duration, timings },
    };
  }

  async function collisionProbe(adapter, context = {}){
    const result = await callAdapterApi(adapter, "getEntities", context, {
      probeId: "collision",
      request: { options: { probe: "collision", source: "probeRunner", includeBounds: true } },
    });
    if (!result.supported) {
      return {
        status: "not-supported",
        reason: result.reason || "Adapter does not expose getEntities()",
        data: { context },
      };
    }
    if (result.error) {
      return {
        status: "error",
        message: "getEntities() failed during collision probe",
        error: result.error,
        data: { context },
        meta: { duration: result.duration },
      };
    }
    const snapshot = result.value;
    const analysis = analyseCollisionSnapshot(snapshot);
    if (!analysis.supported) {
      return {
        status: "not-supported",
        reason: analysis.reason || "Collision data unavailable",
        data: analysis.sample,
        meta: { duration: result.duration },
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
        meta: { duration: result.duration },
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
      meta: { duration: result.duration },
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
    loopProbe,
    stateProbe,
    inputProbe,
    scoreProbe,
    assetProbe,
    entitySnapshotProbe,
    collisionProbe,
    createTimingBuckets,
    summarizeTimings,
    sampleInputMetadata,
  };
});
