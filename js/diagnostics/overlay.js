(function(global){
  if (!global || !global.document) return;

  var TAB_IDS = ['overview', 'assets', 'errors', 'export'];
  var FOCUSABLE_SELECTOR = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function createElement(tag, className) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  function formatDateTime(ts) {
    if (typeof ts !== 'number' || !isFinite(ts)) return '—';
    try {
      return new Date(ts).toLocaleString();
    } catch(_) {
      return String(ts);
    }
  }

  function formatDuration(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    var seconds = ms / 1000;
    if (seconds < 60) return seconds.toFixed(2) + ' s';
    var minutes = Math.floor(seconds / 60);
    var remaining = seconds - (minutes * 60);
    if (minutes < 60) return minutes + 'm ' + remaining.toFixed(1) + 's';
    var hours = Math.floor(minutes / 60);
    var remMinutes = minutes - (hours * 60);
    return hours + 'h ' + remMinutes + 'm';
  }

  function deriveLevel(event) {
    if (!event) return 'info';
    if (event.topic === 'error') return 'error';
    var source = event.source || '';
    if (source.indexOf('warn') !== -1) return 'warn';
    if (source.indexOf('debug') !== -1) return 'debug';
    return 'info';
  }

  function deriveMessage(event) {
    if (!event) return '';
    if (event.message) return String(event.message);
    if (event.args && event.args.length) {
      try {
        return event.args.map(function(arg){
          if (arg == null) return String(arg);
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg);
            } catch(_) {
              return String(arg);
            }
          }
          return String(arg);
        }).join(' ');
      } catch(_){ }
    }
    if (event.source) return String(event.source);
    return '';
  }

  function extractLocation(stack) {
    if (!stack) return '—';
    try {
      var lines = String(stack).split(/\n|\\n/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line) continue;
        var match = line.match(/(\b\S+?:\d+(?::\d+)?)/);
        if (match && match[1]) {
          return match[1].replace(/^at\s+/, '');
        }
      }
    } catch(_){ }
    return '—';
  }

  function createEventKey(event) {
    if (!event) return '';
    return [event.ts, event.topic || '', event.source || '', event.message || '', event.stack || '', (event.args && event.args.length) || 0].join('|');
  }

  function copyToClipboard(text) {
    return new Promise(function(resolve, reject){
      if (!text && text !== '') {
        reject(new Error('Nothing to copy'));
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(resolve).catch(function(){
          fallbackCopy(text, resolve, reject);
        });
      } else {
        fallbackCopy(text, resolve, reject);
      }
    });
  }

  function fallbackCopy(text, resolve, reject) {
    try {
      var textarea = document.createElement('textarea');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      var success = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (success) resolve();
      else reject(new Error('Copy command failed'));
    } catch(err) {
      reject(err);
    }
  }

  function DiagnosticsOverlay(options) {
    options = options || {};

    var root = createElement('div', 'diagnostics-overlay');
    root.id = options.id || 'diag-v2';
    root.hidden = true;

    var panel = createElement('div', 'diagnostics-overlay__panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'diagnostics-title');
    panel.tabIndex = -1;

    var header = createElement('header', 'diagnostics-overlay__header');
    var titleWrap = createElement('div', 'diagnostics-overlay__title');
    var title = createElement('h2', 'diagnostics-overlay__heading');
    title.id = 'diagnostics-title';
    title.textContent = 'Diagnostics';
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);

    var closeBtn = createElement('button', 'diagnostics-overlay__close');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    header.appendChild(closeBtn);

    panel.appendChild(header);

    var tablist = createElement('div', 'diagnostics-overlay__tabs');
    tablist.setAttribute('role', 'tablist');
    panel.appendChild(tablist);

    var body = createElement('div', 'diagnostics-overlay__body');
    panel.appendChild(body);

    root.appendChild(panel);
    (document.body || document.documentElement).appendChild(root);

    var tabButtons = {};
    var tabPanels = {};
    var activeTab = 'overview';

    TAB_IDS.forEach(function(id, index){
      var btn = createElement('button', 'diagnostics-tab');
      btn.type = 'button';
      btn.textContent = id.charAt(0).toUpperCase() + id.slice(1);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('data-tab', id);
      btn.setAttribute('aria-controls', 'diagnostics-panel-' + id);
      btn.id = 'diagnostics-tab-' + id;
      if (index === 0) {
        btn.setAttribute('aria-selected', 'true');
        btn.tabIndex = 0;
        btn.classList.add('is-active');
      } else {
        btn.setAttribute('aria-selected', 'false');
        btn.tabIndex = -1;
      }
      tabButtons[id] = btn;
      tablist.appendChild(btn);

      var panelEl = createElement('div', 'diagnostics-panel');
      panelEl.id = 'diagnostics-panel-' + id;
      panelEl.setAttribute('role', 'tabpanel');
      panelEl.setAttribute('aria-labelledby', btn.id);
      if (index !== 0) {
        panelEl.hidden = true;
      }
      tabPanels[id] = panelEl;
      body.appendChild(panelEl);
    });

    var overviewPanel = tabPanels.overview;
    var overviewGrid = createElement('div', 'diagnostics-overview');
    var statTotal = createElement('div', 'diagnostics-stat');
    var statTotalLabel = createElement('div', 'diagnostics-stat__label');
    statTotalLabel.textContent = 'Total errors';
    var statTotalValue = createElement('div', 'diagnostics-stat__value');
    statTotalValue.id = 'diagnostics-total-errors';
    statTotalValue.textContent = '0';
    statTotal.appendChild(statTotalLabel);
    statTotal.appendChild(statTotalValue);

    var statLast = createElement('div', 'diagnostics-stat');
    var statLastLabel = createElement('div', 'diagnostics-stat__label');
    statLastLabel.textContent = 'Last error time';
    var statLastValue = createElement('div', 'diagnostics-stat__value');
    statLastValue.id = 'diagnostics-last-error';
    statLastValue.textContent = '—';
    statLast.appendChild(statLastLabel);
    statLast.appendChild(statLastValue);

    var statSlug = createElement('div', 'diagnostics-stat');
    var statSlugLabel = createElement('div', 'diagnostics-stat__label');
    statSlugLabel.textContent = 'Game slug';
    var statSlugValue = createElement('div', 'diagnostics-stat__value');
    statSlugValue.id = 'diagnostics-slug';
    statSlugValue.textContent = options.slug || '—';
    statSlug.appendChild(statSlugLabel);
    statSlug.appendChild(statSlugValue);

    var statAssets = createElement('div', 'diagnostics-stat');
    var statAssetsLabel = createElement('div', 'diagnostics-stat__label');
    statAssetsLabel.textContent = 'Assets';
    var statAssetsValue = createElement('div', 'diagnostics-stat__value');
    statAssetsValue.id = 'diagnostics-assets-summary';
    statAssetsValue.style.display = 'flex';
    statAssetsValue.style.alignItems = 'center';
    statAssetsValue.style.gap = '10px';
    var statAssetsIndicator = createElement('span', 'diagnostics-assets-indicator');
    statAssetsIndicator.style.display = 'inline-block';
    statAssetsIndicator.style.width = '14px';
    statAssetsIndicator.style.height = '14px';
    statAssetsIndicator.style.borderRadius = '50%';
    statAssetsIndicator.style.boxShadow = '0 0 0 rgba(0,0,0,0)';
    statAssetsIndicator.style.backgroundColor = '#9aa3c7';
    var statAssetsText = createElement('span', 'diagnostics-assets-text');
    statAssetsText.textContent = 'Pending scan';
    statAssetsValue.appendChild(statAssetsIndicator);
    statAssetsValue.appendChild(statAssetsText);
    statAssets.appendChild(statAssetsLabel);
    statAssets.appendChild(statAssetsValue);

    var statMount = createElement('div', 'diagnostics-stat');
    var statMountLabel = createElement('div', 'diagnostics-stat__label');
    statMountLabel.textContent = 'Mount time';
    var statMountValue = createElement('div', 'diagnostics-stat__value');
    statMountValue.id = 'diagnostics-mount-time';
    statMountValue.textContent = '—';
    statMount.appendChild(statMountLabel);
    statMount.appendChild(statMountValue);

    overviewGrid.appendChild(statTotal);
    overviewGrid.appendChild(statLast);
    overviewGrid.appendChild(statSlug);
    overviewGrid.appendChild(statAssets);
    overviewGrid.appendChild(statMount);
    overviewPanel.appendChild(overviewGrid);

    var assetsPanel = tabPanels.assets;
    var assetsWrap = createElement('div', 'diagnostics-assets');
    assetsWrap.style.display = 'flex';
    assetsWrap.style.flexDirection = 'column';
    assetsWrap.style.gap = '16px';
    var assetsSearch = createElement('input', 'diagnostics-assets__search');
    assetsSearch.type = 'search';
    assetsSearch.placeholder = 'Search assets…';
    assetsSearch.setAttribute('aria-label', 'Search assets');
    assetsSearch.style.padding = '10px 12px';
    assetsSearch.style.borderRadius = '10px';
    assetsSearch.style.border = '1px solid rgba(136, 163, 245, 0.35)';
    assetsSearch.style.background = 'rgba(14, 20, 44, 0.85)';
    assetsSearch.style.color = '#f5f7ff';
    assetsSearch.style.width = '100%';
    var assetsGroups = createElement('div', 'diagnostics-assets__groups');
    assetsGroups.style.display = 'flex';
    assetsGroups.style.flexDirection = 'column';
    assetsGroups.style.gap = '12px';
    assetsWrap.appendChild(assetsSearch);
    assetsWrap.appendChild(assetsGroups);
    assetsPanel.appendChild(assetsWrap);

    var errorsPanel = tabPanels.errors;
    var errorsTableWrap = createElement('div', 'diagnostics-errors');
    var errorsTable = createElement('table', 'diagnostics-errors__table');
    var errorsHead = createElement('thead');
    var headRow = createElement('tr');
    ['Time', 'Message', 'File:Line', 'Details'].forEach(function(label){
      var th = createElement('th');
      th.scope = 'col';
      th.textContent = label;
      headRow.appendChild(th);
    });
    errorsHead.appendChild(headRow);
    errorsTable.appendChild(errorsHead);
    var errorsBody = createElement('tbody');
    errorsBody.id = 'diagnostics-errors-body';
    errorsTable.appendChild(errorsBody);
    errorsTableWrap.appendChild(errorsTable);
    errorsPanel.appendChild(errorsTableWrap);

    var exportPanel = tabPanels.export;
    var exportWrap = createElement('div', 'diagnostics-export');
    var exportButtons = createElement('div', 'diagnostics-export__actions');
    var copyTextBtn = createElement('button', 'diagnostics-export__btn');
    copyTextBtn.type = 'button';
    copyTextBtn.textContent = 'Copy Logs (Text)';
    var copyJsonBtn = createElement('button', 'diagnostics-export__btn');
    copyJsonBtn.type = 'button';
    copyJsonBtn.textContent = 'Copy JSON';
    exportButtons.appendChild(copyTextBtn);
    exportButtons.appendChild(copyJsonBtn);
    var exportStatus = createElement('p', 'diagnostics-export__status');
    exportStatus.setAttribute('aria-live', 'polite');
    exportWrap.appendChild(exportButtons);
    exportWrap.appendChild(exportStatus);
    exportPanel.appendChild(exportWrap);

    var state = {
      root: root,
      panel: panel,
      tabButtons: tabButtons,
      tabPanels: tabPanels,
      activeTab: activeTab,
      totalErrorsEl: statTotalValue,
      lastErrorEl: statLastValue,
      slugEl: statSlugValue,
      mountTimeEl: statMountValue,
      assetIndicatorEl: statAssetsIndicator,
      assetSummaryTextEl: statAssetsText,
      assetSearchInput: assetsSearch,
      assetGroupsEl: assetsGroups,
      assetSearchQuery: '',
      assetMap: Object.create(null),
      assetCounts: { info: 0, warn: 0, error: 0 },
      errorsBody: errorsBody,
      exportStatus: exportStatus,
      copyTextBtn: copyTextBtn,
      copyJsonBtn: copyJsonBtn,
      meta: {
        slug: options.slug || '—',
        mountTimeMs: typeof options.mountTime === 'number' ? options.mountTime : null,
        totalErrors: 0,
        lastErrorTs: null
      },
      events: [],
      errorMap: Object.create(null),
      seenEvents: Object.create(null),
      bus: options.bus || null,
      onClose: typeof options.onClose === 'function' ? options.onClose : null,
      focusHandler: null,
      keyHandler: null,
      previousFocus: null
    };

    if (state.assetSearchInput) {
      state.assetSearchInput.addEventListener('input', handleAssetSearchInput);
    }

    function setActiveTab(id) {
      state.activeTab = id;
      TAB_IDS.forEach(function(tabId){
        var selected = tabId === id;
        var button = state.tabButtons[tabId];
        var panelEl = state.tabPanels[tabId];
        if (button) {
          button.setAttribute('aria-selected', selected ? 'true' : 'false');
          button.tabIndex = selected ? 0 : -1;
          if (selected) button.classList.add('is-active');
          else button.classList.remove('is-active');
        }
        if (panelEl) {
          panelEl.hidden = !selected;
        }
      });
    }

    function handleTabClick(event) {
      var btn = event.currentTarget;
      var tab = btn && btn.getAttribute('data-tab');
      if (!tab) return;
      setActiveTab(tab);
      btn.focus();
    }

    function handleTabKey(event) {
      var key = event.key || event.code;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
      event.preventDefault();
      var idx = TAB_IDS.indexOf(state.activeTab);
      if (idx === -1) idx = 0;
      if (key === 'ArrowLeft') {
        idx = (idx - 1 + TAB_IDS.length) % TAB_IDS.length;
      } else {
        idx = (idx + 1) % TAB_IDS.length;
      }
      var nextTab = TAB_IDS[idx];
      setActiveTab(nextTab);
      var nextBtn = state.tabButtons[nextTab];
      if (nextBtn) nextBtn.focus();
    }

    function recalcAssetCounts() {
      var counts = { info: 0, warn: 0, error: 0 };
      if (state.assetMap) {
        for (var key in state.assetMap) {
          if (!Object.prototype.hasOwnProperty.call(state.assetMap, key)) continue;
          var entry = state.assetMap[key];
          if (!entry) continue;
          var lvl = entry.level === 'error' ? 'error' : (entry.level === 'warn' ? 'warn' : 'info');
          counts[lvl] += 1;
        }
      }
      state.assetCounts = counts;
      return counts;
    }

    function computeAssetSummary() {
      var counts = state.assetCounts || { info: 0, warn: 0, error: 0 };
      var total = counts.info + counts.warn + counts.error;
      if (!total) {
        return { status: 'none', text: 'Pending scan' };
      }
      if (counts.error > 0) {
        return { status: 'error', text: counts.error + ' missing of ' + total };
      }
      if (counts.warn > 0) {
        return { status: 'warn', text: counts.warn + ' slow of ' + total };
      }
      return { status: 'ok', text: 'All ' + total + ' OK' };
    }

    function applyAssetIndicator(summary) {
      if (!state.assetIndicatorEl || !state.assetSummaryTextEl) return;
      var colorMap = {
        ok: '#37d67a',
        warn: '#f6c945',
        error: '#ff5f56',
        none: '#9aa3c7'
      };
      var color = colorMap[summary.status] || colorMap.none;
      state.assetIndicatorEl.style.backgroundColor = color;
      state.assetIndicatorEl.style.boxShadow = '0 0 12px ' + color;
      state.assetSummaryTextEl.textContent = summary.text;
    }

    function updateOverview() {
      if (state.totalErrorsEl) {
        state.totalErrorsEl.textContent = String(state.meta.totalErrors || 0);
      }
      if (state.lastErrorEl) {
        state.lastErrorEl.textContent = state.meta.lastErrorTs ? formatDateTime(state.meta.lastErrorTs) : '—';
      }
      if (state.slugEl) {
        state.slugEl.textContent = state.meta.slug || '—';
      }
      if (state.mountTimeEl) {
        state.mountTimeEl.textContent = state.meta.mountTimeMs != null ? formatDuration(state.meta.mountTimeMs) : '—';
      }
      if (state.assetIndicatorEl && state.assetSummaryTextEl) {
        applyAssetIndicator(computeAssetSummary());
      }
    }

    function renderErrors() {
      if (!state.errorsBody) return;
      state.errorsBody.innerHTML = '';
      var entries = [];
      for (var key in state.errorMap) {
        if (Object.prototype.hasOwnProperty.call(state.errorMap, key)) {
          entries.push(state.errorMap[key]);
        }
      }
      if (!entries.length) {
        var emptyRow = createElement('tr', 'diagnostics-errors__empty');
        var emptyCell = createElement('td');
        emptyCell.colSpan = 4;
        emptyCell.textContent = 'No errors captured yet.';
        emptyRow.appendChild(emptyCell);
        state.errorsBody.appendChild(emptyRow);
        return;
      }
      entries.sort(function(a, b){ return (b.lastTs || 0) - (a.lastTs || 0); });
      entries.forEach(function(entry){
        var row = createElement('tr');
        var timeCell = createElement('td');
        timeCell.textContent = entry.lastTs ? formatDateTime(entry.lastTs) : '—';
        row.appendChild(timeCell);

        var messageCell = createElement('td');
        messageCell.textContent = entry.message || '—';
        if (entry.count > 1) {
          var countTag = createElement('span', 'diagnostics-errors__count');
          countTag.textContent = '×' + entry.count;
          messageCell.appendChild(countTag);
        }
        row.appendChild(messageCell);

        var locationCell = createElement('td');
        locationCell.textContent = entry.location || '—';
        row.appendChild(locationCell);

        var detailsCell = createElement('td');
        var details = createElement('details', 'diagnostics-errors__details');
        var summary = createElement('summary');
        summary.textContent = 'View';
        details.appendChild(summary);
        var detailsContent = createElement('div', 'diagnostics-errors__details-content');
        if (entry.source) {
          var sourceP = createElement('p');
          sourceP.textContent = 'Source: ' + entry.source;
          detailsContent.appendChild(sourceP);
        }
        if (entry.stack) {
          var pre = createElement('pre');
          pre.textContent = entry.stack;
          detailsContent.appendChild(pre);
        }
        if (entry.rawEvent) {
          var rawPre = createElement('pre', 'diagnostics-errors__raw');
          try {
            rawPre.textContent = JSON.stringify(entry.rawEvent, null, 2);
          } catch(_){
            rawPre.textContent = String(entry.rawEvent);
          }
          detailsContent.appendChild(rawPre);
        }
        details.appendChild(detailsContent);
        detailsCell.appendChild(details);
        row.appendChild(detailsCell);
        state.errorsBody.appendChild(row);
      });
    }

    function renderAssets() {
      if (!state.assetGroupsEl) return;
      var query = (state.assetSearchQuery || '').toLowerCase();
      var groups = { error: [], warn: [], info: [] };
      if (state.assetMap) {
        for (var key in state.assetMap) {
          if (!Object.prototype.hasOwnProperty.call(state.assetMap, key)) continue;
          var entry = state.assetMap[key];
          if (!entry) continue;
          var combined = ((entry.url || '') + ' ' + (entry.message || '') + ' ' + (entry.status != null ? String(entry.status) : '')).toLowerCase();
          if (query && combined.indexOf(query) === -1) {
            continue;
          }
          var lvl = entry.level === 'error' ? 'error' : (entry.level === 'warn' ? 'warn' : 'info');
          groups[lvl].push(entry);
        }
      }

      state.assetGroupsEl.innerHTML = '';
      var total = groups.error.length + groups.warn.length + groups.info.length;
      if (!total) {
        var empty = createElement('p', 'diagnostics-assets__empty');
        empty.textContent = query ? 'No assets match your search.' : 'No assets scanned yet.';
        empty.style.color = 'rgba(211, 220, 255, 0.65)';
        empty.style.textAlign = 'center';
        empty.style.padding = '20px 0';
        state.assetGroupsEl.appendChild(empty);
        return;
      }

      var order = ['error', 'warn', 'info'];
      var labels = { error: 'Missing', warn: 'Slow (>2s)', info: 'OK' };
      for (var i = 0; i < order.length; i++) {
        var keyName = order[i];
        var section = createElement('section', 'diagnostics-assets__group');
        section.style.background = 'rgba(16, 22, 48, 0.85)';
        section.style.border = '1px solid rgba(86, 111, 186, 0.25)';
        section.style.borderRadius = '12px';
        section.style.padding = '14px 16px';

        var title = createElement('h3', 'diagnostics-assets__group-title');
        title.textContent = labels[keyName] + ' (' + groups[keyName].length + ')';
        title.style.margin = '0';
        title.style.fontSize = '1rem';
        section.appendChild(title);

        var list = createElement('ul', 'diagnostics-assets__list');
        list.style.listStyle = 'none';
        list.style.margin = '12px 0 0';
        list.style.padding = '0';

        var entriesList = groups[keyName].slice();
        if (!entriesList.length) {
          var none = createElement('li', 'diagnostics-assets__item--empty');
          none.textContent = 'No entries.';
          none.style.color = 'rgba(211, 220, 255, 0.6)';
          none.style.padding = '6px 0';
          list.appendChild(none);
        } else {
          entriesList.sort(function(a, b){
            return String(a.url || '').localeCompare(String(b.url || ''));
          });
          for (var j = 0; j < entriesList.length; j++) {
            var asset = entriesList[j];
            var item = createElement('li', 'diagnostics-assets__item');
            item.style.padding = '12px';
            item.style.borderRadius = '10px';
            item.style.marginBottom = '10px';
            var borderColor;
            var backgroundColor;
            if (keyName === 'error') {
              borderColor = 'rgba(255, 95, 86, 0.4)';
              backgroundColor = 'rgba(255, 95, 86, 0.12)';
            } else if (keyName === 'warn') {
              borderColor = 'rgba(246, 201, 69, 0.35)';
              backgroundColor = 'rgba(246, 201, 69, 0.12)';
            } else {
              borderColor = 'rgba(95, 231, 162, 0.35)';
              backgroundColor = 'rgba(55, 214, 122, 0.12)';
            }
            item.style.border = '1px solid ' + borderColor;
            item.style.background = backgroundColor;

            var urlRow = createElement('div', 'diagnostics-assets__item-url');
            urlRow.textContent = asset.url || '—';
            urlRow.style.fontWeight = '600';
            urlRow.style.wordBreak = 'break-word';

            var messageRow = null;
            if (asset.message) {
              messageRow = createElement('div', 'diagnostics-assets__item-message');
              messageRow.textContent = asset.message;
              messageRow.style.fontSize = '0.95rem';
              messageRow.style.marginTop = '6px';
              messageRow.style.color = '#e5e9ff';
            }

            var metaRow = createElement('div', 'diagnostics-assets__item-meta');
            var statusText = asset.status != null ? String(asset.status) : 'n/a';
            var durationText = typeof asset.duration === 'number' ? formatDuration(asset.duration) : '—';
            metaRow.textContent = 'Status: ' + statusText + ' · Duration: ' + durationText;
            metaRow.style.fontSize = '0.85rem';
            metaRow.style.marginTop = '4px';
            metaRow.style.color = 'rgba(211, 220, 255, 0.7)';

            item.appendChild(urlRow);
            if (messageRow) item.appendChild(messageRow);
            item.appendChild(metaRow);
            list.appendChild(item);
          }
          if (list.lastChild) {
            list.lastChild.style.marginBottom = '0';
          }
        }

        section.appendChild(list);
        state.assetGroupsEl.appendChild(section);
      }
    }

    function handleAssetSearchInput(event) {
      state.assetSearchQuery = event && event.target ? String(event.target.value || '') : '';
      renderAssets();
    }

    function handleAssetEvent(event) {
      if (!event || !event.details) return;
      var details = event.details;
      var url = details && details.url != null ? String(details.url) : '';
      if (!url) return;
      var level = event.level === 'error' ? 'error' : (event.level === 'warn' ? 'warn' : 'info');
      state.assetMap[url] = {
        url: url,
        level: level,
        status: details.status != null ? details.status : null,
        duration: typeof details.duration === 'number' ? details.duration : null,
        message: event.message || '',
        ts: event.ts || Date.now()
      };
      recalcAssetCounts();
    }

    function handleCopyResult(btn, message, isError) {
      if (!state.exportStatus) return;
      state.exportStatus.textContent = message;
      state.exportStatus.classList.toggle('is-error', !!isError);
      if (!btn) return;
      btn.disabled = true;
      setTimeout(function(){
        btn.disabled = false;
      }, 1200);
    }

    function handleCopyText() {
      var events = state.bus && typeof state.bus.getAll === 'function' ? state.bus.getAll() : state.events.slice();
      if (!events || !events.length) {
        handleCopyResult(state.copyTextBtn, 'No events to copy yet.', true);
        return;
      }
      var lines = events.map(function(evt){
        var time = evt.ts ? new Date(evt.ts).toISOString() : '';
        var level = deriveLevel(evt);
        var topic = evt.topic || 'general';
        var message = deriveMessage(evt);
        return [time, level.toUpperCase(), topic, message].join(' | ');
      });
      copyToClipboard(lines.join('\n')).then(function(){
        handleCopyResult(state.copyTextBtn, 'Logs copied to clipboard.', false);
      }).catch(function(err){
        var msg = err && err.message ? err.message : 'Failed to copy logs.';
        handleCopyResult(state.copyTextBtn, msg, true);
      });
    }

    function handleCopyJson() {
      var events = state.bus && typeof state.bus.getAll === 'function' ? state.bus.getAll() : state.events.slice();
      if (!events || !events.length) {
        handleCopyResult(state.copyJsonBtn, 'No events to copy yet.', true);
        return;
      }
      var payload;
      try {
        payload = JSON.stringify(events);
      } catch(err) {
        handleCopyResult(state.copyJsonBtn, 'Unable to serialize logs.', true);
        return;
      }
      copyToClipboard(payload).then(function(){
        handleCopyResult(state.copyJsonBtn, 'JSON copied to clipboard.', false);
      }).catch(function(err){
        var msg = err && err.message ? err.message : 'Failed to copy JSON.';
        handleCopyResult(state.copyJsonBtn, msg, true);
      });
    }

    function getFocusableElements() {
      return panel.querySelectorAll(FOCUSABLE_SELECTOR);
    }

    function trapFocus(event) {
      if (event.key !== 'Tab') return;
      var focusable = getFocusableElements();
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      var active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    function handleKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        api.close();
        return;
      }
      trapFocus(event);
    }

    function open() {
      if (!root.hidden) return;
      if (!root.isConnected) {
        (document.body || document.documentElement).appendChild(root);
      }
      root.hidden = false;
      state.previousFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      updateOverview();
      renderErrors();
      renderAssets();
      setActiveTab(state.activeTab || 'overview');
      panel.addEventListener('keydown', handleKeydown);
      tablist.addEventListener('keydown', handleTabKey);
      TAB_IDS.forEach(function(id){
        var btn = state.tabButtons[id];
        if (btn) btn.addEventListener('click', handleTabClick);
      });
      state.copyTextBtn.addEventListener('click', handleCopyText);
      state.copyJsonBtn.addEventListener('click', handleCopyJson);
      closeBtn.addEventListener('click', api.close);
      setTimeout(function(){
        var focusable = getFocusableElements();
        if (focusable.length) {
          focusable[0].focus();
        } else {
          panel.focus();
        }
      }, 0);
    }

    function close() {
      if (root.hidden) return;
      root.hidden = true;
      panel.removeEventListener('keydown', handleKeydown);
      tablist.removeEventListener('keydown', handleTabKey);
      TAB_IDS.forEach(function(id){
        var btn = state.tabButtons[id];
        if (btn) btn.removeEventListener('click', handleTabClick);
      });
      state.copyTextBtn.removeEventListener('click', handleCopyText);
      state.copyJsonBtn.removeEventListener('click', handleCopyJson);
      closeBtn.removeEventListener('click', api.close);
      if (state.previousFocus && typeof state.previousFocus.focus === 'function') {
        state.previousFocus.focus();
      }
      if (typeof state.onClose === 'function') {
        try { state.onClose(); } catch(_){ }
      }
    }

    function ingest(event) {
      if (!event || typeof event !== 'object') return;
      var key = createEventKey(event);
      if (state.seenEvents[key]) return;
      state.seenEvents[key] = true;
      state.events.push(event);
      if (event.topic === 'asset') {
        handleAssetEvent(event);
      }
      if (event.topic === 'error') {
        state.meta.totalErrors += 1;
        state.meta.lastErrorTs = event.ts || Date.now();
        var location = extractLocation(event.stack);
        if ((!location || location === '—') && event.args && event.args.length) {
          for (var i = 0; i < event.args.length; i++) {
            if (event.args[i] && event.args[i].stack) {
              location = extractLocation(event.args[i].stack);
              if (location && location !== '—') break;
            }
          }
        }
        var message = deriveMessage(event);
        var dedupKey = [message, location || '', event.source || ''].join('|');
        var existing = state.errorMap[dedupKey];
        if (!existing) {
          existing = {
            message: message,
            location: location,
            source: event.source || '',
            stack: event.stack || null,
            rawEvent: event,
            count: 0,
            lastTs: null
          };
          state.errorMap[dedupKey] = existing;
        }
        existing.count += 1;
        existing.lastTs = event.ts || Date.now();
        if (!existing.stack && event.stack) {
          existing.stack = event.stack;
        }
        if (!existing.rawEvent) {
          existing.rawEvent = event;
        }
      }
      if (!root.hidden) {
        updateOverview();
        renderErrors();
        renderAssets();
      }
    }

    function setMeta(updates) {
      if (!updates || typeof updates !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(updates, 'slug')) {
        state.meta.slug = updates.slug || '—';
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'mountTimeMs')) {
        state.meta.mountTimeMs = typeof updates.mountTimeMs === 'number' ? updates.mountTimeMs : null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'totalErrors')) {
        state.meta.totalErrors = updates.totalErrors;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'lastErrorTs')) {
        state.meta.lastErrorTs = updates.lastErrorTs;
      }
      if (!root.hidden) {
        updateOverview();
      }
    }

    function setBus(bus) {
      state.bus = bus;
      if (!bus || typeof bus.getAll !== 'function') return;
      try {
        var events = bus.getAll();
        if (Array.isArray(events)) {
          for (var i = 0; i < events.length; i++) {
            ingest(events[i]);
          }
        }
      } catch(_){ }
    }

    var api = {
      root: root,
      open: open,
      close: close,
      ingest: ingest,
      setMeta: setMeta,
      setBus: setBus,
      isOpen: function(){ return !root.hidden; }
    };

    if (Array.isArray(options.initialEvents)) {
      for (var idx = 0; idx < options.initialEvents.length; idx++) {
        ingest(options.initialEvents[idx]);
      }
    }

    updateOverview();
    renderErrors();
    renderAssets();

    return api;
  }

  global.DiagnosticsOverlay = {
    create: function(options){
      return new DiagnosticsOverlay(options);
    }
  };
})(typeof window !== 'undefined' ? window : this);
