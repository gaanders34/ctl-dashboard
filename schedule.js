/**
 * Production Schedule tab: paste schedule (header + rows), show tons per day, PCS by line, on time / late %.
 */
(function () {
  'use strict';

  var SCHEDULE_STORAGE_KEY = 'ctl-schedule-data';
  var scheduleRows = [];
  window.ctlScheduleRows = scheduleRows;

  var COL_ALIASES = {
    runDate: ['run date', 'run_date', 'rundate', 'run date ', 'date', 'ord_proddate', 'ord proddate', 'prod date', 'prod_date'],
    dueDate: ['due date', 'due_date', 'duedate', 'due dt', 'due'],
    plannedWeight: ['plannedweight', 'planned weight', 'tons', 'weight', 'lbs', 'plannedweight (lbs)', 'place', 'plannedweight (tons)'],
    plannedPcs: ['plannedpcs', 'planned pcs', 'pcs', 'pieces', 'qty'],
    line: ['pwc name', 'line', 'pwc', 'line name', 'linename', 'warehouse'],
    order: ['order', 'order id', 'order #', 'order#', 'order/line', 'orderline', 'orderitem', 'order item', 'job', 'job #', 'work order', 'work order #', 'wo', 'work order number']
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

  function excelSerialToDate(serial) {
    if (serial == null || isNaN(serial)) return null;
    var n = Number(serial);
    if (n > 1000000 || n < 0) return new Date(n);
    return new Date((n - 25569) * 86400 * 1000);
  }

  var MONTH_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

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
    var dmy = str.match(/^(\d{1,2})\s+([a-z]{3})\s*$/i);
    if (dmy) {
      var day = parseInt(dmy[1], 10);
      var mon = MONTH_ABBR[(dmy[2] || '').toLowerCase().slice(0, 3)];
      if (mon != null) return new Date(new Date().getFullYear(), mon, day);
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

  /** If runDate is only a day number (1-31), build a full date key using current month/year so tables show full date. */
  function runDateDisplayKey(row) {
    if (row.runDateObj && !isNaN(row.runDateObj.getTime())) return dateKey(row.runDateObj);
    var raw = (row.runDate != null ? String(row.runDate).trim() : '') || '';
    var dayNum = parseInt(raw, 10);
    if (raw === String(dayNum) && dayNum >= 1 && dayNum <= 31) {
      var now = new Date();
      return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(dayNum).padStart(2, '0');
    }
    return raw || '';
  }

  function findColIndex(headerRow, aliases) {
    for (var i = 0; i < headerRow.length; i++) {
      var h = (headerRow[i] != null ? String(headerRow[i]) : '').toLowerCase().trim().replace(/\s+/g, ' ');
      for (var a = 0; a < aliases.length; a++) {
        if (h.indexOf(aliases[a]) >= 0 || aliases[a].indexOf(h) >= 0) return i;
      }
    }
    return -1;
  }

  function parseExcelWorkbook(workbook) {
    var rows = [];
    if (typeof XLSX === 'undefined') return rows;
    var sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return rows;
    var data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!data || data.length < 2) return rows;
    var headerRow = data[0].map(function (c) { return c != null ? String(c).trim() : ''; });
    var idxRun = findColIndex(headerRow, ['run date', 'run_date', 'date', 'ord_proddate', 'ord proddate', 'prod date']);
    var idxDue = findColIndex(headerRow, ['due date', 'due_date', 'duedate', 'due dt', 'due']);
    var idxWeight = findColIndex(headerRow, ['plannedweight', 'planned weight', 'tons', 'weight', 'lbs', 'place']);
    var idxPcs = findColIndex(headerRow, ['plannedpcs', 'planned pcs', 'pcs', 'pieces', 'qty']);
    var idxLine = findColIndex(headerRow, ['pwc name', 'line', 'pwc', 'warehouse', 'line name']);
    var idxOrder = findColIndex(headerRow, ['order', 'order id', 'order#', 'order/line', 'orderline', 'orderitem', 'job']);
    var idxYear = findColIndex(headerRow, ['year']);
    var weightHeaderLower = (idxWeight >= 0 ? headerRow[idxWeight] : '').toLowerCase();
    var weightIsTons = weightHeaderLower.indexOf('ton') >= 0 && weightHeaderLower.indexOf('lb') < 0 && weightHeaderLower.indexOf('pound') < 0;

    function cell(r, i) {
      var v = r[i];
      if (v == null) return '';
      if (typeof v === 'number' && !isNaN(v)) return String(v);
      return String(v).trim();
    }
    function rawVal(r, i) {
      var v = r[i];
      if (v == null) return '';
      return v;
    }

    for (var r = 1; r < data.length; r++) {
      var raw = data[r];
      if (!raw || !raw.length) continue;
      var runDateVal = idxRun >= 0 ? rawVal(raw, idxRun) : '';
      var dueDateVal = idxDue >= 0 ? rawVal(raw, idxDue) : '';
      var yearVal = idxYear >= 0 ? cell(raw, idxYear) : '';
      var runDateStr = runDateVal;
      var dueDateStr = dueDateVal;
      if (typeof runDateVal === 'number' && runDateVal > 1000 && runDateVal < 1000000) {
        var rd = excelSerialToDate(runDateVal);
        runDateStr = rd ? (rd.getMonth() + 1) + '/' + rd.getDate() + '/' + rd.getFullYear() : '';
      } else if (typeof runDateVal === 'number' && runDateVal >= 1 && runDateVal <= 31) {
        var now = new Date();
        runDateStr = (now.getMonth() + 1) + '/' + Math.floor(runDateVal) + '/' + now.getFullYear();
      } else if (runDateVal != null && runDateVal !== '') runDateStr = String(runDateVal).trim();
      if (typeof dueDateVal === 'number' && dueDateVal > 1000 && dueDateVal < 1000000) {
        var dd = excelSerialToDate(dueDateVal);
        dueDateStr = dd ? (dd.getMonth() + 1) + '/' + dd.getDate() + '/' + dd.getFullYear() : '';
      } else if (typeof dueDateVal === 'number' && dueDateVal >= 1 && dueDateVal <= 31) {
        var nowDue = new Date();
        dueDateStr = (nowDue.getMonth() + 1) + '/' + Math.floor(dueDateVal) + '/' + nowDue.getFullYear();
      } else if (dueDateVal != null && dueDateVal !== '') dueDateStr = String(dueDateVal).trim();
      if (dueDateStr && dueDateStr.match(/^\d{1,2}\s+[a-z]{3}\s*$/i) && yearVal) {
        var ym = dueDateStr.match(/^(\d{1,2})\s+([a-z]{3})\s*$/i);
        if (ym) {
          var y = parseInt(yearVal, 10) || new Date().getFullYear();
          var mon = MONTH_ABBR[(ym[2] || '').toLowerCase().slice(0, 3)];
          if (mon != null) dueDateStr = (mon + 1) + '/' + ym[1] + '/' + y;
        }
      }
      var weightVal = idxWeight >= 0 ? cell(raw, idxWeight) : '';
      var rawWeight = numVal(weightVal);
      var row = {
        runDate: runDateStr,
        dueDate: dueDateStr,
        plannedWeight: weightVal,
        plannedPcs: idxPcs >= 0 ? cell(raw, idxPcs) : '',
        line: idxLine >= 0 ? cell(raw, idxLine) : '',
        order: idxOrder >= 0 ? cell(raw, idxOrder) : '',
        runDateObj: parseDate(runDateStr),
        dueDateObj: parseDate(dueDateStr),
        weightNum: weightIsTons ? rawWeight * 2000 : rawWeight,
        pcsNum: numVal(idxPcs >= 0 ? raw[idxPcs] : 0),
        lineName: (idxLine >= 0 ? cell(raw, idxLine) : '').trim() || '—'
      };
      rows.push(row);
    }
    return rows;
  }

  function parsePaste(text) {
    var lines = (text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (lines.length < 2) return { rows: [] };
    var sep = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var headerLine = lines[0].split(sep).map(function (h) { return h.trim(); });
    var headers = headerLine.map(function (h) { return normalizeHeader(h); });
    var weightIdx = headers.indexOf('plannedWeight');
    var weightHeaderLower = (weightIdx >= 0 && headerLine[weightIdx]) ? headerLine[weightIdx].toLowerCase() : '';
    var weightIsTons = weightHeaderLower.indexOf('ton') >= 0 && weightHeaderLower.indexOf('lb') < 0 && weightHeaderLower.indexOf('pound') < 0;

    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split(sep).map(function (c) { return c.trim(); });
      var row = {};
      headers.forEach(function (key, idx) {
        row[key] = cells[idx];
      });
      row.runDateObj = parseDate(row.runDate);
      row.dueDateObj = parseDate(row.dueDate);
      var rawWeight = numVal(row.plannedWeight);
      row.weightNum = weightIsTons ? rawWeight * 2000 : rawWeight;
      row.pcsNum = numVal(row.plannedPcs);
      row.lineName = (row.line || '').trim() || '—';
      rows.push(row);
    }
    return { rows: rows };
  }

  function setEl(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderSchedule() {
    // Tons per day: group by run date, sum weight
    var tonsByDate = {};
    scheduleRows.forEach(function (row) {
      var k = runDateDisplayKey(row);
      if (!k) return;
      if (!tonsByDate[k]) tonsByDate[k] = 0;
      tonsByDate[k] += row.weightNum;
    });
    var tonsRows = Object.keys(tonsByDate).sort().map(function (k) {
      var lbs = tonsByDate[k];
      var tons = (lbs / 2000).toFixed(2);
      return '<tr><td>' + escapeHtml(k) + '</td><td>' + tons + '</td><td>' + Math.round(lbs).toLocaleString() + '</td></tr>';
    });
    var tonsBody = document.getElementById('schedule-tons-body');
    if (tonsBody) tonsBody.innerHTML = tonsRows.length ? tonsRows.join('') : '<tr><td colspan="3">No data</td></tr>';

    // PCS per day by line: group by run date and line, pivot Line 1 / Line 2 / Total
    var pcsByDateLine = {};
    var allLines = {};
    scheduleRows.forEach(function (row) {
      var k = runDateDisplayKey(row);
      if (!k) return;
      var line = row.lineName || '—';
      allLines[line] = true;
      if (!pcsByDateLine[k]) pcsByDateLine[k] = {};
      if (!pcsByDateLine[k][line]) pcsByDateLine[k][line] = 0;
      pcsByDateLine[k][line] += row.pcsNum;
    });
    var lineNames = Object.keys(allLines).sort();
    var line1 = lineNames[0] || 'Line 1';
    var line2 = lineNames[1] || 'Line 2';
    var theadRow = document.getElementById('schedule-pcs-thead-row');
    if (theadRow) {
      theadRow.innerHTML = '<th>Run date</th><th>' + escapeHtml(line1) + '</th><th>' + escapeHtml(line2) + '</th><th>Total</th>';
    }
    var pcsRows = Object.keys(pcsByDateLine).sort().map(function (k) {
      var line1Pcs = pcsByDateLine[k][line1] || 0;
      var line2Pcs = pcsByDateLine[k][line2] || 0;
      var total = (line1Pcs + line2Pcs) || Object.keys(pcsByDateLine[k]).reduce(function (sum, ln) { return sum + (pcsByDateLine[k][ln] || 0); }, 0);
      return '<tr><td>' + escapeHtml(k) + '</td><td>' + line1Pcs + '</td><td>' + line2Pcs + '</td><td>' + total + '</td></tr>';
    });
    var pcsBody = document.getElementById('schedule-pcs-body');
    if (pcsBody) pcsBody.innerHTML = pcsRows.length ? pcsRows.join('') : '<tr><td colspan="4">No data</td></tr>';

    // On time / late % per day: run date vs due_date
    var onTimeByDate = {};
    var lateByDate = {};
    scheduleRows.forEach(function (row) {
      var runK = runDateDisplayKey(row);
      if (!runK) return;
      if (!onTimeByDate[runK]) onTimeByDate[runK] = 0;
      if (!lateByDate[runK]) lateByDate[runK] = 0;
      var runD = row.runDateObj;
      var dueD = row.dueDateObj;
      if (!runD || !dueD) {
        onTimeByDate[runK] += 1;
        return;
      }
      var runOnly = new Date(runD.getFullYear(), runD.getMonth(), runD.getDate());
      var dueOnly = new Date(dueD.getFullYear(), dueD.getMonth(), dueD.getDate());
      if (runOnly <= dueOnly) onTimeByDate[runK] += 1;
      else lateByDate[runK] += 1;
    });
    var allDates = {};
    Object.keys(onTimeByDate).forEach(function (k) { allDates[k] = true; });
    Object.keys(lateByDate).forEach(function (k) { allDates[k] = true; });
    var onTimeRows = Object.keys(allDates).sort().map(function (k) {
      var onTime = onTimeByDate[k] || 0;
      var late = lateByDate[k] || 0;
      var jobs = onTime + late;
      var onPct = jobs > 0 ? ((onTime / jobs) * 100).toFixed(1) : '0';
      var latePct = jobs > 0 ? ((late / jobs) * 100).toFixed(1) : '0';
      return '<tr><td>' + escapeHtml(k) + '</td><td>' + jobs + '</td><td>' + onPct + '%</td><td>' + latePct + '%</td></tr>';
    });
    var onTimeBody = document.getElementById('schedule-ontime-body');
    if (onTimeBody) onTimeBody.innerHTML = onTimeRows.length ? onTimeRows.join('') : '<tr><td colspan="4">No data</td></tr>';
  }

  function setUploadStatus(message, isComplete) {
    var el = document.getElementById('schedule-upload-status');
    if (el) {
      el.textContent = message;
      el.className = 'paste-status' + (isComplete ? ' upload-complete' : '');
    }
  }

  function restoreScheduleDateObjects() {
    scheduleRows.forEach(function (row) {
      row.runDateObj = parseDate(row.runDate);
      row.dueDateObj = parseDate(row.dueDate);
    });
  }

  function loadScheduleFromStorage() {
    try {
      var raw = localStorage.getItem(SCHEDULE_STORAGE_KEY);
      if (!raw) return;
      var loaded = JSON.parse(raw);
      if (Array.isArray(loaded) && loaded.length > 0) {
        scheduleRows = loaded;
        window.ctlScheduleRows = scheduleRows;
        restoreScheduleDateObjects();
        setEl('schedule-rows-count', scheduleRows.length);
        renderSchedule();
      }
    } catch (e) {}
  }

  function saveScheduleToStorage() {
    try {
      localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(scheduleRows));
    } catch (e) {}
  }

  function applyScheduleFromParsed(rows) {
    scheduleRows = rows || [];
    window.ctlScheduleRows = scheduleRows;
    restoreScheduleDateObjects();
    setEl('schedule-rows-count', scheduleRows.length);
    renderSchedule();
    saveScheduleToStorage();
  }

  function init() {
    loadScheduleFromStorage();

    var fileInput = document.getElementById('schedule-file');
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
            applyScheduleFromParsed(rows);
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

    var btn = document.getElementById('btn-apply-schedule');
    if (btn) {
      btn.addEventListener('click', function () {
        var textarea = document.getElementById('schedule-paste');
        var text = textarea ? textarea.value : '';
        setUploadStatus('', false);
        setTimeout(function () {
          var parsed = parsePaste(text);
          applyScheduleFromParsed(parsed.rows || []);
          setUploadStatus('Upload complete', true);
        }, 0);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
