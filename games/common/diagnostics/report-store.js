/* Gurjot's Games — diagnostics/report-store.js
   Centralized diagnostics report store shared by diag-core.
*/
(function(globalFactoryScope, factory){
  const scope = globalFactoryScope || (typeof globalThis !== 'undefined' ? globalThis : undefined);
  const api = factory();
  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = api;
  }
  if (scope) {
    const existing = scope.GGDiagReportStore && typeof scope.GGDiagReportStore === 'object'
      ? scope.GGDiagReportStore
      : {};
    const merged = Object.assign({}, existing, api);
    scope.GGDiagReportStore = merged;
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : undefined), function(){
  const PROBE_CATEGORIES = new Set([
    'performance',
    'service-worker',
    'heartbeat',
    'metrics',
    'telemetry',
    'probe',
    'resource',
    'feature',
    'capability',
  ]);

  const DEFAULTS = {
    maxEntries: 500,
    maxConsole: 500,
    maxNetwork: 200,
    maxProbes: 200,
    maxEnvHistory: 12,
  };

  function sanitizeLimit(value, fallback){
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.max(1, Math.floor(num));
  }

  function createReportStore(options = {}){
    const maxEntries = sanitizeLimit(options.maxEntries, DEFAULTS.maxEntries);
    const config = {
      maxEntries,
      maxConsole: sanitizeLimit(options.maxConsole, maxEntries),
      maxNetwork: sanitizeLimit(options.maxNetwork, DEFAULTS.maxNetwork),
      maxProbes: sanitizeLimit(options.maxProbes, DEFAULTS.maxProbes),
      maxEnvHistory: sanitizeLimit(options.maxEnvHistory, DEFAULTS.maxEnvHistory),
    };

    const summary = {
      startedAt: Date.now(),
      updatedAt: null,
      total: 0,
      errors: 0,
      warns: 0,
      info: 0,
      debug: 0,
      status: 'pass',
      statusLabel: 'Healthy',
      categories: {},
      network: { total: 0, failures: 0, warnings: 0, last: null },
      lastError: null,
      lastWarn: null,
    };

    const state = {
      all: [],
      console: [],
      network: [],
      probes: [],
      envHistory: [],
      environment: null,
    };

    function add(entry){
      if (!entry) return snapshot();
      const normalized = normalizeEntry(entry);
      pushLimited(state.all, normalized, config.maxEntries);
      pushLimited(state.console, normalized, config.maxConsole);
      categorize(normalized);
      updateSummary(normalized);
      return snapshot();
    }

    function snapshot(){
      return {
        summary: cloneSummary(),
        console: state.console.slice(),
        probes: state.probes.slice(),
        network: state.network.slice(),
        environment: state.environment ? { ...state.environment } : null,
        envHistory: state.envHistory.slice(),
      };
    }

    function toJSON(){
      const snap = snapshot();
      return {
        generatedAt: new Date().toISOString(),
        summary: snap.summary,
        console: snap.console,
        probes: snap.probes,
        network: snap.network,
        environment: snap.environment,
        envHistory: snap.envHistory,
      };
    }

    function toText(){
      const snap = snapshot();
      const lines = [];
      lines.push('=== Diagnostics Summary ===');
      lines.push(`Generated: ${new Date().toISOString()}`);
      lines.push(`Status: ${snap.summary.statusLabel}`);
      lines.push(`Total entries: ${snap.summary.total}`);
      lines.push(`Errors: ${snap.summary.errors}, Warnings: ${snap.summary.warns}`);
      if (snap.summary.network.total) {
        lines.push(`Network: ${snap.summary.network.total} requests (${snap.summary.network.failures} fail, ${snap.summary.network.warnings} warn)`);
      }
      if (snap.summary.lastError) {
        lines.push(`Last error: [${formatISO(snap.summary.lastError.timestamp)}] ${snap.summary.lastError.message}`);
      }
      lines.push('');
      lines.push('=== Console Entries ===');
      if (snap.console.length) {
        snap.console.forEach((entry) => lines.push(formatLine(entry)));
      } else {
        lines.push('No console entries captured.');
      }
      lines.push('');
      lines.push('=== Probes ===');
      if (snap.probes.length) {
        snap.probes.forEach((entry) => lines.push(formatLine(entry)));
      } else {
        lines.push('No probe activity captured.');
      }
      lines.push('');
      lines.push('=== Network ===');
      if (snap.network.length) {
        snap.network.forEach((entry) => lines.push(formatLine(entry)));
      } else {
        lines.push('No network requests recorded.');
      }
      lines.push('');
      lines.push('=== Environment ===');
      if (snap.environment) {
        lines.push(safeStringify(snap.environment.details ?? snap.environment));
      } else {
        lines.push('No environment snapshot available.');
      }
      return lines.join('\n');
    }

    function categorize(entry){
      const categoryKey = entry.category.toLowerCase();
      if (categoryKey === 'network') {
        pushLimited(state.network, entry, config.maxNetwork);
        return;
      }
      if (categoryKey === 'environment') {
        const envSnapshot = summarizeEntry(entry, true);
        state.environment = envSnapshot;
        pushLimited(state.envHistory, envSnapshot, config.maxEnvHistory);
        return;
      }
      if (PROBE_CATEGORIES.has(categoryKey)) {
        pushLimited(state.probes, entry, config.maxProbes);
      }
    }

    function updateSummary(entry){
      summary.total += 1;
      const level = entry.level;
      if (level === 'error') {
        summary.errors += 1;
        summary.lastError = summarizeEntry(entry);
      } else if (level === 'warn') {
        summary.warns += 1;
        summary.lastWarn = summarizeEntry(entry);
      } else if (level === 'info') {
        summary.info += 1;
      } else if (level === 'debug') {
        summary.debug += 1;
      }
      const categoryKey = entry.category.toLowerCase();
      summary.categories[categoryKey] = (summary.categories[categoryKey] || 0) + 1;
      summary.updatedAt = entry.timestamp;
      if (categoryKey === 'network') {
        summary.network.total += 1;
        if (level === 'error') summary.network.failures += 1;
        else if (level === 'warn') summary.network.warnings += 1;
        summary.network.last = summarizeEntry(entry);
      }
      summary.status = deriveSummaryStatus(summary);
      summary.statusLabel = statusLabelFromSummaryStatus(summary.status);
    }

    function cloneSummary(){
      return {
        startedAt: summary.startedAt,
        updatedAt: summary.updatedAt,
        total: summary.total,
        errors: summary.errors,
        warns: summary.warns,
        info: summary.info,
        debug: summary.debug,
        status: summary.status,
        statusLabel: summary.statusLabel,
        categories: Object.assign({}, summary.categories),
        network: Object.assign({}, summary.network, { last: summary.network.last ? { ...summary.network.last } : null }),
        lastError: summary.lastError ? { ...summary.lastError } : null,
        lastWarn: summary.lastWarn ? { ...summary.lastWarn } : null,
      };
    }

    function normalizeEntry(entry){
      const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : Date.now();
      const level = String(entry.level || 'info').toLowerCase();
      const category = String(entry.category || 'general');
      return {
        timestamp,
        level,
        category,
        message: entry.message != null ? String(entry.message) : '',
        details: entry.details ?? null,
      };
    }

    function summarizeEntry(entry, includeDetails){
      const summaryEntry = {
        timestamp: entry.timestamp,
        level: entry.level,
        category: entry.category,
        message: entry.message,
      };
      if (includeDetails) {
        summaryEntry.details = entry.details;
      }
      return summaryEntry;
    }

    function pushLimited(list, item, limit){
      list.push(item);
      if (list.length > limit) {
        list.splice(0, list.length - limit);
      }
    }

    function deriveSummaryStatus(value){
      if (value.errors > 0) return 'fail';
      if (value.warns > 0) return 'warn';
      return 'pass';
    }

    function statusLabelFromSummaryStatus(status){
      if (status === 'fail') return 'Errors detected';
      if (status === 'warn') return 'Warnings detected';
      return 'Healthy';
    }

    function safeStringify(value){
      try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
    }

    function formatLine(entry){
      return `[${formatISO(entry.timestamp)}] ${entry.category}/${entry.level} ${entry.message}`;
    }

    function formatISO(value){
      if (typeof value !== 'number') return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toISOString();
    }

    return {
      config,
      add,
      snapshot,
      toJSON,
      toText,
    };
  }

  return { createReportStore };
});
