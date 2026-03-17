/**
 * Open Status tab: load open orders (paste TSV), filter by route/customer/ready, Lbs due table, summary.
 */
(function () {
  'use strict';

  var OPENSTATUS_STORAGE_KEY = 'ctl-openstatus-data';
  var openStatusRows = [];
  var headerMap = {}; // original header index -> normalized key

  var COL_ALIASES = {
    order: ['order', 'order #', 'order#', 'so', 'so no'],
    item: ['item', 'orderline', 'order line', 'line', 'so_ln', 'so ln'],
    dueDt: ['due dt', 'due_dt', 'due date', 'duedate', 'due'],
    balance: ['balance', 'balance (lbs)', 'lbs', 'lb', 'balance (pcs)'],
    route: ['unplanner route', 'unplanned route', 'route', 'latest job pick'],
    readyToS: ['ready to s', 'ready to ship', 'ready to s.', 'rts', 'ready to s'],
    shipped: ['shipped'],
    customer: ['customer', 'customer dm', 'cusname', 'cus name', 'cust']
  };

  function normalizeHeader(name) {
    if (!name || typeof name !== 'string') return '';
    var s = name.toLowerCase().trim().replace(/\s+/g, ' ');
    for (var key in COL_ALIASES) {
      for (var i = 0; i < COL_ALIASES[key].length; i++) {
        if (s.indexOf(COL_ALIASES[key][i]) === 0 || s === COL_ALIASES[key][i]) return key;
      }
    }
    return s.replace(/\s/g, '_') || 'col' + name.length;
  }

  /** Convert Excel serial date (days since 1899-12-30) to JS Date. */
  function excelSerialToDate(serial) {
    if (serial == null || isNaN(serial)) return null;
    var n = Number(serial);
    if (n > 1000000 || n < 0) return new Date(n);
    var utc = (n - 25569) * 86400 * 1000;
    return new Date(utc);
  }

  function parseDate(s) {
    if (s == null || s === '') return null;
    if (typeof s === 'number' && !isNaN(s)) {
      if (s > 1000 && s < 1000000) return excelSerialToDate(s);
      return new Date(s);
    }
    var str = String(s).trim();
    if (!str) return null;
    if (str.match(/^\d{4,5}$/)) {
      var n = parseInt(str, 10);
      if (n > 1000 && n < 1000000) return excelSerialToDate(n);
    }
    var m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      var y = parseInt(m[3], 10);
      if (y < 100) y += 2000;
      return new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }
    var d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function numVal(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number' && !isNaN(v)) return v;
    var n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function parsePaste(text) {
    var lines = (text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (lines.length < 2) return { headers: [], rows: [] };
    var sep = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var headerLine = lines[0].split(sep).map(function (h) { return h.trim(); });
    var headers = headerLine.map(function (h) { return normalizeHeader(h); });
    var routeColExact = -1;
    for (var ri = 0; ri < headerLine.length; ri++) {
      if ((headerLine[ri] || '').toLowerCase().trim() === 'route') { routeColExact = ri; break; }
    }
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split(sep).map(function (c) { return c.trim(); });
      var row = { _raw: {} };
      headers.forEach(function (key, idx) {
        var val = cells[idx];
        row[key] = val;
        row._raw[headerLine[idx] || key] = val;
      });
      if (routeColExact >= 0 && cells[routeColExact] != null) row.route = cells[routeColExact];
      row.balanceNum = numVal(row.balance);
      row.dueDate = parseDate(row.dueDt);
      row.readyNum = numVal(row.readyToS);
      row.shippedNum = numVal(row.shipped);
      rows.push(row);
    }
    return { headers: headers, rows: rows };
  }

  function findColIndex(headers, aliases) {
    for (var i = 0; i < headers.length; i++) {
      var h = (headers[i] != null ? String(headers[i]) : '').toLowerCase().trim().replace(/\s+/g, ' ');
      for (var a = 0; a < aliases.length; a++) {
        if (h.indexOf(aliases[a]) >= 0 || aliases[a].indexOf(h) >= 0) return i;
      }
    }
    return -1;
  }

  /** Prefer Column O "Route" over "Unplanned Route" (Column M). Use column with header exactly "Route" when present; else use Column O (index 14) if that header looks like route. */
  function findRouteColIndex(headerRow) {
    for (var i = 0; i < headerRow.length; i++) {
      var h = (headerRow[i] != null ? String(headerRow[i]) : '').toLowerCase().trim();
      if (h === 'route') return i;
    }
    var colO = 14;
    if (headerRow.length > colO) {
      var ho = (headerRow[colO] != null ? String(headerRow[colO]) : '').toLowerCase().trim();
      if (ho === 'route' || ho === 'ctl') return colO;
    }
    return findColIndex(headerRow, ['unplanner route', 'unplanned route', 'latest job pick']);
  }

  function parseExcelWorkbook(workbook) {
    var rows = [];
    if (typeof XLSX === 'undefined') return rows;
    var sheetNames = workbook.SheetNames || [];
    for (var s = 0; s < sheetNames.length; s++) {
      var sheet = workbook.Sheets[sheetNames[s]];
      if (!sheet) continue;
      var data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!data || data.length < 2) continue;
      var headerRow = data[0].map(function (c) { return c != null ? String(c).trim() : ''; });
      var idxOrder = findColIndex(headerRow, ['order', 'order #', 'so', 'so no']);
      var idxItem = findColIndex(headerRow, ['item', 'orderline', 'order line', 'line', 'so_ln', 'so ln']);
      var idxDue = findColIndex(headerRow, ['due dt', 'due date', 'duedate', 'due']);
      var idxBalance = findColIndex(headerRow, ['balance', 'balance (lbs)', 'lbs', 'lb']);
      var idxRoute = findRouteColIndex(headerRow);
      var idxReady = findColIndex(headerRow, ['ready to s', 'ready to ship', 'ready to s.', 'rts', 'ready to sshipped']);
      var idxShipped = findColIndex(headerRow, ['shipped']);
      var idxCustomer = findColIndex(headerRow, ['customer', 'customer dm', 'cus name', 'cusname', 'cust']);
      if (idxOrder < 0 && idxBalance < 0) continue;
      for (var r = 1; r < data.length; r++) {
        var raw = data[r];
        if (!raw || !raw.length) continue;
        var cell = function (i) {
          var v = raw[i];
          if (v == null) return '';
          if (typeof v === 'number' && !isNaN(v)) return String(v);
          return (String(v)).trim();
        };
        var order = idxOrder >= 0 ? cell(idxOrder) : '';
        var item = idxItem >= 0 ? cell(idxItem) : '';
        var rawDue = idxDue >= 0 ? raw[idxDue] : null;
        var dueDt = '';
        if (rawDue != null && rawDue !== '') {
          if (typeof rawDue === 'number' && rawDue > 1000 && rawDue < 1000000) {
            var dueDate = excelSerialToDate(rawDue);
            dueDt = dueDate ? (dueDate.getMonth() + 1) + '/' + dueDate.getDate() + '/' + dueDate.getFullYear() : '';
          } else {
            dueDt = String(rawDue).trim();
          }
        }
        var balance = idxBalance >= 0 ? cell(idxBalance) : '';
        var route = idxRoute >= 0 ? cell(idxRoute) : '';
        var readyToS = idxReady >= 0 ? cell(idxReady) : '';
        var shipped = idxShipped >= 0 ? cell(idxShipped) : '';
        var customer = idxCustomer >= 0 ? cell(idxCustomer) : '';
        if (!order && !balance) continue;
        var row = {
          _raw: {},
          order: order,
          item: item,
          dueDt: dueDt,
          balance: balance,
          route: route,
          readyToS: readyToS,
          shipped: shipped,
          customer: customer,
          balanceNum: numVal(balance),
          dueDate: parseDate(dueDt),
          readyNum: numVal(readyToS),
          shippedNum: numVal(shipped)
        };
        headerRow.forEach(function (h, i) { row._raw[h || 'col' + i] = cell(i); });
        rows.push(row);
      }
    }
    return rows;
  }

  var EXCLUDED_CUSTOMERS = ['Aim Recycling', 'Radius Cycling'];

  function isExcludedCustomer(customer) {
    var c = (customer || '').trim().toLowerCase();
    return EXCLUDED_CUSTOMERS.some(function (x) { return x.toLowerCase() === c; });
  }

  function getFilteredRows() {
    var routeEl = document.getElementById('openstatus-route-filter');
    var customerEl = document.getElementById('openstatus-customer-filter');
    var readyEl = document.getElementById('openstatus-ready-filter');
    var selectedRoutes = routeEl ? Array.from(routeEl.selectedOptions || []).map(function (o) { return o.value; }) : [];
    var selectedCustomers = customerEl ? Array.from(customerEl.selectedOptions || []).map(function (o) { return o.value; }) : [];
    var readyOnly = readyEl && readyEl.value === 'ready';

    return openStatusRows.filter(function (row) {
      if (isExcludedCustomer(row.customer)) return false;
      if (selectedRoutes.length && selectedRoutes.indexOf(row.route || '') < 0) return false;
      if (selectedCustomers.length && selectedCustomers.indexOf(row.customer || '') < 0) return false;
      if (readyOnly && (row.readyNum == null || row.readyNum <= 0)) return false;
      return true;
    });
  }

  function todayStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Week starts Sunday. Returns Sunday 00:00 of the week containing date d. */
  function getWeekStart(d) {
    var x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    var day = x.getDay();
    x.setDate(x.getDate() - day);
    return x;
  }

  /** Sunday-based week number (1-based). Week 1 = week containing Jan 1. */
  function getWeekNumber(d) {
    var weekStart = getWeekStart(d);
    var jan1 = new Date(weekStart.getFullYear(), 0, 1);
    var firstSun = getWeekStart(jan1);
    var diff = weekStart.getTime() - firstSun.getTime();
    return 1 + Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
  }

  function dateKey(d) {
    if (!d) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function renderFilters() {
    var routes = {};
    var customers = {};
    openStatusRows.forEach(function (row) {
      if (isExcludedCustomer(row.customer)) return;
      var r = (row.route || '').trim();
      if (r) routes[r] = true;
      var c = (row.customer || '').trim();
      if (c) customers[c] = true;
    });
    var routeEl = document.getElementById('openstatus-route-filter');
    var customerEl = document.getElementById('openstatus-customer-filter');
    if (routeEl) {
      var before = Array.from(routeEl.selectedOptions).map(function (o) { return o.value; });
      routeEl.innerHTML = Object.keys(routes).sort().map(function (r) {
        var sel = before.indexOf(r) >= 0 ? ' selected' : '';
        return '<option value="' + escapeAttr(r) + '"' + sel + '>' + escapeHtml(r) + '</option>';
      }).join('');
    }
    if (customerEl) {
      var beforeC = Array.from(customerEl.selectedOptions).map(function (o) { return o.value; });
      customerEl.innerHTML = Object.keys(customers).sort().map(function (c) {
        var sel = beforeC.indexOf(c) >= 0 ? ' selected' : '';
        return '<option value="' + escapeAttr(c) + '"' + sel + '>' + escapeHtml(c) + '</option>';
      }).join('');
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** Get orders that belong to a given period (for drill-down modal). */
  function getOrdersForPeriod(periodType, periodValue) {
    var filtered = getFilteredRows();
    var today = todayStart();
    if (periodType === 'past-due') {
      return filtered.filter(function (row) {
        var due = row.dueDate;
        if (!due || isNaN(due.getTime())) return true;
        var dueOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());
        return dueOnly < today;
      });
    }
    if (periodType === 'current-week') {
      var weekStart = getWeekStart(today);
      var weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return filtered.filter(function (row) {
        var due = row.dueDate;
        if (!due || isNaN(due.getTime())) return false;
        var dueOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());
        return dueOnly >= weekStart && dueOnly <= weekEnd;
      });
    }
    if (periodType === 'date' && periodValue) {
      return filtered.filter(function (row) {
        var due = row.dueDate;
        if (!due || isNaN(due.getTime())) return false;
        return dateKey(due) === periodValue;
      });
    }
    return [];
  }

  function showOrdersModal(periodLabel, orders) {
    var overlay = document.getElementById('openstatus-orders-modal');
    var titleEl = document.getElementById('openstatus-orders-modal-title');
    var tbody = document.getElementById('openstatus-orders-modal-body');
    if (!overlay || !tbody) return;
    if (titleEl) titleEl.textContent = 'Orders — ' + periodLabel;
    var blockedIds = getBlockedOrderIds();
    function isNoMaterial(row) {
      var id = (row.order != null ? String(row.order).trim() : '') + (row.item != null && row.item !== '' ? '-' + String(row.item).trim() : '');
      var orderOnly = (row.order != null ? String(row.order).trim() : '');
      if (orderOnly.indexOf('-') >= 0) orderOnly = orderOnly.split('-')[0].trim();
      return (id && blockedIds[id]) || (orderOnly && blockedIds[orderOnly]);
    }
    var html = orders.map(function (row) {
      var orderLine = (row.order || '') + (row.item != null && row.item !== '' ? '-' + row.item : '');
      var noMat = isNoMaterial(row) ? ' data-no-material="1"' : '';
      return '<tr' + noMat + '><td>' + escapeHtml(orderLine) + '</td><td>' + escapeHtml(row.customer || '') + '</td><td>' + (row.balanceNum != null ? row.balanceNum.toLocaleString() : '') + '</td><td>' + (row.readyNum != null ? row.readyNum.toLocaleString() : '') + '</td><td>' + escapeHtml(row.dueDt || '') + '</td><td>' + (isNoMaterial(row) ? 'Yes' : '') + '</td></tr>';
    }).join('');
    tbody.innerHTML = html || '<tr><td colspan="6">No orders</td></tr>';
    overlay.classList.add('openstatus-modal-visible');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function hideOrdersModal() {
    var overlay = document.getElementById('openstatus-orders-modal');
    if (overlay) {
      overlay.classList.remove('openstatus-modal-visible');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function getBlockedOrderIds() {
    var fn = typeof window.ctlMaterialAvailabilityGetBlocked === 'function' ? window.ctlMaterialAvailabilityGetBlocked : null;
    var rows = fn ? fn() : [];
    var ids = {};
    function norm(o, item) {
      var ord = (o != null ? String(o) : '').trim();
      var it = (item != null ? String(item) : '').trim();
      return it ? ord + '-' + it : ord;
    }
    rows.forEach(function (r) {
      var o = (r.order != null ? String(r.order) : '').trim();
      if (!o) return;
      ids[o] = true;
      var orderOnly = o.indexOf('-') >= 0 ? o.split('-')[0].trim() : o;
      if (orderOnly) ids[orderOnly] = true;
    });
    return ids;
  }

  function applyFiltersAndRender() {
    var filtered = getFilteredRows();
    var today = todayStart();
    var blockedIds = getBlockedOrderIds();
    function isRowNoMaterial(row) {
      var id = (row.order != null ? String(row.order).trim() : '') + (row.item != null && row.item !== '' ? '-' + String(row.item).trim() : '');
      var orderOnly = (row.order != null ? String(row.order).trim() : '');
      if (orderOnly.indexOf('-') >= 0) orderOnly = orderOnly.split('-')[0].trim();
      return (id && blockedIds[id]) || (orderOnly && blockedIds[orderOnly]);
    }

    var pastDueLbs = 0;
    var pastDueReady = 0;
    var pastDueLines = 0;
    var pastDueNoMaterial = 0;
    var next10Lbs = 0;
    var readyToShipTotal = 0;
    var byDate = {}; // dateKey -> { balance, lines, ready, noMaterial }

    filtered.forEach(function (row) {
      var due = row.dueDate;
      var bal = row.balanceNum || 0;
      var ready = row.readyNum || 0;
      var noMat = isRowNoMaterial(row);
      readyToShipTotal += ready;
      if (!due || isNaN(due.getTime())) {
        pastDueLbs += bal;
        pastDueReady += ready;
        pastDueLines += 1;
        if (noMat) pastDueNoMaterial += 1;
        return;
      }
      var dueOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      if (dueOnly < today) {
        pastDueLbs += bal;
        pastDueReady += ready;
        pastDueLines += 1;
        if (noMat) pastDueNoMaterial += 1;
        return;
      }
      var key = dateKey(dueOnly);
      if (!byDate[key]) byDate[key] = { balance: 0, lines: 0, ready: 0, noMaterial: 0 };
      byDate[key].balance += bal;
      byDate[key].lines += 1;
      byDate[key].ready += ready;
      if (noMat) byDate[key].noMaterial += 1;
      var daysOut = Math.floor((dueOnly - today) / (24 * 60 * 60 * 1000));
      if (daysOut >= 0 && daysOut < 10) next10Lbs += bal;
    });

    // Current week (Sunday–Saturday) totals for summary and table row
    var today = todayStart();
    var weekStart = getWeekStart(today);
    var currentWeekLbs = 0;
    var currentWeekReady = 0;
    var currentWeekLines = 0;
    var currentWeekNoMaterial = 0;
    for (var wd = 0; wd < 7; wd++) {
      var dayDate = new Date(weekStart);
      dayDate.setDate(weekStart.getDate() + wd);
      var k = dateKey(dayDate);
      var cell = byDate[k];
      if (cell) {
        currentWeekLbs += cell.balance || 0;
        currentWeekReady += cell.ready || 0;
        currentWeekLines += cell.lines || 0;
        currentWeekNoMaterial += (cell.noMaterial != null ? cell.noMaterial : 0);
      }
    }
    var weekNum = getWeekNumber(today);

    // Summary
    setEl('openstatus-past-due', pastDueLbs > 0 ? pastDueLbs.toLocaleString() : '—');
    setEl('openstatus-next-10', next10Lbs > 0 ? next10Lbs.toLocaleString() : '—');
    setEl('openstatus-current-week', currentWeekLbs > 0 ? currentWeekLbs.toLocaleString() : '—');
    setEl('openstatus-ready-ship', readyToShipTotal > 0 ? readyToShipTotal.toLocaleString() : '—');

    // Lbs due table: Past due row, then Current week (Week N) row, then next 14 days. Avg trailer weight 45000; flag days > 60 trailers.
    var TRAILER_AVG_LBS = 45000;
    var TRAILER_CAP_FLAG = 60;
    function trailersEst(lbs) { return lbs > 0 ? Math.ceil(lbs / TRAILER_AVG_LBS) : 0; }
    function readyPct(bal, ready) { return bal > 0 ? ((ready / bal) * 100).toFixed(1) + '%' : '—'; }
    function noMaterialPct(lines, noMaterial) {
      if (lines == null || lines === 0) return '—';
      var n = noMaterial != null ? noMaterial : 0;
      return ((n / lines) * 100).toFixed(1) + '%';
    }

    var tbody = document.getElementById('openstatus-balance-per-day-body');
    if (tbody) {
      var rows = [];
      if (pastDueLbs > 0 || pastDueReady > 0) {
        var pastTrailers = trailersEst(pastDueLbs);
        var trClass = pastTrailers > TRAILER_CAP_FLAG ? ' openstatus-over-capacity' : '';
        rows.push('<tr class="openstatus-row-clickable' + trClass + '" role="button" tabindex="0" title="Click to list orders" data-period-type="past-due" data-period-value=""><td>Past due</td><td>' + pastDueLbs.toLocaleString() + '</td><td>' + (pastDueLines > 0 ? pastDueLines : '—') + '</td><td>' + pastDueReady.toLocaleString() + '</td><td>' + pastTrailers + '</td><td>' + readyPct(pastDueLbs, pastDueReady) + '</td><td>' + noMaterialPct(pastDueLines, pastDueNoMaterial) + '</td></tr>');
      }
      if (currentWeekLbs > 0 || currentWeekReady > 0) {
        var weekTrailers = trailersEst(currentWeekLbs);
        var weekTrClass = weekTrailers > TRAILER_CAP_FLAG ? ' openstatus-over-capacity' : '';
        rows.push('<tr class="openstatus-current-week-row openstatus-row-clickable' + weekTrClass + '" role="button" tabindex="0" title="Click to list orders" data-period-type="current-week" data-period-value=""><td>Current week (Week ' + weekNum + ')</td><td>' + currentWeekLbs.toLocaleString() + '</td><td>' + (currentWeekLines > 0 ? currentWeekLines : '—') + '</td><td>' + currentWeekReady.toLocaleString() + '</td><td>' + weekTrailers + '</td><td>' + readyPct(currentWeekLbs, currentWeekReady) + '</td><td>' + noMaterialPct(currentWeekLines, currentWeekNoMaterial) + '</td></tr>');
      }
      for (var i = 0; i < 14; i++) {
        var d = new Date(today);
        d.setDate(d.getDate() + i);
        var k = dateKey(d);
        var cell = byDate[k];
        if (cell && (cell.balance > 0 || cell.ready > 0)) {
          var trailers = trailersEst(cell.balance);
          var trClassDay = trailers > TRAILER_CAP_FLAG ? ' openstatus-over-capacity' : '';
          rows.push('<tr class="openstatus-row-clickable' + trClassDay + '" role="button" tabindex="0" title="Click to list orders" data-period-type="date" data-period-value="' + escapeAttr(k) + '"><td>' + k + '</td><td>' + cell.balance.toLocaleString() + '</td><td>' + cell.lines + '</td><td>' + cell.ready.toLocaleString() + '</td><td>' + trailers + '</td><td>' + readyPct(cell.balance, cell.ready) + '</td><td>' + noMaterialPct(cell.lines, cell.noMaterial) + '</td></tr>');
        }
      }
      tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="7">No data for next 2 weeks</td></tr>';
    }

  }

  window.ctlOpenStatusGetData = function () {
    return { rows: getFilteredRows(), todayKey: dateKey(todayStart()) };
  };

  function setEl(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setUploadStatus(message, isComplete) {
    var el = document.getElementById('openstatus-upload-status');
    if (el) {
      el.textContent = message;
      el.className = 'paste-status' + (isComplete ? ' upload-complete' : '');
    }
  }

  function restoreOpenStatusDateObjects() {
    openStatusRows.forEach(function (row) {
      row.dueDate = parseDate(row.dueDt);
    });
  }

  function loadOpenStatusFromStorage() {
    try {
      var raw = localStorage.getItem(OPENSTATUS_STORAGE_KEY);
      if (!raw) return;
      var loaded = JSON.parse(raw);
      if (Array.isArray(loaded) && loaded.length > 0) {
        openStatusRows = loaded;
        restoreOpenStatusDateObjects();
        setEl('openstatus-rows-count', openStatusRows.length);
        renderFilters();
        applyFiltersAndRender();
      }
    } catch (e) {}
  }

  function saveOpenStatusToStorage() {
    try {
      localStorage.setItem(OPENSTATUS_STORAGE_KEY, JSON.stringify(openStatusRows));
    } catch (e) {}
  }

  function init() {
    loadOpenStatusFromStorage();

    var fileInput = document.getElementById('openstatus-file');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var file = this.files && this.files[0];
        if (!file) return;
        setUploadStatus('Reading Excel…', false);
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var ab = e.target && e.target.result;
            if (!ab || typeof XLSX === 'undefined') {
              setUploadStatus('Excel library not loaded or file empty.', true);
              return;
            }
            var workbook = XLSX.read(ab, { type: 'array' });
            var rows = parseExcelWorkbook(workbook);
            openStatusRows = rows;
            restoreOpenStatusDateObjects();
            setEl('openstatus-rows-count', openStatusRows.length);
            renderFilters();
            applyFiltersAndRender();
            saveOpenStatusToStorage();
            setUploadStatus('Loaded ' + rows.length + ' rows from Excel.', true);
          } catch (err) {
            setUploadStatus(err.message || 'Failed to parse Excel.', true);
          }
          fileInput.value = '';
        };
        reader.onerror = function () {
          setUploadStatus('Could not read file.', true);
          fileInput.value = '';
        };
        reader.readAsArrayBuffer(file);
      });
    }

    var btn = document.getElementById('btn-apply-openstatus');
    if (btn) {
      btn.addEventListener('click', function () {
        var textarea = document.getElementById('openstatus-paste');
        var text = textarea ? textarea.value : '';
        setUploadStatus('', false);
        setTimeout(function () {
          var parsed = parsePaste(text);
          openStatusRows = parsed.rows || [];
          restoreOpenStatusDateObjects();
          setEl('openstatus-rows-count', openStatusRows.length);
          renderFilters();
          applyFiltersAndRender();
          saveOpenStatusToStorage();
          setUploadStatus('Upload complete', true);
        }, 0);
      });
    }

    var routeEl = document.getElementById('openstatus-route-filter');
    var customerEl = document.getElementById('openstatus-customer-filter');
    var readyEl = document.getElementById('openstatus-ready-filter');
    if (routeEl) routeEl.addEventListener('change', applyFiltersAndRender);
    if (customerEl) customerEl.addEventListener('change', applyFiltersAndRender);
    if (readyEl) readyEl.addEventListener('change', applyFiltersAndRender);

    var balanceTbody = document.getElementById('openstatus-balance-per-day-body');
    if (balanceTbody) {
      balanceTbody.addEventListener('click', function (e) {
        var tr = e.target && e.target.closest && e.target.closest('tr');
        if (!tr || !tr.classList.contains('openstatus-row-clickable')) return;
        var periodType = tr.getAttribute('data-period-type');
        var periodValue = tr.getAttribute('data-period-value') || '';
        var periodLabel = tr.cells[0] && tr.cells[0].textContent ? tr.cells[0].textContent.trim() : (periodType === 'past-due' ? 'Past due' : periodType === 'current-week' ? 'Current week' : periodValue);
        var orders = getOrdersForPeriod(periodType, periodValue);
        var blockedIds = getBlockedOrderIds();
        function isNoMaterial(row) {
          var id = (row.order != null ? String(row.order).trim() : '') + (row.item != null && row.item !== '' ? '-' + String(row.item).trim() : '');
          var orderOnly = (row.order != null ? String(row.order).trim() : '');
          if (orderOnly.indexOf('-') >= 0) orderOnly = orderOnly.split('-')[0].trim();
          return (id && blockedIds[id]) || (orderOnly && blockedIds[orderOnly]);
        }
        var noMaterialOnly = orders.filter(isNoMaterial);
        showOrdersModal('No material only — ' + periodLabel, noMaterialOnly);
      });
    }

    var modal = document.getElementById('openstatus-orders-modal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) hideOrdersModal();
      });
    }
    var closeBtn = document.getElementById('openstatus-orders-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', hideOrdersModal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
