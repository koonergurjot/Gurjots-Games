/* Gurjot's Games — diagnostics visuals manager */
(function(global){
  'use strict';

  const rootGlobal = typeof global !== 'undefined' ? global : (typeof window !== 'undefined' ? window : globalThis);

  function createVisualsManager(options = {}){
    const win = options.window || (typeof window !== 'undefined' ? window : rootGlobal);
    const doc = options.document || (win && win.document) || null;
    if (!win || !doc) {
      return createNoopManager();
    }

    const ratioProvider = typeof options.getPreferredRatio === 'function' ? options.getPreferredRatio : null;
    const raf = typeof win.requestAnimationFrame === 'function'
      ? win.requestAnimationFrame.bind(win)
      : (fn) => win.setTimeout(fn, 16);
    const caf = typeof win.cancelAnimationFrame === 'function'
      ? win.cancelAnimationFrame.bind(win)
      : (id) => win.clearTimeout(id);

    const LAYOUT_STYLES = {
      root: { border: '#2563eb', fill: 'rgba(37, 99, 235, 0.18)', label: '#1d4ed8' },
      canvas: { border: '#22c55e', fill: 'rgba(34, 197, 94, 0.16)', label: '#15803d' },
      hud: { border: '#d946ef', fill: 'rgba(217, 70, 239, 0.16)', label: '#a855f7' },
    };

    const HITBOX_COLORS = [
      { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.18)', text: '#b91c1c' },
      { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.18)', text: '#b45309' },
      { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.18)', text: '#047857' },
      { stroke: '#6366f1', fill: 'rgba(99, 102, 241, 0.18)', text: '#4338ca' },
      { stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.18)', text: '#db2777' },
    ];

    const state = {
      win,
      doc,
      ratioProvider,
      layout: { enabled: false, container: null, items: new Map() },
      grid: { enabled: false, container: null, canvas: null },
      hitboxes: { enabled: false, container: null, canvas: null, colorProbe: null, lastErrorStamp: 0 },
      metricsListeners: new Set(),
      frame: 0,
      disposed: false,
      lastPublicMetrics: null,
    };

    function scheduleFrame(){
      if (state.disposed) return;
      if (state.frame) return;
      state.frame = raf(step);
    }

    function cancelFrame(){
      if (!state.frame) return;
      caf(state.frame);
      state.frame = 0;
    }

    function shouldContinue(){
      return !state.disposed && (
        state.layout.enabled ||
        state.grid.enabled ||
        state.hitboxes.enabled ||
        state.metricsListeners.size > 0
      );
    }

    function step(){
      state.frame = 0;
      if (state.disposed) return;
      const metrics = collectMetrics();
      const publicMetrics = metrics.publicMetrics;
      if (!metricsEqual(state.lastPublicMetrics, publicMetrics)) {
        state.lastPublicMetrics = clonePublicMetrics(publicMetrics);
        notifyMetricsListeners(state.lastPublicMetrics);
      }
      if (state.layout.enabled) {
        updateLayoutOverlay(metrics);
      }
      if (state.grid.enabled) {
        updateGridOverlay(metrics);
      }
      if (state.hitboxes.enabled) {
        updateHitboxOverlay(metrics);
      }
      if (shouldContinue()) {
        scheduleFrame();
      }
    }

    function notifyMetricsListeners(metrics){
      if (!metrics) return;
      for (const listener of state.metricsListeners){
        try {
          listener(clonePublicMetrics(metrics));
        } catch (_) {}
      }
    }

    function metricsEqual(prev, next){
      if (prev === next) return true;
      if (!prev || !next) return false;
      const keys = ['cssWidth', 'cssHeight', 'pixelWidth', 'pixelHeight', 'dpr', 'preferredRatio'];
      for (const key of keys){
        const a = prev[key];
        const b = next[key];
        if (typeof a === 'number' || typeof b === 'number'){
          if (Number.isNaN(a) && Number.isNaN(b)) continue;
          if (a !== b) return false;
        } else if (a !== b) {
          return false;
        }
      }
      return true;
    }

    function clonePublicMetrics(metrics){
      if (!metrics) {
        return {
          cssWidth: null,
          cssHeight: null,
          pixelWidth: null,
          pixelHeight: null,
          dpr: null,
          preferredRatio: null,
        };
      }
      return {
        cssWidth: metrics.cssWidth ?? null,
        cssHeight: metrics.cssHeight ?? null,
        pixelWidth: metrics.pixelWidth ?? null,
        pixelHeight: metrics.pixelHeight ?? null,
        dpr: metrics.dpr ?? null,
        preferredRatio: metrics.preferredRatio ?? null,
      };
    }

    function isVisualNode(node){
      return !!(node && node.dataset && node.dataset.ggDiagVisual);
    }

    function findGameRoot(){
      if (!doc || !doc.querySelector) return null;
      const byId = doc.getElementById ? doc.getElementById('game-root') : null;
      if (byId && !isVisualNode(byId)) return byId;
      const any = doc.querySelector('#game-root');
      if (any && !isVisualNode(any)) return any;
      return null;
    }

    function findGameCanvas(root){
      if (!doc || !doc.querySelectorAll) return null;
      if (root && typeof root.querySelectorAll === 'function') {
        const local = root.querySelectorAll('canvas');
        for (let i = 0; i < local.length; i += 1){
          const canvas = local[i];
          if (!isVisualNode(canvas)) return canvas;
        }
      }
      const canvases = doc.querySelectorAll('canvas');
      for (let i = 0; i < canvases.length; i += 1){
        const canvas = canvases[i];
        if (isVisualNode(canvas)) continue;
        if (root && !root.contains(canvas)) continue;
        return canvas;
      }
      return null;
    }

    function findHudNodes(root){
      if (!doc || !doc.querySelectorAll) return [];
      const seen = new Set();
      const results = [];

      function add(node){
        if (!node || seen.has(node) || isVisualNode(node)) return;
        if (root && node !== root && !root.contains(node)) return;
        seen.add(node);
        results.push(node);
      }

      const byId = doc.getElementById ? doc.getElementById('hud') : null;
      if (byId) add(byId);

      const selectors = ['.hud', '[data-hud]', '[data-game-hud]', '[data-gg-hud]', '[data-hud-root]'];
      const scope = root && typeof root.querySelectorAll === 'function' ? root : doc;
      for (const selector of selectors){
        try {
          const nodes = scope.querySelectorAll(selector);
          for (let i = 0; i < nodes.length; i += 1){
            add(nodes[i]);
          }
        } catch (_) {}
      }

      return results;
    }

    function getRect(node){
      if (!node || typeof node.getBoundingClientRect !== 'function') return null;
      try {
        const rect = node.getBoundingClientRect();
        if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        };
      } catch (_) {
        return null;
      }
    }

    function formatDimension(value){
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      const abs = Math.abs(num);
      if (abs >= 1000) return String(Math.round(num));
      if (abs >= 10) return trimDecimal(num.toFixed(1));
      if (abs >= 1) return trimDecimal(num.toFixed(2));
      return trimDecimal(num.toFixed(3));
    }

    function formatSize(width, height){
      const w = formatDimension(width);
      const h = formatDimension(height);
      if (!w || !h) return null;
      return `${w}×${h}`;
    }

    function trimDecimal(str){
      const trimmed = String(str).replace(/0+$/, '').replace(/\.$/, '');
      if (trimmed === '' || trimmed === '-0') return '0';
      return trimmed;
    }

    function formatRatioNumber(value){
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      const abs = Math.abs(num);
      if (abs >= 10) return trimDecimal(num.toFixed(1));
      if (abs >= 1) return trimDecimal(num.toFixed(3));
      return trimDecimal(num.toFixed(4));
    }

    function reduceRatio(width, height){
      const w = Number(width);
      const h = Number(height);
      if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null;
      if (Number.isInteger(w) && Number.isInteger(h) && w !== 0 && h !== 0) {
        const gcd = greatestCommonDivisor(Math.abs(w), Math.abs(h));
        if (gcd > 0) {
          return `${Math.abs(w / gcd)}:${Math.abs(h / gcd)}`;
        }
        return `${Math.abs(w)}:${Math.abs(h)}`;
      }
      return formatRatioNumber(w / h);
    }

    function greatestCommonDivisor(a, b){
      let x = a;
      let y = b;
      while (y) {
        const temp = y;
        y = x % y;
        x = temp;
      }
      return x;
    }

    function normalizePreferredRatio(value){
      if (value === null || value === undefined) return null;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
      }
      if (typeof value === 'number') {
        return formatRatioNumber(value);
      }
      if (Array.isArray(value) && value.length >= 2) {
        const w = Number(value[0]);
        const h = Number(value[1]);
        return reduceRatio(w, h);
      }
      if (typeof value === 'object') {
        const w = value.width ?? value.w ?? value.x ?? value.ratioWidth ?? null;
        const h = value.height ?? value.h ?? value.y ?? value.ratioHeight ?? null;
        return reduceRatio(w, h);
      }
      return null;
    }

    function resolvePreferredRatio(){
      if (ratioProvider) {
        try {
          const provided = ratioProvider();
          const normalized = normalizePreferredRatio(provided);
          if (normalized) return normalized;
        } catch (_) {}
      }
      const debug = win.__GAME_DEBUG__;
      if (debug) {
        const direct = debug.preferredRatio ?? debug.preferredAspectRatio ?? debug.aspectRatio ?? null;
        const normalizedDirect = normalizePreferredRatio(typeof direct === 'function' ? direct.call(debug) : direct);
        if (normalizedDirect) return normalizedDirect;
        const method = typeof debug.getPreferredRatio === 'function' ? debug.getPreferredRatio : null;
        if (method) {
          try {
            const fromFn = method.call(debug);
            const normalizedFn = normalizePreferredRatio(fromFn);
            if (normalizedFn) return normalizedFn;
          } catch (_) {}
        }
      }
      return null;
    }

    function collectMetrics(){
      const rootNode = findGameRoot();
      const canvasNode = findGameCanvas(rootNode);
      const hudNodes = findHudNodes(rootNode);

      const rootRect = getRect(rootNode);
      const canvasRect = getRect(canvasNode);
      const hudRects = [];
      for (let i = 0; i < hudNodes.length; i += 1){
        hudRects.push({ node: hudNodes[i], rect: getRect(hudNodes[i]), index: i });
      }

      const cssWidth = canvasRect ? canvasRect.width : (rootRect ? rootRect.width : null);
      const cssHeight = canvasRect ? canvasRect.height : (rootRect ? rootRect.height : null);
      let pixelWidth = null;
      let pixelHeight = null;
      if (canvasNode) {
        const w = Number(canvasNode.width);
        const h = Number(canvasNode.height);
        if (Number.isFinite(w) && w > 0) pixelWidth = w;
        if (Number.isFinite(h) && h > 0) pixelHeight = h;
      }
      const dpr = Number.isFinite(win.devicePixelRatio) && win.devicePixelRatio > 0 ? win.devicePixelRatio : null;
      const preferredRatio = resolvePreferredRatio();

      const publicMetrics = {
        cssWidth: Number.isFinite(cssWidth) ? cssWidth : null,
        cssHeight: Number.isFinite(cssHeight) ? cssHeight : null,
        pixelWidth: Number.isFinite(pixelWidth) ? pixelWidth : null,
        pixelHeight: Number.isFinite(pixelHeight) ? pixelHeight : null,
        dpr: Number.isFinite(dpr) ? dpr : null,
        preferredRatio: preferredRatio || null,
      };

      return {
        rootNode,
        rootRect,
        canvasNode,
        canvasRect,
        hudRects,
        cssWidth: publicMetrics.cssWidth,
        cssHeight: publicMetrics.cssHeight,
        pixelWidth: publicMetrics.pixelWidth,
        pixelHeight: publicMetrics.pixelHeight,
        dpr: publicMetrics.dpr,
        preferredRatio: publicMetrics.preferredRatio,
        publicMetrics,
      };
    }

    function ensureLayoutOverlay(){
      if (state.layout.container && state.layout.container.parentNode) {
        return state.layout;
      }
      if (!doc || !doc.body) return state.layout;
      const container = doc.createElement('div');
      container.dataset.ggDiagVisual = 'layout';
      container.style.position = 'fixed';
      container.style.pointerEvents = 'none';
      container.style.left = '0';
      container.style.top = '0';
      container.style.width = '0';
      container.style.height = '0';
      container.style.zIndex = '2147482998';
      container.style.display = 'none';
      doc.body.appendChild(container);
      state.layout.container = container;
      if (!(state.layout.items instanceof Map)) {
        state.layout.items = new Map();
      }
      return state.layout;
    }

    function teardownLayoutOverlay(){
      if (state.layout.items && typeof state.layout.items.clear === 'function') {
        state.layout.items.forEach((entry) => {
          if (entry && entry.node && entry.node.parentNode) {
            entry.node.parentNode.removeChild(entry.node);
          }
        });
        state.layout.items.clear();
      }
      const container = state.layout.container;
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      }
      state.layout.container = null;
    }

    function ensureLayoutItem(key){
      if (!(state.layout.items instanceof Map)) {
        state.layout.items = new Map();
      }
      let entry = state.layout.items.get(key);
      if (entry && entry.node && entry.node.parentNode) {
        return entry;
      }
      ensureLayoutOverlay();
      if (!state.layout.container) return { node: null, label: null };
      const node = doc.createElement('div');
      node.dataset.ggDiagVisual = `layout-${key}`;
      node.style.position = 'absolute';
      node.style.pointerEvents = 'none';
      node.style.left = '0';
      node.style.top = '0';
      node.style.display = 'none';
      node.style.boxSizing = 'border-box';
      const label = doc.createElement('div');
      label.dataset.ggDiagVisual = `layout-${key}-label`;
      label.style.position = 'absolute';
      label.style.left = '0';
      label.style.top = '-24px';
      label.style.padding = '2px 6px';
      label.style.font = '11px "Segoe UI", system-ui, sans-serif';
      label.style.background = 'rgba(15, 23, 42, 0.82)';
      label.style.borderRadius = '4px';
      label.style.pointerEvents = 'none';
      label.style.whiteSpace = 'nowrap';
      label.style.maxWidth = '260px';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      node.appendChild(label);
      state.layout.container.appendChild(node);
      entry = { node, label };
      state.layout.items.set(key, entry);
      return entry;
    }

    function describeLayoutNode(node, fallback){
      if (!node) return fallback;
      if (node.id) return `#${node.id}`;
      if (node.dataset) {
        if (node.dataset.hudRole) return `[data-hud-role="${node.dataset.hudRole}"]`;
        if (node.dataset.gameHud) return `[data-game-hud="${node.dataset.gameHud}"]`;
        if (node.dataset.hud) return `[data-hud="${node.dataset.hud}"]`;
      }
      if (node.classList && node.classList.length) {
        return `.${node.classList[0]}`;
      }
      if (node.tagName) return node.tagName.toLowerCase();
      return fallback;
    }

    function buildLayoutLabel(kind, node, rect, metrics, index){
      const parts = [];
      const descriptor = describeLayoutNode(node, kind);
      if (kind === 'hud' && typeof index === 'number' && index > 0) {
        parts.push(`${descriptor} [${index + 1}]`);
      } else {
        parts.push(descriptor);
      }
      if (rect) {
        const cssLabel = formatSize(rect.width, rect.height);
        if (cssLabel) parts.push(`${cssLabel} CSS`);
      }
      if (kind === 'canvas') {
        const pixelLabel = formatSize(metrics.pixelWidth, metrics.pixelHeight);
        if (pixelLabel) parts.push(`${pixelLabel} px`);
        if (metrics.preferredRatio) parts.push(`pref ${metrics.preferredRatio}`);
      } else if (kind === 'root' && metrics.preferredRatio) {
        parts.push(`pref ${metrics.preferredRatio}`);
      }
      return parts.join(' • ');
    }

    function updateLayoutOverlay(metrics){
      const layout = ensureLayoutOverlay();
      const container = layout && layout.container;
      if (!container) return;
      const activeKeys = new Set();
      let visible = 0;

      function render(key, rect, label, palette){
        activeKeys.add(key);
        const entry = ensureLayoutItem(key);
        if (!entry.node) return;
        const colors = palette || LAYOUT_STYLES.root;
        entry.node.style.border = `1px solid ${colors.border}`;
        entry.node.style.backgroundColor = colors.fill;
        if (entry.label) entry.label.style.color = colors.label;
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          entry.node.style.display = 'none';
          return;
        }
        entry.node.style.display = 'block';
        entry.node.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
        entry.node.style.width = `${rect.width}px`;
        entry.node.style.height = `${rect.height}px`;
        if (entry.label) {
          entry.label.textContent = label || '';
          entry.label.title = label || '';
        }
        visible += 1;
      }

      if (metrics.rootRect) {
        render('root', metrics.rootRect, buildLayoutLabel('root', metrics.rootNode, metrics.rootRect, metrics), LAYOUT_STYLES.root);
      }

      if (metrics.canvasRect) {
        render('canvas', metrics.canvasRect, buildLayoutLabel('canvas', metrics.canvasNode, metrics.canvasRect, metrics), LAYOUT_STYLES.canvas);
      }

      for (let i = 0; i < metrics.hudRects.length; i += 1){
        const info = metrics.hudRects[i];
        render(`hud-${i}`, info.rect, buildLayoutLabel('hud', info.node, info.rect, metrics, i), LAYOUT_STYLES.hud);
      }

      const toRemove = [];
      if (state.layout.items && typeof state.layout.items.forEach === 'function') {
        state.layout.items.forEach((entry, key) => {
          if (!activeKeys.has(key)) {
            if (entry && entry.node && entry.node.parentNode) {
              entry.node.parentNode.removeChild(entry.node);
            }
            toRemove.push(key);
          }
        });
      }
      for (const key of toRemove){
        state.layout.items.delete(key);
      }

      container.style.display = visible > 0 ? 'block' : 'none';
    }

    function ensureGridOverlay(){
      if (state.grid.container && state.grid.container.parentNode) {
        return state.grid;
      }
      const container = doc.createElement('div');
      container.dataset.ggDiagVisual = 'grid';
      container.style.position = 'fixed';
      container.style.pointerEvents = 'none';
      container.style.left = '0';
      container.style.top = '0';
      container.style.width = '0';
      container.style.height = '0';
      container.style.zIndex = '2147482999';
      container.style.display = 'none';
      const canvas = doc.createElement('canvas');
      canvas.dataset.ggDiagVisual = 'grid-canvas';
      container.appendChild(canvas);
      doc.body.appendChild(container);
      state.grid.container = container;
      state.grid.canvas = canvas;
      return state.grid;
    }

    function teardownGridOverlay(){
      const container = state.grid.container;
      if (container && container.parentNode) container.parentNode.removeChild(container);
      state.grid.container = null;
      state.grid.canvas = null;
    }

    function updateGridOverlay(metrics){
      const { container, canvas } = ensureGridOverlay();
      if (!container || !canvas) return;
      const rect = metrics.canvasRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        container.style.display = 'none';
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      container.style.display = 'block';
      container.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
      container.style.width = `${rect.width}px`;
      container.style.height = `${rect.height}px`;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const dpr = Number.isFinite(metrics.dpr) && metrics.dpr > 0 ? metrics.dpr : 1;
      const widthPx = Math.max(1, Math.round(rect.width * dpr));
      const heightPx = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== widthPx || canvas.height !== heightPx) {
        canvas.width = widthPx;
        canvas.height = heightPx;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const stepX = rect.width / 10;
      const stepY = rect.height / 10;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.35)';
      for (let i = 1; i < 10; i += 1){
        const x = i * stepX;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, rect.height);
        ctx.stroke();
      }
      for (let i = 1; i < 10; i += 1){
        const y = i * stepY;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(rect.width, y);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.6)';
      ctx.strokeRect(0.5, 0.5, Math.max(rect.width - 1, 0), Math.max(rect.height - 1, 0));
      ctx.restore();
    }

    function ensureHitboxOverlay(){
      if (state.hitboxes.container && state.hitboxes.container.parentNode) {
        return state.hitboxes;
      }
      const container = doc.createElement('div');
      container.dataset.ggDiagVisual = 'hitboxes';
      container.style.position = 'fixed';
      container.style.pointerEvents = 'none';
      container.style.left = '0';
      container.style.top = '0';
      container.style.width = '0';
      container.style.height = '0';
      container.style.zIndex = '2147483002';
      container.style.display = 'none';
      const canvas = doc.createElement('canvas');
      canvas.dataset.ggDiagVisual = 'hitboxes-canvas';
      container.appendChild(canvas);
      doc.body.appendChild(container);
      state.hitboxes.container = container;
      state.hitboxes.canvas = canvas;
      return state.hitboxes;
    }

    function teardownHitboxOverlay(){
      const container = state.hitboxes.container;
      if (container && container.parentNode) container.parentNode.removeChild(container);
      state.hitboxes.container = null;
      state.hitboxes.canvas = null;
      if (state.hitboxes.colorProbe && state.hitboxes.colorProbe.parentNode) {
        state.hitboxes.colorProbe.parentNode.removeChild(state.hitboxes.colorProbe);
      }
      state.hitboxes.colorProbe = null;
    }

    function parseColor(color){
      if (!color || !doc || !win.getComputedStyle) return null;
      if (!state.hitboxes.colorProbe) {
        const probe = doc.createElement('div');
        probe.dataset.ggDiagVisual = 'color-probe';
        probe.style.position = 'fixed';
        probe.style.width = '0';
        probe.style.height = '0';
        probe.style.visibility = 'hidden';
        doc.body.appendChild(probe);
        state.hitboxes.colorProbe = probe;
      }
      const probe = state.hitboxes.colorProbe;
      probe.style.color = '';
      probe.style.color = color;
      const computed = win.getComputedStyle(probe).color;
      if (!computed) return null;
      const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)/.exec(computed);
      if (!match) return null;
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
      };
    }

    function applyAlpha(color, alpha){
      const parsed = parseColor(color);
      if (!parsed) return null;
      const clamped = Math.min(Math.max(alpha, 0), 1);
      return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${clamped})`;
    }

    function resolveHitboxColor(color, index){
      if (typeof color === 'string' && color.trim()) {
        const stroke = color.trim();
        const fill = applyAlpha(stroke, 0.18) || 'rgba(239, 68, 68, 0.18)';
        return { stroke, fill, text: stroke };
      }
      return HITBOX_COLORS[index % HITBOX_COLORS.length];
    }

    function toNumber(value){
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    }

    function normalizeHitboxRect(candidate){
      if (!candidate || typeof candidate !== 'object') return null;
      const rect = candidate.rect && typeof candidate.rect === 'object' ? candidate.rect : candidate;
      let x = toNumber(rect.x);
      let y = toNumber(rect.y);
      const left = toNumber(rect.left);
      const top = toNumber(rect.top);
      const right = toNumber(rect.right);
      const bottom = toNumber(rect.bottom);
      let width = toNumber(rect.width);
      let height = toNumber(rect.height);
      const centerX = toNumber(rect.centerX ?? rect.cx);
      const centerY = toNumber(rect.centerY ?? rect.cy);

      if (x === null) x = left;
      if (y === null) y = top;
      if ((width === null || width <= 0) && right !== null && left !== null) width = right - left;
      if ((height === null || height <= 0) && bottom !== null && top !== null) height = bottom - top;
      if ((width === null || width <= 0) && right !== null && x !== null) width = right - x;
      if ((height === null || height <= 0) && bottom !== null && y !== null) height = bottom - y;
      if ((x === null || y === null) && centerX !== null && centerY !== null && width !== null && height !== null) {
        if (x === null) x = centerX - width / 2;
        if (y === null) y = centerY - height / 2;
      }
      if (x === null && left !== null) x = left;
      if (y === null && top !== null) y = top;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
      return { x, y, width, height };
    }

    function normalizeHitboxes(raw){
      if (!Array.isArray(raw)) return [];
      const results = [];
      for (let i = 0; i < raw.length; i += 1){
        const item = raw[i];
        if (!item) continue;
        const rect = normalizeHitboxRect(item);
        if (!rect || rect.width === 0 || rect.height === 0) continue;
        const label = typeof item.label === 'string' ? item.label : (typeof item.name === 'string' ? item.name : null);
        const color = item.color || (item.rect && item.rect.color) || null;
        results.push({ rect, label, color });
      }
      return results;
    }

    function fetchHitboxes(){
      const debug = state.win.__GAME_DEBUG__;
      if (!debug) return [];
      let fn = null;
      if (typeof debug.hitboxes === 'function') fn = debug.hitboxes;
      else if (debug.debug && typeof debug.debug.hitboxes === 'function') fn = debug.debug.hitboxes;
      if (!fn) return [];
      try {
        let result = fn.call(debug);
        if (!Array.isArray(result)) {
          if (result && Array.isArray(result.rects)) result = result.rects;
          else if (result && Array.isArray(result.boxes)) result = result.boxes;
        }
        return normalizeHitboxes(Array.isArray(result) ? result : []);
      } catch (err) {
        const now = Date.now();
        if (!state.hitboxes.lastErrorStamp || now - state.hitboxes.lastErrorStamp > 5000) {
          state.hitboxes.lastErrorStamp = now;
          if (state.win.console && typeof state.win.console.warn === 'function') {
            state.win.console.warn('[gg-diag] hitboxes() failed', err);
          }
        }
        return [];
      }
    }

    function convertCoordinate(value, cssSize, pixelSize){
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      if (cssSize && Math.abs(num) <= 1) {
        return num * cssSize;
      }
      if (cssSize && pixelSize && Math.abs(num) > cssSize + 0.5) {
        return (num / pixelSize) * cssSize;
      }
      return num;
    }

    function convertLength(value, cssSize, pixelSize){
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      if (cssSize && Math.abs(num) <= 1) {
        return num * cssSize;
      }
      if (cssSize && pixelSize && Math.abs(num) > cssSize + 0.5) {
        return (num / pixelSize) * cssSize;
      }
      return num;
    }

    function convertHitboxRect(rect, metrics){
      const cssWidth = metrics.canvasRect ? metrics.canvasRect.width : metrics.cssWidth;
      const cssHeight = metrics.canvasRect ? metrics.canvasRect.height : metrics.cssHeight;
      if (!cssWidth || !cssHeight) return null;
      const pixelWidth = metrics.pixelWidth;
      const pixelHeight = metrics.pixelHeight;
      let x = convertCoordinate(rect.x, cssWidth, pixelWidth);
      let y = convertCoordinate(rect.y, cssHeight, pixelHeight);
      let width = convertLength(rect.width, cssWidth, pixelWidth);
      let height = convertLength(rect.height, cssHeight, pixelHeight);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
      if (width < 0) {
        x += width;
        width = Math.abs(width);
      }
      if (height < 0) {
        y += height;
        height = Math.abs(height);
      }
      if (width <= 0 || height <= 0) return null;
      return { x, y, width, height };
    }

    function updateHitboxOverlay(metrics){
      const { container, canvas } = ensureHitboxOverlay();
      if (!container || !canvas) return;
      const rect = metrics.canvasRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        container.style.display = 'none';
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      container.style.display = 'block';
      container.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
      container.style.width = `${rect.width}px`;
      container.style.height = `${rect.height}px`;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const dpr = Number.isFinite(metrics.dpr) && metrics.dpr > 0 ? metrics.dpr : 1;
      const widthPx = Math.max(1, Math.round(rect.width * dpr));
      const heightPx = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== widthPx || canvas.height !== heightPx) {
        canvas.width = widthPx;
        canvas.height = heightPx;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const boxes = fetchHitboxes();
      if (!boxes.length) {
        ctx.restore();
        return;
      }
      ctx.lineWidth = 1;
      ctx.font = '12px "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'top';
      for (let i = 0; i < boxes.length; i += 1){
        const box = boxes[i];
        const converted = convertHitboxRect(box.rect, metrics);
        if (!converted) continue;
        const palette = resolveHitboxColor(box.color, i);
        ctx.fillStyle = palette.fill || 'rgba(239, 68, 68, 0.18)';
        ctx.fillRect(converted.x, converted.y, converted.width, converted.height);
        ctx.strokeStyle = palette.stroke;
        ctx.strokeRect(converted.x + 0.5, converted.y + 0.5, Math.max(converted.width - 1, 0), Math.max(converted.height - 1, 0));
        if (box.label) {
          ctx.fillStyle = palette.text || palette.stroke;
          ctx.fillText(box.label, converted.x + 4, converted.y + 4);
        }
      }
      ctx.restore();
    }

    function setLayoutEnabled(enabled){
      const next = !!enabled;
      if (state.layout.enabled === next) return state.layout.enabled;
      state.layout.enabled = next;
      if (next) {
        ensureLayoutOverlay();
        scheduleFrame();
      } else {
        teardownLayoutOverlay();
        if (!shouldContinue()) cancelFrame();
      }
      return state.layout.enabled;
    }

    function setCanvasGridEnabled(enabled){
      const next = !!enabled;
      if (state.grid.enabled === next) return state.grid.enabled;
      state.grid.enabled = next;
      if (next) {
        ensureGridOverlay();
        scheduleFrame();
      } else {
        teardownGridOverlay();
        if (!shouldContinue()) cancelFrame();
      }
      return state.grid.enabled;
    }

    function setHitboxesEnabled(enabled){
      const next = !!enabled;
      if (state.hitboxes.enabled === next) return state.hitboxes.enabled;
      state.hitboxes.enabled = next;
      if (next) {
        ensureHitboxOverlay();
        scheduleFrame();
      } else {
        teardownHitboxOverlay();
        if (!shouldContinue()) cancelFrame();
      }
      return state.hitboxes.enabled;
    }

    function isLayoutEnabled(){
      return !!state.layout.enabled;
    }

    function isCanvasGridEnabled(){
      return !!state.grid.enabled;
    }

    function isHitboxesEnabled(){
      return !!state.hitboxes.enabled;
    }

    function onMetricsUpdate(callback){
      if (typeof callback !== 'function') return () => {};
      state.metricsListeners.add(callback);
      if (!state.lastPublicMetrics) {
        state.lastPublicMetrics = clonePublicMetrics(collectMetrics().publicMetrics);
      }
      try { callback(clonePublicMetrics(state.lastPublicMetrics)); } catch (_) {}
      scheduleFrame();
      return () => {
        state.metricsListeners.delete(callback);
        if (!shouldContinue()) cancelFrame();
      };
    }

    function getLatestMetrics(){
      if (!state.lastPublicMetrics) {
        state.lastPublicMetrics = clonePublicMetrics(collectMetrics().publicMetrics);
      }
      return clonePublicMetrics(state.lastPublicMetrics);
    }

    function destroy(){
      if (state.disposed) return;
      state.metricsListeners.clear();
      setLayoutEnabled(false);
      setCanvasGridEnabled(false);
      setHitboxesEnabled(false);
      cancelFrame();
      state.disposed = true;
    }

    return {
      setLayoutEnabled,
      isLayoutEnabled,
      setCanvasGridEnabled,
      isCanvasGridEnabled,
      setHitboxesEnabled,
      isHitboxesEnabled,
      onMetricsUpdate,
      getLatestMetrics,
      destroy,
    };
  }

  function createNoopManager(){
    const metrics = {
      cssWidth: null,
      cssHeight: null,
      pixelWidth: null,
      pixelHeight: null,
      dpr: null,
      preferredRatio: null,
    };
    function noop(){}
    return {
      setLayoutEnabled: () => false,
      isLayoutEnabled: () => false,
      setCanvasGridEnabled: () => false,
      isCanvasGridEnabled: () => false,
      setHitboxesEnabled: () => false,
      isHitboxesEnabled: () => false,
      onMetricsUpdate(callback){
        if (typeof callback === 'function') {
          try { callback({ ...metrics }); } catch (_) {}
        }
        return noop;
      },
      getLatestMetrics(){ return { ...metrics }; },
      destroy: noop,
    };
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { createVisualsManager };
  } else {
    const target = rootGlobal || {};
    target.GGDiagVisuals = { createVisualsManager };
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
