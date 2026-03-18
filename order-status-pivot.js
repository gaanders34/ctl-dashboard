/**
 * Due by Customer tab: paste export order status, build pivot table (Sum of Balance by customer, Past due + due for the week by date).
 * Week begins Sunday.
 */
(function () {
  'use strict';

  var ORDERPIVOT_STORAGE_KEY = 'ctl-orderpivot-data';
  var orderPivotRows = [];

  var COL_ALIASES = {
    order: ['order', 'order #', 'order#', 'work order', 'work order #', 'wo', 'job', 'job #', 'so', 'so no'],
    item: ['item', 'orderline', 'order line', 'line', 'so_ln', 'so ln'],
    dueDt: ['due dt', 'due_dt', 'due date', 'duedate', 'due'],
    balance: ['balance', 'balance (lbs)', 'lbs', 'lb'],
    readyToS: ['ready to s', 'ready to ship', 'ready to s.', 'rts', 'ready'],
    shipped: ['shipped', 'shipped (lbs)', 'ship'],
    unplanned: ['unplan', 'unplanned', 'unplanned (lbs)', 'not on schedule'],
    customerName: ['customer name', 'customer dm', 'cus name', 'cust name', 'cusname', 'bill to name', 'sold to name', 'customer', 'cust', 'name', 'bill to', 'ship to'],
    customer: ['customer id', 'customer_id', 'cust id', 'custid', 'customer number', 'cust no', 'cust no.']
  };

  function normalizeHeader(name) {
    if (!name || typeof name !== 'string') return '';
    var s = name.toLowerCase().trim().replace(/\s+/g, ' ');
    for (var key in COL_ALIASES) {
      for (var i = 0; i < COL_ALIASES[key].length; i++) {
        if (s.indexOf(COL_ALIASES[key][i]) === 0 || s === COL_ALIASES[key][i]) return key;
      }
    }
    return s.replace(/\s/g, '_') || '';
  }

  function getDisplayCustomerName(row) {
    var name = (row.customerName || '').trim();
    if (name) return name;
    var cust = (row.customer || '').trim();
    if (cust) return cust;
    return '—';
  }

  /** Excel serial date (days since 1899-12-30) to JS Date. */
  function excelSerialToDate(serial) {
    if (serial == null || isNaN(serial)) return null;
    var n = Number(serial);
    if (n > 1000000 || n < 0) return new Date(n);
    return new Date((n - 25569) * 86400 * 1000);
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

  /** Prefer column that is clearly the customer name (e.g. Customer DM) for row labels. */
  function findCustomerNameColIndex(headerLine) {
    var nameHeaders = ['customer dm', 'customer name', 'cus name', 'cust name', 'bill to name', 'sold to name'];
    for (var i = 0; i < headerLine.length; i++) {
      var h = (headerLine[i] || '').toLowerCase().trim().replace(/\s+/g, ' ');
      for (var j = 0; j < nameHeaders.length; j++) {
        if (h === nameHeaders[j] || h.indexOf(nameHeaders[j]) >= 0) return i;
      }
    }
    return -1;
  }

  function parsePaste(text) {
    var lines = (text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (lines.length < 2) return { headers: [], rows: [] };
    var sep = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var headerLine = lines[0].split(sep).map(function (h) { return h.trim(); });
    var headers = headerLine.map(function (h) { return normalizeHeader(h); });
    var customerNameColIdx = findCustomerNameColIndex(headerLine);
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split(sep).map(function (c) { return c.trim(); });
      var row = {};
      headers.forEach(function (key, idx) {
        if (!key) return;
        row[key] = cells[idx];
      });
      row.balanceNum = numVal(row.balance);
      row.dueDate = parseDate(row.dueDt);
      row.readyNum = numVal(row.readyToS);
      row.shippedNum = numVal(row.shipped);
      row.unplannedNum = numVal(row.unplanned);
      if (customerNameColIdx >= 0 && cells[customerNameColIdx] != null && String(cells[customerNameColIdx]).trim()) {
        row.displayCustomer = String(cells[customerNameColIdx]).trim();
      } else {
        row.displayCustomer = getDisplayCustomerName(row);
      }
      rows.push(row);
    }
    return { headers: headers, rows: rows };
  }

  function dateKey(d) {
    if (!d) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function getSundayForDate(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() - d.getDay());
    return d;
  }

  function formatDateCol(d) {
    var m = d.getMonth() + 1;
    var day = d.getDate();
    var y = d.getFullYear();
    return m + '/' + day + '/' + y;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function buildPivot(rows, asOfDate) {
    var asOf = asOfDate ? new Date(asOfDate + 'T12:00:00') : new Date();
    asOf.setHours(0, 0, 0, 0);
    var weekStart = new Date(asOf);
    weekStart.setDate(asOf.getDate() - asOf.getDay());
    var weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    var weekDates = [];
    for (var d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
      weekDates.push(new Date(d));
    }

    var pivot = {};
    var pivotDetails = {};
    var totalPastDueBalance = 0, totalPastDueLines = 0, totalDueWeekBalance = 0, totalDueWeekLines = 0;

    function ensureCustomer(cust) {
      if (!pivot[cust]) {
        pivot[cust] = { 'Past due': 0 };
        pivotDetails[cust] = { 'Past due': [] };
        weekDates.forEach(function (d) {
          var k = dateKey(d);
          pivot[cust][k] = 0;
          pivotDetails[cust][k] = [];
        });
      }
    }

    function addDetail(cust, colKey, row) {
      pivotDetails[cust][colKey].push({
        order: row.order != null ? row.order : '',
        item: row.item != null ? row.item : '',
        dueDt: row.dueDt != null ? row.dueDt : '',
        balance: row.balanceNum,
        readyNum: row.readyNum != null ? row.readyNum : 0,
        shippedNum: row.shippedNum != null ? row.shippedNum : 0,
        unplannedNum: row.unplannedNum != null ? row.unplannedNum : 0
      });
    }

  function normalizeOrderId(row) {
    var o = (row.order != null ? row.order : '').toString().trim();
    var item = (row.item != null ? row.item : '').toString().trim();
    return item ? o + '-' + item : o;
  }

  function getScheduleOrderIds() {
    var rows = (typeof window.ctlScheduleRows !== 'undefined' && window.ctlScheduleRows) ? window.ctlScheduleRows : [];
    var ids = {};
    rows.forEach(function (r) {
      var id = normalizeOrderId(r);
      if (id) ids[id] = true;
      var o = (r.order || '').toString().trim();
      if (o) {
        ids[o] = true;
        var orderOnly = o.indexOf('-') >= 0 ? o.split('-')[0].trim() : o;
        if (orderOnly) ids[orderOnly] = true;
      }
    });
    return ids;
  }

  function getBlockedOrderIds() {
    var fn = typeof window.ctlMaterialAvailabilityGetBlocked === 'function' ? window.ctlMaterialAvailabilityGetBlocked : null;
    var rows = fn ? fn() : [];
    var ids = {};
    rows.forEach(function (r) {
      var id = normalizeOrderId(r);
      if (id) ids[id] = true;
      var o = (r.order || '').toString().trim();
      if (o) {
        ids[o] = true;
        var orderOnly = o.indexOf('-') >= 0 ? o.split('-')[0].trim() : o;
        if (orderOnly) ids[orderOnly] = true;
      }
    });
    return ids;
  }

  function getNeedToCloseOrderIds() {
    var fn = typeof window.ctlMaterialAvailabilityGetNeedToCloseOrderIds === 'function' ? window.ctlMaterialAvailabilityGetNeedToCloseOrderIds : null;
    return fn ? fn() : {};
  }

  function getCellHighlight(details, scheduleIds, blockedIds, needToCloseIds) {
    if (!details || details.length === 0) return '';
    var totalBalance = 0, totalReady = 0;
    var balanceOnSchedule = 0, balanceNotOnSchedule = 0;
    var anyOnBlocked = false, anyNeedToClose = false;
    details.forEach(function (d) {
      var bal = d.balance != null ? d.balance : 0;
      totalBalance += bal;
      totalReady += d.readyNum != null ? d.readyNum : 0;
      var id = (d.order != null ? String(d.order).trim() : '') + (d.item != null && d.item !== '' ? '-' + String(d.item).trim() : '');
      var orderOnly = (d.order || '').toString().trim();
      if (orderOnly && orderOnly.indexOf('-') >= 0) orderOnly = orderOnly.split('-')[0].trim();
      var onSched = (id && scheduleIds[id]) || (orderOnly && scheduleIds[orderOnly]) || ((d.order || '').toString().trim() && scheduleIds[(d.order || '').toString().trim()]);
      if (onSched) balanceOnSchedule += bal; else balanceNotOnSchedule += bal;
      if ((id && blockedIds[id]) || (orderOnly && blockedIds[orderOnly])) anyOnBlocked = true;
      if ((id && needToCloseIds[id]) || (orderOnly && needToCloseIds[orderOnly])) anyNeedToClose = true;
    });
    var readyPct = totalBalance > 0 ? totalReady / totalBalance : 0;
    if (anyOnBlocked) return 'orderpivot-hl-purple';
    if (readyPct >= 1) return 'orderpivot-hl-brightgreen';
    if (readyPct >= 0.75) return 'orderpivot-hl-lightgreen';
    if (balanceOnSchedule === 0 && totalBalance > 0) return 'orderpivot-hl-red';
    if (balanceOnSchedule > 0 && balanceNotOnSchedule > 0) return 'orderpivot-hl-partial';
    if (anyNeedToClose || totalBalance < 5000) return 'orderpivot-hl-orange';
    return '';
  }

    rows.forEach(function (row) {
      var cust = row.displayCustomer;
      var due = row.dueDate;
      var bal = row.balanceNum;
      if (bal === 0) return;
      ensureCustomer(cust);
      if (!due) {
        pivot[cust]['Past due'] += bal;
        addDetail(cust, 'Past due', row);
        totalPastDueBalance += bal;
        totalPastDueLines += 1;
        return;
      }
      var dueOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      if (dueOnly < asOf) {
        pivot[cust]['Past due'] += bal;
        addDetail(cust, 'Past due', row);
        totalPastDueBalance += bal;
        totalPastDueLines += 1;
      } else if (dueOnly >= weekStart && dueOnly <= weekEnd) {
        var k = dateKey(dueOnly);
        pivot[cust][k] = (pivot[cust][k] || 0) + bal;
        addDetail(cust, k, row);
        totalDueWeekBalance += bal;
        totalDueWeekLines += 1;
      }
    });

    var customers = Object.keys(pivot).sort();
    var displayCols = ['Past due'].concat(weekDates.map(function (d) { return dateKey(d); }));

    var scheduleIds = getScheduleOrderIds();
    var blockedIds = getBlockedOrderIds();
    var needToCloseIds = getNeedToCloseOrderIds();
    var cellHighlights = {};
    customers.forEach(function (cust) {
      cellHighlights[cust] = {};
      displayCols.forEach(function (colKey) {
        var details = pivotDetails[cust] && pivotDetails[cust][colKey];
        cellHighlights[cust][colKey] = getCellHighlight(details, scheduleIds, blockedIds, needToCloseIds);
      });
    });

    return {
      customers: customers,
      columns: displayCols,
      pivot: pivot,
      pivotDetails: pivotDetails,
      cellHighlights: cellHighlights,
      weekStart: weekStart,
      weekEnd: weekEnd,
      summary: {
        totalPastDueBalance: totalPastDueBalance,
        totalPastDueLines: totalPastDueLines,
        totalDueWeekBalance: totalDueWeekBalance,
        totalDueWeekLines: totalDueWeekLines
      }
    };
  }

  var lastPivotData = null;

  function renderSummary(data) {
    if (!data || !data.summary) return;
    var s = data.summary;
    setEl('orderpivot-summary-past-due', s.totalPastDueBalance > 0 ? Number(s.totalPastDueBalance).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0');
    setEl('orderpivot-summary-due-week', s.totalDueWeekBalance > 0 ? Number(s.totalDueWeekBalance).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0');
    setEl('orderpivot-summary-past-due-lines', s.totalPastDueLines > 0 ? String(s.totalPastDueLines) : '0');
    setEl('orderpivot-summary-on-time-lines', s.totalDueWeekLines > 0 ? String(s.totalDueWeekLines) : '0');
  }

  function setEl(id, text) {
    var el = typeof id === 'string' ? document.getElementById(id) : id;
    if (el) el.textContent = text;
  }

  function showDetailPanel(customer, colKey) {
    if (!lastPivotData || !lastPivotData.pivotDetails) return;
    var details = lastPivotData.pivotDetails[customer] && lastPivotData.pivotDetails[customer][colKey];
    var titleEl = document.getElementById('orderpivot-detail-title');
    var tbody = document.getElementById('orderpivot-detail-tbody');
    var panel = document.getElementById('orderpivot-detail-panel');
    if (!panel || !tbody) return;
    var colLabel = colKey === 'Past due' ? 'Past due' : formatDateCol(new Date(colKey + 'T12:00:00'));
    if (titleEl) titleEl.textContent = 'Orders — ' + customer + ' — ' + colLabel;
    var matchFn = typeof window.ctlMaterialAvailabilityMatchBlockedRowForOpenOrder === 'function' ? window.ctlMaterialAvailabilityMatchBlockedRowForOpenOrder : null;
    var toDisp = typeof window.ctlMaterialAvailabilityRowToDisplayFields === 'function' ? window.ctlMaterialAvailabilityRowToDisplayFields : null;
    if (!details || details.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">No orders</td></tr>';
    } else {
      tbody.innerHTML = details.map(function (r) {
        var openRow = { order: r.order, item: r.item };
        var mat = matchFn ? matchFn(openRow) : null;
        var d = mat && toDisp ? toDisp(mat) : null;
        var orderLine = (r.order || '') + (r.item ? '-' + r.item : '');
        if (!d) {
          d = {
            cusName: customer || '—',
            order: orderLine || '—',
            due: r.dueDt || '—',
            tab: '—',
            notes: '—'
          };
        }
        var ownerKey = (mat && mat.order != null ? String(mat.order).trim() : '') || orderLine;
        var orderIdAttr = ownerKey ? ' data-order="' + escapeHtml(ownerKey) + '"' : '';
        var onList = mat ? 'Yes' : 'No';
        var trClass = mat ? 'no-material-row' : '';
        return '<tr class="' + trClass + '">' +
          '<td>' + escapeHtml(d.cusName) + '</td>' +
          '<td>' + escapeHtml(d.order) + '</td>' +
          '<td>' + escapeHtml(d.due) + '</td>' +
          '<td>' + escapeHtml(d.tab) + '</td>' +
          '<td>' + escapeHtml(d.notes) + '</td>' +
          '<td><span class="blocked-owner" contenteditable="true"' + orderIdAttr + '></span></td>' +
          '<td>' + escapeHtml(onList) + '</td></tr>';
      }).join('');
      if (typeof window.ctlRestoreBlockedOwners === 'function') window.ctlRestoreBlockedOwners(tbody);
    }
    panel.hidden = false;
  }

  function hideDetailPanel() {
    var panel = document.getElementById('orderpivot-detail-panel');
    if (panel) panel.hidden = true;
  }

  function renderPivotTable(data) {
    var thead = document.getElementById('orderpivot-thead');
    var tbody = document.getElementById('orderpivot-tbody');
    var emptyNote = document.getElementById('orderpivot-empty-note');
    if (!thead || !tbody) return;

    lastPivotData = data;

    if (!data || data.customers.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = '';
      if (emptyNote) {
        emptyNote.hidden = false;
        emptyNote.textContent = 'No data to display, or no rows with Balance. Paste export order status and click Apply.';
      }
      setEl('orderpivot-summary-past-due', '—');
      setEl('orderpivot-summary-due-week', '—');
      setEl('orderpivot-summary-past-due-lines', '—');
      setEl('orderpivot-summary-on-time-lines', '—');
      return;
    }

    if (emptyNote) emptyNote.hidden = true;
    renderSummary(data);

    var cols = data.columns;
    var headerHtml = '<tr><th class="orderpivot-row-label">Row Labels</th>';
    cols.forEach(function (k) {
      var label = k === 'Past due' ? 'Past due' : formatDateCol(new Date(k + 'T12:00:00'));
      headerHtml += '<th>' + escapeHtml(label) + '</th>';
    });
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;

    var bodyHtml = '';
    var highlights = data.cellHighlights || {};
    data.customers.forEach(function (cust, rowIdx) {
      bodyHtml += '<tr><td class="orderpivot-row-label">' + escapeHtml(cust) + '</td>';
      cols.forEach(function (k, colIdx) {
        var val = data.pivot[cust][k];
        var text = (val != null && val !== 0) ? Number(val).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '';
        var clickable = (val != null && val !== 0) ? ' orderpivot-cell-clickable' : '';
        var dataAttrs = (val != null && val !== 0) ? ' data-row="' + rowIdx + '" data-col="' + colIdx + '"' : '';
        var hlClass = (highlights[cust] && highlights[cust][k]) ? ' ' + highlights[cust][k] : '';
        bodyHtml += '<td class="orderpivot-num' + clickable + hlClass + '"' + dataAttrs + ' tabindex="0" role="button">' + escapeHtml(text) + '</td>';
      });
      bodyHtml += '</tr>';
    });
    tbody.innerHTML = bodyHtml;
  }

  function onPivotCellActivate(e) {
    var td = e.target && e.target.closest && e.target.closest('td.orderpivot-cell-clickable');
    if (!td || !td.dataset || !lastPivotData) return;
    var rowIdx = parseInt(td.dataset.row, 10);
    var colIdx = parseInt(td.dataset.col, 10);
    if (isNaN(rowIdx) || isNaN(colIdx) || lastPivotData.customers[rowIdx] == null || lastPivotData.columns[colIdx] == null) return;
    showDetailPanel(lastPivotData.customers[rowIdx], lastPivotData.columns[colIdx]);
  }

  var pivotTable = document.getElementById('orderpivot-table');
  if (pivotTable) {
    pivotTable.addEventListener('click', function (e) { onPivotCellActivate(e); });
    pivotTable.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPivotCellActivate(e);
      }
    });
  }
  var detailCloseBtn = document.getElementById('orderpivot-detail-close');
  if (detailCloseBtn) detailCloseBtn.addEventListener('click', hideDetailPanel);
  var detailPanel = document.getElementById('orderpivot-detail-panel');
  if (detailPanel) {
    detailPanel.addEventListener('click', function (e) {
      if (e.target === detailPanel) hideDetailPanel();
    });
  }

  function setUploadStatus(message, isComplete) {
    var el = document.getElementById('orderpivot-upload-status');
    if (el) {
      el.textContent = message;
      el.className = 'paste-status' + (isComplete ? ' upload-complete' : '');
    }
  }

  function restoreOrderPivotDates() {
    orderPivotRows.forEach(function (row) {
      row.dueDate = parseDate(row.dueDt);
      row.displayCustomer = getDisplayCustomerName(row);
    });
  }

  function loadOrderPivotFromStorage() {
    try {
      var raw = localStorage.getItem(ORDERPIVOT_STORAGE_KEY);
      if (!raw) return;
      var stored = JSON.parse(raw);
      var loaded = stored.rows;
      var asOfVal = stored.asOf;
      if (!Array.isArray(loaded) || loaded.length === 0) return;
      orderPivotRows = loaded;
      restoreOrderPivotDates();
      var countEl = document.getElementById('orderpivot-rows-count');
      if (countEl) countEl.textContent = orderPivotRows.length;
      var asOfInput = document.getElementById('orderpivot-asof');
      if (asOfInput && asOfVal) asOfInput.value = asOfVal;
      if (!asOfVal) {
        var today = new Date();
        asOfVal = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        if (asOfInput) asOfInput.value = asOfVal;
      }
      var data = buildPivot(orderPivotRows, asOfVal);
      renderPivotTable(data);
    } catch (e) {}
  }

  function saveOrderPivotToStorage(asOfVal) {
    try {
      localStorage.setItem(ORDERPIVOT_STORAGE_KEY, JSON.stringify({ rows: orderPivotRows, asOf: asOfVal || '' }));
    } catch (e) {}
  }

  function applyOrderPivot() {
    var textarea = document.getElementById('orderpivot-paste');
    var asOfInput = document.getElementById('orderpivot-asof');
    var text = textarea && textarea.value ? textarea.value : '';
    var asOfVal = asOfInput && asOfInput.value ? asOfInput.value : '';

    setUploadStatus('', false);
    setTimeout(function () {
      var parsed = parsePaste(text);
      orderPivotRows = parsed.rows;
      restoreOrderPivotDates();

      var countEl = document.getElementById('orderpivot-rows-count');
      if (countEl) countEl.textContent = orderPivotRows.length;

      if (!asOfVal) {
        var today = new Date();
        asOfVal = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        if (asOfInput) asOfInput.value = asOfVal;
      }

      var data = buildPivot(orderPivotRows, asOfVal);
      renderPivotTable(data);
      saveOrderPivotToStorage(asOfVal);
      setUploadStatus('Upload complete', true);
    }, 0);
  }

  loadOrderPivotFromStorage();
  var btn = document.getElementById('btn-apply-orderpivot');
  if (btn) btn.addEventListener('click', applyOrderPivot);
})();
