/* eslint-disable */
/**
 * Stocks Viewer — vanilla JS, zero build step.
 *
 * Reads stocks.json that was published from the desktop app to Google Drive,
 * polls for updates, and renders a table.
 *
 * Configuration is loaded from ./config.json (so the viewer source can stay
 * generic and you can edit a single file when File ID / API key changes).
 *
 * config.json format:
 * {
 *   "googleDriveFileId": "1AbcDef...",
 *   "googleApiKey": "AIzaSy...",
 *   "pollIntervalSeconds": 30
 * }
 */

(function () {
  'use strict';

  var POLL_DEFAULT = 30;
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
    lastFetchOk: null
  };

  function $(id) { return document.getElementById(id); }

  function setStatus(state_, text) {
    var dot = $('status-dot');
    dot.classList.remove('ok', 'warn', 'error');
    if (state_) dot.classList.add(state_);
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

  // ----- config loading -----

  async function loadConfig() {
    try {
      var res = await fetch('./config.json?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('config.json not reachable (' + res.status + ')');
      var cfg = await res.json();

      if (!cfg.googleDriveFileId || !cfg.googleApiKey) {
        throw new Error('config.json is missing googleDriveFileId or googleApiKey');
      }

      state.config = cfg;
      state.pollSeconds = Math.max(5, Number(cfg.pollIntervalSeconds || POLL_DEFAULT));
      $('poll-info').textContent = 'Auto-refresh every ' + state.pollSeconds + 's';
      return true;
    } catch (err) {
      showConfigHint(
        'Configuration missing. Edit <code>config.json</code> in this folder and set ' +
        '<code>googleDriveFileId</code> and <code>googleApiKey</code>. ' +
        'See README.md in the <code>/web</code> folder for setup steps.<br><br>' +
        '<small>Detail: ' + escapeHtml(err.message) + '</small>'
      );
      setStatus('error', 'Config error');
      return false;
    }
  }

  // ----- data fetching -----

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

  // ----- rendering -----

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
    return (currency ? currency + ' ' : '') + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function statusBadge(item) {
    if (!item.inStock) return '<span class="badge out">Out of stock</span>';
    if (item.isLowStock) return '<span class="badge warn">Low stock</span>';
    return '<span class="badge ok">In stock</span>';
  }

  function getFilteredItems() {
    var query = ($('search').value || '').trim().toLowerCase();
    var filter = $('filter').value;

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

    if (filter === 'in')  rows = rows.filter(function (it) { return it.inStock && !it.isLowStock; });
    if (filter === 'low') rows = rows.filter(function (it) { return it.isLowStock && it.inStock; });
    if (filter === 'out') rows = rows.filter(function (it) { return !it.inStock; });

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

  function render() {
    if (state.business) $('business-name').textContent = (state.business.name || 'Stocks Viewer');

    if (state.publishedAt) {
      var d = new Date(state.publishedAt);
      $('last-updated').textContent = 'Last updated ' + relativeTime(d) + ' (' + d.toLocaleString() + ')';
    }

    if (state.stats) {
      $('stats').hidden = false;
      $('stat-total').textContent = state.stats.totalItems;
      $('stat-low').textContent = state.stats.lowStockCount;
      $('stat-out').textContent = state.stats.outOfStockCount;
    }

    var rows = getFilteredItems();
    var tbody = $('stocks-tbody');
    var empty = $('empty-state');

    if (!rows.length) {
      tbody.innerHTML = '';
      empty.hidden = false;
    } else {
      empty.hidden = true;
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        var it = rows[i];
        html +=
          '<tr>' +
          '<td>' + escapeHtml(it.name) + '</td>' +
          '<td>' + escapeHtml(it.brand) + '</td>' +
          '<td>' + escapeHtml(it.category) + '</td>' +
          '<td>' + escapeHtml(it.sku) + '</td>' +
          '<td class="num">' + Number(it.quantityInStock || 0) + '</td>' +
          '<td class="num">' + escapeHtml(formatPrice(it.sellingPrice)) + '</td>' +
          '<td>' + statusBadge(it) + '</td>' +
          '</tr>';
      }
      tbody.innerHTML = html;
    }

    var headers = document.querySelectorAll('thead th[data-sort]');
    for (var h = 0; h < headers.length; h++) {
      var th = headers[h];
      if (th.getAttribute('data-sort') === state.sortKey) {
        th.setAttribute('data-sort-active', state.sortDir);
      } else {
        th.removeAttribute('data-sort-active');
      }
    }
  }

  function relativeTime(date) {
    var diff = Math.round((Date.now() - date.getTime()) / 1000);
    if (diff < 5)   return 'just now';
    if (diff < 60)  return diff + 's ago';
    if (diff < 3600) return Math.round(diff / 60) + 'm ago';
    if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
    return Math.round(diff / 86400) + 'd ago';
  }

  // ----- polling loop -----

  async function refresh(manual) {
    try {
      if (!state.config) return;
      setStatus(state.lastFetchOk === false ? 'warn' : null, manual ? 'Refreshing…' : 'Updating…');

      var data = await fetchStocks();
      state.items       = data.items;
      state.publishedAt = data.publishedAt;
      state.business    = data.business || null;
      state.stats       = data.stats || null;

      state.lastFetchOk = true;
      state.failureStreak = 0;
      clearError();
      setStatus('ok', 'Live · updated ' + new Date().toLocaleTimeString());
      render();
    } catch (err) {
      state.lastFetchOk = false;
      state.failureStreak += 1;
      setStatus('error', 'Update failed');
      showError(err.message + ' (attempt ' + state.failureStreak + ')');
    }
  }

  function startPolling() {
    if (state.pollHandle) clearInterval(state.pollHandle);
    state.pollHandle = setInterval(function () { refresh(false); }, state.pollSeconds * 1000);
  }

  // ----- wire-up -----

  function wireEvents() {
    $('refresh-btn').addEventListener('click', function () { refresh(true); });
    $('search').addEventListener('input', function () { render(); });
    $('filter').addEventListener('change', function () { render(); });

    var headers = document.querySelectorAll('thead th[data-sort]');
    for (var i = 0; i < headers.length; i++) {
      headers[i].addEventListener('click', function (e) {
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

    // pause polling when tab hidden, refresh immediately when shown
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (state.pollHandle) { clearInterval(state.pollHandle); state.pollHandle = null; }
      } else {
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
