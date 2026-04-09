/* eslint-disable */
/**
 * Jayakula Brothers · Stocks Viewer
 *
 * Mobile-first read-only viewer.
 * - Reads stocks JSON published from the desktop app to Google Drive.
 * - Polls every 12 hours by default (configurable in config.json).
 * - Renders mobile cards by default; CSS swaps to a table at >= 768px.
 * - Filter pills for status / category / brand are generated dynamically
 *   from whatever items are currently in the snapshot.
 *
 * Loaded config (config.json, written by the GitHub Actions workflow):
 *   {
 *     "googleDriveFileId": "...",
 *     "googleApiKey": "...",
 *     "pollIntervalSeconds": 43200    // 12 hours default
 *   }
 */

(function () {
  'use strict';

  var POLL_DEFAULT = 43200; // 12 hours in seconds

  var state = {
    config: null,
    items: [],
    publishedAt: null,
    business: null,
    stats: null,
    sortKey: 'name',
    sortDir: 'asc',
    pollHandle: null,
    pollSeconds: POLL_DEFAULT,
    failureStreak: 0,
    lastFetchOk: null,

    // Active filter selections
    statusFilter: 'all',
    categoryFilter: 'all',
    brandFilter: 'all'
  };

  function $(id) { return document.getElementById(id); }

  function setStatus(tone, text) {
    var dot = $('status-dot');
    dot.classList.remove('ok', 'warn', 'error');
    if (tone) dot.classList.add(tone);
    $('status-text').textContent = text;
  }

  function showError(message) {
    var box = $('error-box');
    box.hidden = false;
    box.textContent = message;
  }

  function clearError() {
    var box = $('error-box');
    box.hidden = true;
    box.textContent = '';
  }

  function showConfigHint(message) {
    var box = $('config-box');
    box.hidden = false;
    box.innerHTML = message;
  }

  // ---------- config ----------

  async function loadConfig() {
    try {
      var res = await fetch('./config.json?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('config.json not reachable (' + res.status + ')');
      var cfg = await res.json();

      if (!cfg.googleDriveFileId || !cfg.googleApiKey) {
        throw new Error('config.json is missing googleDriveFileId or googleApiKey');
      }

      state.config = cfg;
      state.pollSeconds = Math.max(60, Number(cfg.pollIntervalSeconds || POLL_DEFAULT));
      $('poll-info').textContent = 'Auto-refresh ' + describePollInterval(state.pollSeconds);
      return true;
    } catch (err) {
      showConfigHint(
        'Configuration missing. Edit <code>config.json</code> in this folder and set ' +
        '<code>googleDriveFileId</code> and <code>googleApiKey</code>. ' +
        'See <code>README.md</code> in the <code>/web</code> folder for setup steps.<br><br>' +
        '<small>Detail: ' + escapeHtml(err.message) + '</small>'
      );
      setStatus('error', 'Config error');
      return false;
    }
  }

  function describePollInterval(seconds) {
    if (seconds >= 3600) {
      var h = Math.round(seconds / 3600);
      return 'every ' + h + 'h';
    }
    if (seconds >= 60) {
      var m = Math.round(seconds / 60);
      return 'every ' + m + 'm';
    }
    return 'every ' + seconds + 's';
  }

  // ---------- data fetch ----------

  function buildDriveUrl() {
    var c = state.config;
    return (
      'https://www.googleapis.com/drive/v3/files/' +
      encodeURIComponent(c.googleDriveFileId) +
      '?alt=media&key=' + encodeURIComponent(c.googleApiKey)
    );
  }

  async function fetchStocks() {
    var url = buildDriveUrl();
    var res = await fetch(url, { cache: 'no-store' });

    if (!res.ok) {
      var bodyText = await res.text().catch(function () { return ''; });
      var detail = '';
      try {
        var parsed = JSON.parse(bodyText);
        detail = (parsed && parsed.error && parsed.error.message) || bodyText;
      } catch (_) {
        detail = bodyText;
      }
      throw new Error('Drive fetch failed (' + res.status + '): ' + (detail || 'unknown'));
    }

    var json = await res.json();

    if (!json || !Array.isArray(json.items)) {
      throw new Error('Stocks file is malformed (no items array).');
    }

    return json;
  }

  // ---------- helpers ----------

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatPrice(value) {
    var n = Number(value || 0);
    var currency = state.business && state.business.currency ? state.business.currency : '';
    return (currency ? currency + ' ' : '') +
      n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function statusBadge(item) {
    if (!item.inStock) return '<span class="badge out">Out of stock</span>';
    if (item.isLowStock) return '<span class="badge warn">Low stock</span>';
    return '<span class="badge ok">In stock</span>';
  }

  function relativeTime(date) {
    var diff = Math.round((Date.now() - date.getTime()) / 1000);
    if (diff < 5)     return 'just now';
    if (diff < 60)    return diff + 's ago';
    if (diff < 3600)  return Math.round(diff / 60) + 'm ago';
    if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
    return Math.round(diff / 86400) + 'd ago';
  }

  // ---------- dynamic filter pills ----------

  /**
   * Build the list of unique categories / brands from current items, sorted by
   * descending count, then alphabetically. Returns [{ value, count }, ...].
   */
  function uniqueValuesByCount(items, key) {
    var counts = Object.create(null);
    for (var i = 0; i < items.length; i++) {
      var raw = items[i] && items[i][key];
      var v = (raw == null ? '' : String(raw)).trim();
      if (!v) continue;
      counts[v] = (counts[v] || 0) + 1;
    }

    var arr = [];
    for (var k in counts) arr.push({ value: k, count: counts[k] });

    arr.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.value.localeCompare(b.value);
    });

    return arr;
  }

  function renderPillRail(railId, label, options, activeValue, onSelect) {
    var rail = $(railId);
    if (!rail) return;

    // Wipe everything except the leading <span class="pill-rail-label">
    while (rail.children.length > 1) rail.removeChild(rail.lastChild);

    if (!options.length) {
      rail.hidden = true;
      return;
    }
    rail.hidden = false;

    // Always include an "All" option at the start
    var fragment = document.createDocumentFragment();
    fragment.appendChild(buildPill('all', 'All', null, activeValue === 'all', onSelect));

    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      fragment.appendChild(buildPill(opt.value, opt.value, opt.count, activeValue === opt.value, onSelect));
    }

    rail.appendChild(fragment);
  }

  function buildPill(value, label, count, active, onSelect) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill' + (active ? ' active' : '');
    btn.setAttribute('data-value', value);

    var labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    btn.appendChild(labelSpan);

    if (count != null) {
      var countSpan = document.createElement('span');
      countSpan.className = 'count';
      countSpan.textContent = count;
      btn.appendChild(countSpan);
    }

    btn.addEventListener('click', function () { onSelect(value); });
    return btn;
  }

  function rebuildDynamicFilterRails() {
    var categories = uniqueValuesByCount(state.items, 'category');
    var brands     = uniqueValuesByCount(state.items, 'brand');

    // Reset filter selection if the previously-selected option no longer exists
    if (state.categoryFilter !== 'all' && !categories.some(function (c) { return c.value === state.categoryFilter; })) {
      state.categoryFilter = 'all';
    }
    if (state.brandFilter !== 'all' && !brands.some(function (b) { return b.value === state.brandFilter; })) {
      state.brandFilter = 'all';
    }

    renderPillRail('category-rail', 'Type', categories, state.categoryFilter, function (v) {
      state.categoryFilter = v;
      rebuildDynamicFilterRails();
      render();
    });

    renderPillRail('brand-rail', 'Brand', brands, state.brandFilter, function (v) {
      state.brandFilter = v;
      rebuildDynamicFilterRails();
      render();
    });
  }

  function refreshStatusPills() {
    var rail = $('status-rail');
    var pills = rail.querySelectorAll('.pill[data-status]');
    for (var i = 0; i < pills.length; i++) {
      pills[i].classList.toggle('active', pills[i].getAttribute('data-status') === state.statusFilter);
    }
  }

  // ---------- filtering / sorting ----------

  function getFilteredItems() {
    var query = ($('search').value || '').trim().toLowerCase();
    var statusF = state.statusFilter;
    var catF    = state.categoryFilter;
    var brandF  = state.brandFilter;

    var rows = state.items.slice();

    if (query) {
      rows = rows.filter(function (it) {
        return (
          (it.name || '').toLowerCase().indexOf(query) >= 0 ||
          (it.brand || '').toLowerCase().indexOf(query) >= 0 ||
          (it.sku || '').toLowerCase().indexOf(query) >= 0 ||
          (it.category || '').toLowerCase().indexOf(query) >= 0
        );
      });
    }

    if (statusF === 'in')  rows = rows.filter(function (it) { return it.inStock && !it.isLowStock; });
    if (statusF === 'low') rows = rows.filter(function (it) { return it.isLowStock && it.inStock; });
    if (statusF === 'out') rows = rows.filter(function (it) { return !it.inStock; });

    if (catF !== 'all')   rows = rows.filter(function (it) { return String(it.category || '') === catF; });
    if (brandF !== 'all') rows = rows.filter(function (it) { return String(it.brand    || '') === brandF; });

    var key = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;

    rows.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av || '').localeCompare(String(bv || '')) * dir;
    });

    return rows;
  }

  // ---------- rendering ----------

  function render() {
    if (state.business && state.business.name) {
      $('business-name').textContent = state.business.name;
    }

    if (state.publishedAt) {
      var d = new Date(state.publishedAt);
      $('last-updated').textContent = 'Updated ' + relativeTime(d);
      $('last-updated').setAttribute('title', d.toLocaleString());
    }

    if (state.stats) {
      $('stat-total').textContent = state.stats.totalItems;
      $('stat-low').textContent   = state.stats.lowStockCount;
      $('stat-out').textContent   = state.stats.outOfStockCount;
    }

    var rows = getFilteredItems();
    var cards = $('cards');
    var tbody = $('stocks-tbody');
    var empty = $('empty-state');

    if (!rows.length) {
      cards.innerHTML = '';
      tbody.innerHTML = '';
      empty.hidden = false;
      refreshStatusPills();
      return;
    }
    empty.hidden = true;

    // Mobile cards
    var cardHtml = '';
    for (var i = 0; i < rows.length; i++) {
      var it = rows[i];
      var meta = [];
      if (it.brand)    meta.push(escapeHtml(it.brand));
      if (it.category) meta.push(escapeHtml(it.category));
      if (it.sku)      meta.push('SKU ' + escapeHtml(it.sku));

      cardHtml +=
        '<article class="card-item' + (!it.inStock ? ' is-out' : '') + '">' +
          '<div class="name">' + escapeHtml(it.name) + '</div>' +
          '<div class="price">' + escapeHtml(formatPrice(it.sellingPrice)) + '</div>' +
          '<div class="meta">' + (meta.length ? '<span>' + meta.join('</span><span>') + '</span>' : '') + '</div>' +
          '<div class="footer">' +
            '<div class="qty">Qty: <strong>' + Number(it.quantityInStock || 0) + '</strong></div>' +
            statusBadge(it) +
          '</div>' +
        '</article>';
    }
    cards.innerHTML = cardHtml;

    // Desktop table
    var rowHtml = '';
    for (var j = 0; j < rows.length; j++) {
      var t = rows[j];
      rowHtml +=
        '<tr' + (!t.inStock ? ' class="is-out"' : '') + '>' +
          '<td>' + escapeHtml(t.name) + '</td>' +
          '<td>' + escapeHtml(t.brand) + '</td>' +
          '<td>' + escapeHtml(t.category) + '</td>' +
          '<td>' + escapeHtml(t.sku) + '</td>' +
          '<td class="num">' + Number(t.quantityInStock || 0) + '</td>' +
          '<td class="num">' + escapeHtml(formatPrice(t.sellingPrice)) + '</td>' +
          '<td>' + statusBadge(t) + '</td>' +
        '</tr>';
    }
    tbody.innerHTML = rowHtml;

    // Sort header indicators
    var headers = document.querySelectorAll('thead th[data-sort]');
    for (var h = 0; h < headers.length; h++) {
      var th = headers[h];
      if (th.getAttribute('data-sort') === state.sortKey) {
        th.setAttribute('data-sort-active', state.sortDir);
      } else {
        th.removeAttribute('data-sort-active');
      }
    }

    refreshStatusPills();
  }

  // ---------- polling ----------

  async function refresh(manual) {
    try {
      if (!state.config) return;

      var btn = $('refresh-btn');
      if (manual && btn) btn.classList.add('spinning');

      setStatus(state.lastFetchOk === false ? 'warn' : null, manual ? 'Refreshing…' : 'Updating…');

      var data = await fetchStocks();
      state.items       = data.items;
      state.publishedAt = data.publishedAt;
      state.business    = data.business || null;
      state.stats       = data.stats || null;

      state.lastFetchOk = true;
      state.failureStreak = 0;
      clearError();

      var stamp = new Date();
      setStatus('ok', 'Live · ' + stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

      rebuildDynamicFilterRails();
      render();

      if (btn) btn.classList.remove('spinning');
    } catch (err) {
      state.lastFetchOk = false;
      state.failureStreak += 1;
      setStatus('error', 'Update failed');
      showError(err.message + ' (attempt ' + state.failureStreak + ')');
      var btnErr = $('refresh-btn');
      if (btnErr) btnErr.classList.remove('spinning');
    }
  }

  function startPolling() {
    if (state.pollHandle) clearInterval(state.pollHandle);
    state.pollHandle = setInterval(function () { refresh(false); }, state.pollSeconds * 1000);
  }

  // ---------- wire-up ----------

  function wireEvents() {
    $('refresh-btn').addEventListener('click', function () { refresh(true); });

    $('search').addEventListener('input', function () { render(); });

    // Status pills
    var statusPills = document.querySelectorAll('#status-rail .pill[data-status]');
    for (var i = 0; i < statusPills.length; i++) {
      statusPills[i].addEventListener('click', function (e) {
        state.statusFilter = e.currentTarget.getAttribute('data-status');
        render();
      });
    }

    // Sort headers (table-only on desktop)
    var headers = document.querySelectorAll('thead th[data-sort]');
    for (var h = 0; h < headers.length; h++) {
      headers[h].addEventListener('click', function (e) {
        var key = e.currentTarget.getAttribute('data-sort');
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = 'asc';
        }
        render();
      });
    }

    // Pause polling when tab is hidden, refresh when it returns
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (state.pollHandle) { clearInterval(state.pollHandle); state.pollHandle = null; }
      } else {
        // Only refresh on return if it's been longer than the poll interval since the last fetch
        refresh(false);
        startPolling();
      }
    });
  }

  async function main() {
    wireEvents();
    var loaded = await loadConfig();
    if (!loaded) return;
    await refresh(true);
    startPolling();
  }

  main();
})();
