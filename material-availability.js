/**
 * Material Availability tab: paste jobs (header + rows), show only jobs where
 * material is not available, on quality hold, below minimum weight for run,
 * credit hold, or coil break.
 */
(function () {
  'use strict';

  var MATERIAL_STORAGE_KEY = 'ctl-materialavailability-data';
  var materialAvailabilityRows = [];
  var headerNames = []; // original header labels for table

  // Phrases that indicate a job should be shown (case-insensitive substring match)
  var BLOCKED_PHRASES = [
    'material not available',
    'material unavailable',
    'no material',
    'no coil',
    'quality hold',
    'on quality hold',
    'credit hold',
    'coil break',
    'coil broken'
  ];

  var COL_ALIASES = {
    customer: ['cus name', 'customer', 'customer name', 'cusname', 'cust'],
    order: ['order', 'order #', 'order#', 'ordernum', 'job', 'job #', 'work order', 'work order #', 'wo'],
    status: ['status', 'hold', 'hold reason', 'reason', 'material status', 'blocked reason', 'comment', 'notes'],
    weight: ['weight', 'balance', 'balance (lbs)', 'lbs', 'lb', 'plannedweight', 'planned weight', 'weight (lbs)'],
    dueDate: ['due dt', 'due_dt', 'due date', 'duedate', 'due']
  };

  function normalizeHeader(name) {
    if (!name || typeof name !== 'string') return '';
    var s = name.toLowerCase().trim().replace(/\s+/g, ' ');
    for (var key in COL_ALIASES) {
      for (var i = 0; i < COL_ALIASES[key].length; i++) {
        if (s.indexOf(COL_ALIASES[key][i]) === 0 || s === COL_ALIASES[key][i]) return key;
      }
    }
    return s.replace(/\s/g, '_') || 'col';
  }

  function parseDate(s) {
    if (!s) return null;
    if (typeof s === 'number' && !isNaN(s)) return new Date(s);
    var str = String(s).trim();
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

  function dateKey(d) {
    if (!d) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  /** Returns true if the row matches any blocked condition. */
  function isBlockedRow(row, minWeightLbs) {
    if (row._fromExcelSheet) return true;
    var statusParts = [
      row.status,
      row._rawStatus,
      row.reason,
      row.holdReason,
      row.materialStatus,
      row.comment,
      row.notes
    ];
    if (row._raw) {
      Object.keys(row._raw).forEach(function (k) { statusParts.push(row._raw[k]); });
    }
    var statusText = statusParts.filter(Boolean).join(' ').toLowerCase();

    // Check text phrases (material not available, quality hold, credit hold, coil break)
    for (var i = 0; i < BLOCKED_PHRASES.length; i++) {
      if (statusText.indexOf(BLOCKED_PHRASES[i]) >= 0) return true;
    }

    // Below minimum weight for production run
    if (minWeightLbs > 0 && row.weightNum > 0 && row.weightNum < minWeightLbs) return true;

    return false;
  }

  function parsePaste(text) {
    var lines = (text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (lines.length < 2) return { headers: [], headerNames: [], rows: [] };
    var sep = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var headerLine = lines[0].split(sep).map(function (h) { return h.trim(); });
    var headers = headerLine.map(function (h) { return normalizeHeader(h); });
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split(sep).map(function (c) { return c.trim(); });
      var row = { _raw: {} };
      headers.forEach(function (key, idx) {
        var val = cells[idx];
        row[key] = val;
        row._raw[headerLine[idx] || key] = val;
      });
      row._rawStatus = [row.status, row.reason].filter(Boolean).join(' ');
      row.weightNum = numVal(row.weight);
      row.dueDateObj = parseDate(row.dueDate);
      rows.push(row);
    }
    return { headers: headers, headerNames: headerLine, rows: rows };
  }

  function findColIndex(headers, aliases) {
    for (var i = 0; i < headers.length; i++) {
      var h = (headers[i] != null ? String(headers[i]) : '').toLowerCase().trim();
      for (var a = 0; a < aliases.length; a++) {
        if (h.indexOf(aliases[a]) >= 0 || aliases[a].indexOf(h) >= 0) return i;
      }
    }
    return -1;
  }

  function parseExcelWorkbook(workbook) {
    var rows = [];
    if (typeof XLSX === 'undefined') return rows;
    var sheetNames = workbook.SheetNames || [];
    for (var s = 0; s < sheetNames.length; s++) {
      var sheetName = sheetNames[s];
      var sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      var data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!data || data.length < 2) continue;
      var headerRow = data[0].map(function (c) { return c != null ? String(c).trim() : ''; });
      var idxCus = findColIndex(headerRow, ['cus name', 'customer', 'cusname', 'cust name']);
      var idxOrder = findColIndex(headerRow, ['order', 'job', 'work order']);
      var idxDue = findColIndex(headerRow, ['due', 'due date', 'duedate']);
      var idxNotes = findColIndex(headerRow, ['notes', 'note', 'comments', 'comment', 'remark', 'remarks']);
      if (idxCus < 0 && idxOrder < 0) continue;
      for (var r = 1; r < data.length; r++) {
        var raw = data[r];
        if (!raw || !raw.length) continue;
        var cell = function (i) { return (raw[i] != null ? String(raw[i]) : '').trim(); };
        var cus = idxCus >= 0 ? cell(idxCus) : '';
        var order = idxOrder >= 0 ? cell(idxOrder) : '';
        var due = idxDue >= 0 ? cell(idxDue) : '';
        var excelNotes = (idxNotes >= 0 ? cell(idxNotes) : '') || '';
        if (!cus && !order) continue;
        var row = {
          _raw: {},
          customer: cus,
          order: order,
          dueDate: due,
          status: 'No coil',
          notes: excelNotes ? excelNotes : sheetName,
          _sheetName: sheetName,
          _rawStatus: 'No coil ' + sheetName,
          _fromExcelSheet: true,
          weightNum: 0,
          dueDateObj: parseDate(due)
        };
        headerRow.forEach(function (h, i) { row._raw[h || 'col' + i] = cell(i); });
        rows.push(row);
      }
    }
    return rows;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function setEl(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function getMinWeightInput() {
    var el = document.getElementById('materialavailability-min-weight');
    if (!el || el.value === '') return 0;
    var n = parseFloat(el.value, 10);
    return isNaN(n) ? 0 : n;
  }

  function render() {
    var minWeight = getMinWeightInput();
    var filtered = materialAvailabilityRows.filter(function (row) { return isBlockedRow(row, minWeight); });

    setEl('materialavailability-rows-count', materialAvailabilityRows.length);
    setEl('materialavailability-filtered-count', filtered.length);

    var theadRow = document.getElementById('materialavailability-thead-row');
    var tbody = document.getElementById('materialavailability-body');
    if (!tbody) return;

    if (theadRow) {
      theadRow.innerHTML = '<th>Cus Name</th><th>Order</th><th>Due</th><th>Tab</th><th>Notes</th><th>Owner</th>';
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr class="no-material-empty"><td colspan="6">No jobs match (material not available, quality hold, below min weight, credit hold, coil break)</td></tr>';
      return;
    }

    function getVal(row, key) {
      if (row[key] != null && row[key] !== '') return row[key];
      var raw = row._raw || {};
      for (var r in raw) {
        if (r.toLowerCase().replace(/\s/g, '').indexOf(key.replace(/_/g, '')) >= 0) return raw[r];
      }
      return '—';
    }

    var orderIdAttr = function (o) { return (o && String(o).trim()) ? ' data-order="' + escapeHtml(String(o).trim()) + '"' : ''; };
    var rows = filtered.map(function (row) {
      var cusName = getVal(row, 'customer') || row._raw['Cus Name'] || row._raw['Customer'] || '—';
      var order = getVal(row, 'order') || '—';
      var due = row.dueDateObj ? dateKey(row.dueDateObj) : (getVal(row, 'dueDate') || row.dueDate || '—');
      var tab = row._sheetName != null && row._sheetName !== '' ? row._sheetName : '—';
      var notes = [row.notes, row.status, row.reason, row._rawStatus].filter(Boolean)[0] || getVal(row, 'status') || '—';
      return '<tr class="no-material-row">' +
        '<td>' + escapeHtml(String(cusName)) + '</td>' +
        '<td>' + escapeHtml(String(order)) + '</td>' +
        '<td>' + escapeHtml(String(due)) + '</td>' +
        '<td>' + escapeHtml(String(tab)) + '</td>' +
        '<td>' + escapeHtml(String(notes)) + '</td>' +
        '<td><span class="blocked-owner" contenteditable="true"' + orderIdAttr(order) + '></span></td>' +
      '</tr>';
    });
    tbody.innerHTML = rows.join('');
    if (typeof window.ctlRestoreBlockedOwners === 'function') window.ctlRestoreBlockedOwners(tbody);
  }

  function setUploadStatus(message, isComplete) {
    var el = document.getElementById('materialavailability-upload-status');
    if (el) {
      el.textContent = message;
      el.className = 'paste-status' + (isComplete ? ' upload-complete' : '');
    }
  }

  function restoreMaterialDateObjects() {
    materialAvailabilityRows.forEach(function (row) {
      row.dueDateObj = parseDate(row.dueDate);
    });
  }

  function loadMaterialFromStorage() {
    try {
      var raw = localStorage.getItem(MATERIAL_STORAGE_KEY);
      if (!raw) return;
      var loaded = JSON.parse(raw);
      if (Array.isArray(loaded) && loaded.length > 0) {
        materialAvailabilityRows = loaded;
        restoreMaterialDateObjects();
        setEl('materialavailability-rows-count', materialAvailabilityRows.length);
        render();
      }
    } catch (e) {}
  }

  function saveMaterialToStorage() {
    try {
      localStorage.setItem(MATERIAL_STORAGE_KEY, JSON.stringify(materialAvailabilityRows));
    } catch (e) {}
  }

  function init() {
    loadMaterialFromStorage();

    var fileInput = document.getElementById('materialavailability-file');
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
            materialAvailabilityRows = rows;
            headerNames = [];
            restoreMaterialDateObjects();
            render();
            saveMaterialToStorage();
            setUploadStatus('Loaded ' + rows.length + ' rows from ' + (workbook.SheetNames && workbook.SheetNames.length) + ' sheet(s).', true);
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

    var btn = document.getElementById('btn-apply-materialavailability');
    if (btn) {
      btn.addEventListener('click', function () {
        var textarea = document.getElementById('materialavailability-paste');
        var text = textarea ? textarea.value : '';
        setUploadStatus('', false);
        setTimeout(function () {
          var parsed = parsePaste(text);
          materialAvailabilityRows = parsed.rows || [];
          headerNames = parsed.headerNames || [];
          restoreMaterialDateObjects();
          render();
          saveMaterialToStorage();
          setUploadStatus('Upload complete', true);
        }, 0);
      });
    }

    var minWeightEl = document.getElementById('materialavailability-min-weight');
    if (minWeightEl) minWeightEl.addEventListener('change', render);
    if (minWeightEl) minWeightEl.addEventListener('input', render);
  }

  window.ctlMaterialAvailabilityRefresh = function () { render(); };

  function getValForDisplay(row, key) {
    if (row[key] != null && row[key] !== '') return row[key];
    var raw = row._raw || {};
    for (var r in raw) {
      if (r.toLowerCase().replace(/\s/g, '').indexOf(key.replace(/_/g, '')) >= 0) return raw[r];
    }
    return '—';
  }

  function displayFieldsFromMaterialRow(row) {
    var cusName = getValForDisplay(row, 'customer') || (row._raw && (row._raw['Cus Name'] || row._raw['Customer'])) || '—';
    var order = getValForDisplay(row, 'order') || '—';
    var due = row.dueDateObj ? dateKey(row.dueDateObj) : (getValForDisplay(row, 'dueDate') || row.dueDate || '—');
    var tab = row._sheetName != null && row._sheetName !== '' ? row._sheetName : '—';
    var notes = [row.notes, row.status, row.reason, row._rawStatus].filter(Boolean)[0] || getValForDisplay(row, 'status') || '—';
    return { cusName: String(cusName), order: String(order), due: String(due), tab: String(tab), notes: String(notes) };
  }

  /** Match a blocked material row to an open-order row (order + item). */
  window.ctlMaterialAvailabilityMatchBlockedRowForOpenOrder = function (openRow) {
    var minWeight = getMinWeightInput();
    var blocked = materialAvailabilityRows.filter(function (row) { return isBlockedRow(row, minWeight); });
    function moStr(r) {
      return (r.order != null ? String(r.order).trim() : '');
    }
    var o = (openRow.order != null ? String(openRow.order).trim() : '');
    var item = (openRow.item != null ? String(openRow.item).trim() : '');
    function matches(mo) {
      if (!mo || !o) return false;
      if (item) {
        var prefix = o + '-' + item;
        return mo === prefix || mo.indexOf(prefix + '-') === 0;
      }
      if (mo === o) return true;
      return mo.indexOf(o + '-') === 0;
    }
    for (var i = 0; i < blocked.length; i++) {
      if (matches(moStr(blocked[i]))) return blocked[i];
    }
    return null;
  };

  window.ctlMaterialAvailabilityRowToDisplayFields = function (matRow) {
    return matRow ? displayFieldsFromMaterialRow(matRow) : null;
  };

  /** Return blocked rows (material not available, quality hold, etc.) for Manager tab. */
  window.ctlMaterialAvailabilityGetBlocked = function () {
    var minWeight = getMinWeightInput();
    return materialAvailabilityRows.filter(function (row) { return isBlockedRow(row, minWeight); });
  };

  /** Return order IDs where Notes (or status) indicate "need to close" / "close out" for pivot orange highlight. */
  window.ctlMaterialAvailabilityGetNeedToCloseOrderIds = function () {
    var needClose = /close\s*out|need\s*to\s*close|close\s*order|must\s*close/i;
    var ids = {};
    materialAvailabilityRows.forEach(function (row) {
      var notes = [row.notes, row.status, row.reason, row._rawStatus].filter(Boolean).join(' ');
      if (!needClose.test(notes)) return;
      var o = (row.order != null ? String(row.order) : '').trim();
      if (!o) return;
      ids[o] = true;
      var orderOnly = o.indexOf('-') >= 0 ? o.split('-')[0].trim() : o;
      if (orderOnly) ids[orderOnly] = true;
    });
    return ids;
  };

  window.ctlMaterialAvailabilityGetAll = function () {
    return materialAvailabilityRows;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
